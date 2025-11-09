/*
 * Copyright 2025 Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useReducer, useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { TkCard, TkCardContent } from "thinkube-style/components/cards-data"
import { TkButton } from "thinkube-style/components/buttons-badges"
import { TkAlert, TkAlertDescription, tkToast } from "thinkube-style/components/feedback"
import { TkSubwayProgress } from "thinkube-style/components/progress"
import { PlaybookExecutorStream } from "@/components/PlaybookExecutorStream"
import { AlertCircle, Download, Copy, PartyPopper } from "lucide-react"

// Types
interface Playbook {
  id: string
  phase: string
  title: string
  name: string
  extraVars?: Record<string, any>
}

interface PlaybookLog {
  status: 'success' | 'failed' | 'running'
  logs: string
  timestamp: Date
}

interface DeployState {
  queue: Playbook[]
  currentIndex: number
  status: 'idle' | 'running' | 'failed' | 'complete'
  logs: Map<string, PlaybookLog>
  error: string | null
  failedPlaybook: Playbook | null
}

type DeployAction =
  | { type: 'INIT_QUEUE'; queue: Playbook[] }
  | { type: 'START_PLAYBOOK'; index: number }
  | { type: 'PLAYBOOK_SUCCESS'; playbookId: string; logs: string }
  | { type: 'PLAYBOOK_FAILED'; playbookId: string; logs: string; error: string }
  | { type: 'COMPLETE' }
  | { type: 'RESET' }

// Reducer
function deployReducer(state: DeployState, action: DeployAction): DeployState {
  switch (action.type) {
    case 'INIT_QUEUE':
      return { ...state, queue: action.queue, status: 'idle' }

    case 'START_PLAYBOOK':
      return { ...state, currentIndex: action.index, status: 'running', error: null }

    case 'PLAYBOOK_SUCCESS': {
      const newLogs = new Map(state.logs)
      newLogs.set(action.playbookId, {
        status: 'success',
        logs: action.logs,
        timestamp: new Date()
      })
      return { ...state, logs: newLogs }
    }

    case 'PLAYBOOK_FAILED': {
      const newLogs = new Map(state.logs)
      newLogs.set(action.playbookId, {
        status: 'failed',
        logs: action.logs,
        timestamp: new Date()
      })
      return {
        ...state,
        logs: newLogs,
        status: 'failed',
        error: action.error,
        failedPlaybook: state.queue[state.currentIndex]
      }
    }

    case 'COMPLETE':
      return { ...state, status: 'complete', currentIndex: state.queue.length }

    case 'RESET':
      return {
        queue: [],
        currentIndex: 0,
        status: 'idle',
        logs: new Map(),
        error: null,
        failedPlaybook: null
      }

    default:
      return state
  }
}

const initialState: DeployState = {
  queue: [],
  currentIndex: 0,
  status: 'idle',
  logs: new Map(),
  error: null,
  failedPlaybook: null
}

export default function Deploy() {
  const navigate = useNavigate()
  const [state, dispatch] = useReducer(deployReducer, initialState)
  const executorRef = useRef<any>(null)
  const currentLogsRef = useRef<string>('')

  // Build playbook queue
  const buildQueue = async (): Promise<Playbook[]> => {
    const queue: Playbook[] = []
    const config = typeof window !== 'undefined'
      ? JSON.parse(localStorage.getItem('thinkube-config') || '{}')
      : {}

    // Phase 1: Initial Setup
    queue.push({
      id: 'env-setup',
      phase: 'initial',
      title: 'Setting up Environment',
      name: 'ansible/00_initial_setup/20_setup_env.yaml'
    })

    queue.push({
      id: 'python-setup',
      phase: 'initial',
      title: 'Setting up Python Virtual Environments',
      name: 'ansible/40_thinkube/core/infrastructure/00_setup_python_k8s.yaml'
    })

    queue.push({
      id: 'github-cli',
      phase: 'initial',
      title: 'Setting up GitHub CLI',
      name: 'ansible/00_initial_setup/40_setup_github_cli.yaml'
    })

    // Phase 2: Networking
    const networkMode = config.networkMode || 'overlay'
    const overlayProvider = config.overlayProvider || 'zerotier'

    if (networkMode === 'overlay') {
      if (overlayProvider === 'zerotier') {
        queue.push({
          id: 'zerotier-setup',
          phase: 'initial',
          title: 'Configuring ZeroTier Overlay Network',
          name: 'ansible/30_networking/10_setup_zerotier.yaml'
        })
      } else if (overlayProvider === 'tailscale') {
        queue.push({
          id: 'tailscale-setup',
          phase: 'initial',
          title: 'Configuring Tailscale Overlay Network',
          name: 'ansible/30_networking/11_setup_tailscale.yaml'
        })
      }
    }

    // Phase 3: Kubernetes Infrastructure
    queue.push({
      id: 'setup-python-k8s',
      phase: 'kubernetes',
      title: 'Setting up Python Kubernetes Libraries',
      name: 'ansible/40_thinkube/core/infrastructure/00_setup_python_k8s.yaml'
    })

    queue.push({
      id: 'k8s',
      phase: 'kubernetes',
      title: 'Installing Canonical Kubernetes',
      name: 'ansible/40_thinkube/core/infrastructure/k8s/10_install_k8s.yaml'
    })

    // Join worker nodes
    const clusterNodes = typeof window !== 'undefined'
      ? JSON.parse(sessionStorage.getItem('clusterNodes') || '[]')
      : []
    const hasWorkers = clusterNodes.some((n: any) => n.role === 'worker')
    if (hasWorkers) {
      queue.push({
        id: 'k8s-join-workers',
        phase: 'kubernetes',
        title: 'Joining Worker Nodes to Cluster',
        name: 'ansible/40_thinkube/core/infrastructure/k8s/20_join_workers.yaml'
      })
    }

    // GPU operator if needed
    const serverHardware = typeof window !== 'undefined'
      ? JSON.parse(sessionStorage.getItem('serverHardware') || '[]')
      : []
    const needsGPUOperator = serverHardware.some((s: any) => s.hardware?.gpu_detected)
    if (needsGPUOperator) {
      queue.push({
        id: 'gpu-operator',
        phase: 'kubernetes',
        title: 'Installing NVIDIA GPU Operator',
        name: 'ansible/40_thinkube/core/infrastructure/gpu_operator/10_deploy.yaml'
      })
    }

    queue.push({
      id: 'dns-server',
      phase: 'kubernetes',
      title: 'Deploying DNS Server (BIND9)',
      name: 'ansible/40_thinkube/core/infrastructure/dns-server/10_deploy.yaml'
    })

    queue.push({
      id: 'coredns',
      phase: 'kubernetes',
      title: 'Deploying CoreDNS',
      name: 'ansible/40_thinkube/core/infrastructure/coredns/10_deploy.yaml'
    })

    queue.push({
      id: 'coredns-configure-nodes',
      phase: 'kubernetes',
      title: 'Configuring Node DNS',
      name: 'ansible/40_thinkube/core/infrastructure/coredns/15_configure_node_dns.yaml'
    })

    queue.push({
      id: 'acme-certificates',
      phase: 'kubernetes',
      title: 'Setting up SSL Certificates',
      name: 'ansible/40_thinkube/core/infrastructure/acme-certificates/10_deploy.yaml'
    })

    queue.push({
      id: 'ingress',
      phase: 'kubernetes',
      title: 'Deploying Ingress Controller',
      name: 'ansible/40_thinkube/core/infrastructure/ingress/10_deploy.yaml'
    })

    // Core Services
    queue.push({
      id: 'postgresql',
      phase: 'kubernetes',
      title: 'Installing PostgreSQL',
      name: 'ansible/40_thinkube/core/postgresql/00_install.yaml'
    })

    queue.push({
      id: 'keycloak',
      phase: 'kubernetes',
      title: 'Installing Keycloak',
      name: 'ansible/40_thinkube/core/keycloak/00_install.yaml'
    })

    queue.push({
      id: 'harbor',
      phase: 'kubernetes',
      title: 'Installing Harbor',
      name: 'ansible/40_thinkube/core/harbor/00_install.yaml'
    })

    queue.push({
      id: 'seaweedfs',
      phase: 'kubernetes',
      title: 'Installing SeaweedFS',
      name: 'ansible/40_thinkube/core/seaweedfs/00_install.yaml'
    })

    queue.push({
      id: 'juicefs',
      phase: 'kubernetes',
      title: 'Installing JuiceFS Distributed Filesystem',
      name: 'ansible/40_thinkube/core/juicefs/00_install.yaml'
    })

    queue.push({
      id: 'argo-workflows',
      phase: 'kubernetes',
      title: 'Installing Argo Workflows',
      name: 'ansible/40_thinkube/core/argo-workflows/00_install.yaml'
    })

    queue.push({
      id: 'argocd',
      phase: 'kubernetes',
      title: 'Installing ArgoCD',
      name: 'ansible/40_thinkube/core/argocd/00_install.yaml'
    })

    queue.push({
      id: 'devpi',
      phase: 'kubernetes',
      title: 'Installing DevPi',
      name: 'ansible/40_thinkube/core/devpi/00_install.yaml'
    })

    queue.push({
      id: 'gitea',
      phase: 'kubernetes',
      title: 'Installing Gitea',
      name: 'ansible/40_thinkube/core/gitea/00_install.yaml'
    })

    queue.push({
      id: 'code-server',
      phase: 'kubernetes',
      title: 'Installing Code-Server',
      name: 'ansible/40_thinkube/core/code-server/00_install.yaml'
    })

    queue.push({
      id: 'thinkube-control',
      phase: 'kubernetes',
      title: 'Deploying Thinkube Control',
      name: 'ansible/40_thinkube/core/thinkube-control/00_install.yaml'
    })

    return queue
  }

  // Execute playbook
  const executePlaybook = (playbook: Playbook) => {
    if (!executorRef.current?.startExecution) return

    const sudoPassword = sessionStorage.getItem('sudoPassword')

    executorRef.current.startExecution({
      environment: {
        ANSIBLE_BECOME_PASSWORD: sudoPassword,
        ANSIBLE_SSH_PASSWORD: sudoPassword
      },
      extra_vars: playbook.extraVars || {}
    })
  }

  // Handle playbook completion
  const handlePlaybookComplete = (result: any) => {
    const currentPlaybook = state.queue[state.currentIndex]
    if (!currentPlaybook) return

    // Extract logs from result or use ref
    const logs = result.logs || result.output || currentLogsRef.current

    if (result.status === 'error' || result.status === 'failed') {
      dispatch({
        type: 'PLAYBOOK_FAILED',
        playbookId: currentPlaybook.id,
        logs,
        error: result.message || 'Playbook execution failed'
      })
    } else {
      dispatch({
        type: 'PLAYBOOK_SUCCESS',
        playbookId: currentPlaybook.id,
        logs
      })

      // Auto-continue to next playbook
      const nextIndex = state.currentIndex + 1
      if (nextIndex < state.queue.length) {
        setTimeout(() => {
          dispatch({ type: 'START_PLAYBOOK', index: nextIndex })
        }, 100)
      } else {
        dispatch({ type: 'COMPLETE' })
      }
    }
  }

  // Retry failed playbook
  const handleRetry = () => {
    if (state.failedPlaybook) {
      dispatch({ type: 'START_PLAYBOOK', index: state.currentIndex })
    }
  }

  // Rollback mapping: deployment playbook id -> rollback playbook path
  const getRollbackPlaybook = (deploymentId: string): string | null => {
    const rollbackMap: Record<string, string> = {
      // Initial setup - no rollback
      'env-setup': null,
      'python-setup': null,
      'github-cli': null,
      'zerotier-setup': null,
      'tailscale-setup': null,

      // Kubernetes infrastructure
      'setup-python-k8s': null,
      'k8s': 'ansible/40_thinkube/core/infrastructure/k8s/19_rollback_control.yaml',
      'k8s-join-workers': 'ansible/40_thinkube/core/infrastructure/k8s/29_rollback_workers.yaml',
      'gpu-operator': 'ansible/40_thinkube/core/infrastructure/gpu_operator/19_rollback.yaml',
      'dns-server': 'ansible/40_thinkube/core/infrastructure/dns-server/19_rollback.yaml',
      'coredns': 'ansible/40_thinkube/core/infrastructure/coredns/19_rollback.yaml',
      'coredns-configure-nodes': null,
      'acme-certificates': 'ansible/40_thinkube/core/infrastructure/acme-certificates/19_rollback.yaml',
      'ingress': 'ansible/40_thinkube/core/infrastructure/ingress/19_rollback.yaml',

      // Core services
      'postgresql': 'ansible/40_thinkube/core/postgresql/19_rollback.yaml',
      'keycloak': 'ansible/40_thinkube/core/keycloak/19_rollback.yaml',
      'harbor': 'ansible/40_thinkube/core/harbor/19_rollback.yaml',
      'seaweedfs': 'ansible/40_thinkube/core/seaweedfs/19_rollback.yaml',
      'juicefs': 'ansible/40_thinkube/core/juicefs/19_rollback.yaml',
      'argo-workflows': 'ansible/40_thinkube/core/argo-workflows/19_rollback.yaml',
      'argocd': 'ansible/40_thinkube/core/argocd/19_rollback.yaml',
      'devpi': 'ansible/40_thinkube/core/devpi/19_rollback.yaml',
      'gitea': 'ansible/40_thinkube/core/gitea/19_rollback.yaml',
      'code-server': 'ansible/40_thinkube/core/code-server/19_rollback.yaml',
      'thinkube-control': 'ansible/40_thinkube/core/thinkube-control/19_rollback.yaml'
    }

    return rollbackMap[deploymentId] || null
  }

  // Rollback
  const handleRollback = () => {
    // Build list of rollback playbooks for deployed components (including failed one)
    // Execute in reverse order (LIFO - last deployed, first rolled back)
    const rollbackQueue: Playbook[] = []

    // Start from currentIndex (failed component) and go backwards
    // Include both successful AND failed components (failed ones might be partially deployed)
    for (let i = state.currentIndex; i >= 0; i--) {
      const playbook = state.queue[i]
      const logEntry = state.logs.get(playbook.id)

      // Rollback if component was attempted (success or failed status)
      if (logEntry && (logEntry.status === 'success' || logEntry.status === 'failed')) {
        const rollbackPath = getRollbackPlaybook(playbook.id)
        if (rollbackPath) {
          rollbackQueue.push({
            id: `rollback-${playbook.id}`,
            phase: 'rollback',
            title: `Rolling back ${playbook.title}`,
            name: rollbackPath
          })
        }
      }
    }

    if (rollbackQueue.length === 0) {
      console.log('No components to rollback')
      return
    }

    // Execute rollback playbooks
    dispatch({ type: 'INIT_QUEUE', queue: rollbackQueue })
    dispatch({ type: 'START_PLAYBOOK', index: 0 })
  }

  // Download all logs
  const downloadLogs = () => {
    if (state.logs.size === 0) {
      tkToast.error('No logs available to download')
      return
    }

    let allLogs = ''
    state.logs.forEach((log, playbookId) => {
      allLogs += `\n\n=== ${playbookId} (${log.status}) ===\n`
      allLogs += `Timestamp: ${log.timestamp.toISOString()}\n`
      allLogs += log.logs
    })

    if (!allLogs.trim()) {
      tkToast.error('Logs are empty')
      return
    }

    const blob = new Blob([allLogs], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `thinkube-deploy-logs-${new Date().toISOString()}.txt`
    a.click()
    URL.revokeObjectURL(url)
    tkToast.success('Logs downloaded successfully!')
  }

  // Initialize on mount
  useEffect(() => {
    const init = async () => {
      const queue = await buildQueue()
      dispatch({ type: 'INIT_QUEUE', queue })
      // Auto-start first playbook
      setTimeout(() => {
        dispatch({ type: 'START_PLAYBOOK', index: 0 })
      }, 500)
    }
    init()
  }, [])

  // Execute playbook when index changes
  useEffect(() => {
    if (state.status === 'running' && state.queue[state.currentIndex]) {
      const playbook = state.queue[state.currentIndex]
      currentLogsRef.current = '' // Reset logs for new playbook
      setTimeout(() => executePlaybook(playbook), 200)
    }
  }, [state.currentIndex, state.status])

  // Derive subway steps - use playbook titles + final "Complete" step
  const playbookTitles = [...state.queue.map(p => p.title), 'Deployment Complete']
  const currentPlaybookNumber = state.status === 'complete'
    ? state.queue.length + 1
    : state.currentIndex + 1

  // Copy logs to clipboard
  const copyLogs = () => {
    let allLogs = ''
    state.logs.forEach((log, playbookId) => {
      allLogs += `\n\n=== ${playbookId} (${log.status}) ===\n`
      allLogs += `Timestamp: ${log.timestamp.toISOString()}\n`
      allLogs += log.logs
    })

    navigator.clipboard.writeText(allLogs)
      .then(() => tkToast.success('All logs copied to clipboard!'))
      .catch(err => tkToast.error('Failed to copy logs: ' + err))
  }

  // Copy only the failed playbook logs
  const copyFailedLog = () => {
    if (!state.failedPlaybook) {
      tkToast.error('No failed playbook found')
      return
    }

    const log = state.logs.get(state.failedPlaybook.id)
    if (!log) {
      tkToast.error(`No log found for playbook: ${state.failedPlaybook.id}`)
      console.error('Available log keys:', Array.from(state.logs.keys()))
      console.error('Looking for:', state.failedPlaybook.id)
      return
    }

    if (!log.logs || !log.logs.trim()) {
      tkToast.error('Failed playbook log is empty')
      return
    }

    const failedLog = `=== ${state.failedPlaybook.title} (FAILED) ===
Playbook ID: ${state.failedPlaybook.id}
Timestamp: ${log.timestamp.toISOString()}
Error: ${state.error}

${log.logs}`

    navigator.clipboard.writeText(failedLog)
      .then(() => tkToast.success('Failed playbook log copied to clipboard!'))
      .catch(err => tkToast.error('Failed to copy log: ' + err))
  }

  return (
    <div className="container mx-auto px-6 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Deploying Thinkube Infrastructure</h1>
      </div>

      {/* Subway Progress */}
      <TkCard className="mb-6">
        <TkCardContent className="pt-6">
          <TkSubwayProgress
            steps={playbookTitles}
            current={currentPlaybookNumber}
            isRunning={state.status === 'running'}
          />
        </TkCardContent>
      </TkCard>

      {/* Current Playbook Execution (inline) */}
      {state.status === 'running' && state.queue[state.currentIndex] && (
        <TkCard className="mb-6">
          <TkCardContent className="pt-6">
            <h2 className="text-xl font-semibold mb-4">
              {state.queue[state.currentIndex].title}
            </h2>
            <PlaybookExecutorStream
              ref={executorRef}
              title={state.queue[state.currentIndex].title}
              playbookName={state.queue[state.currentIndex].name}
              onComplete={handlePlaybookComplete}
            />
          </TkCardContent>
        </TkCard>
      )}

      {/* Error State */}
      {state.status === 'failed' && (
        <TkAlert variant="destructive" className="mb-6">
          <AlertCircle className="h-4 w-4" />
          <TkAlertDescription>
            <div className="mb-4">
              <strong>Deployment Failed</strong>
              <p>{state.error}</p>
              <p className="text-sm mt-2">Failed at: {state.failedPlaybook?.title}</p>
            </div>
            <div className="flex gap-2">
              <TkButton size="sm" onClick={handleRetry}>
                Retry
              </TkButton>
              <TkButton size="sm" variant="outline" onClick={handleRollback}>
                Rollback
              </TkButton>
              <TkButton size="sm" variant="ghost" onClick={copyFailedLog}>
                <Copy className="w-4 h-4 mr-2" />
                Copy Failed Log
              </TkButton>
              <TkButton size="sm" variant="ghost" onClick={downloadLogs}>
                <Download className="w-4 h-4 mr-2" />
                Download All Logs
              </TkButton>
            </div>
          </TkAlertDescription>
        </TkAlert>
      )}

      {/* Complete State */}
      {state.status === 'complete' && (
        <TkCard className="mb-6">
          <TkCardContent className="pt-6 text-center">
            <PartyPopper className="w-24 h-24 text-teal-500 mb-6 mx-auto" />
            <h2 className="text-2xl font-bold mb-4">Deployment Complete!</h2>
            <p className="mb-6">Your Thinkube infrastructure has been successfully deployed.</p>
            <div className="flex justify-center gap-2">
              <TkButton onClick={() => navigate('/complete')}>
                View Cluster Details
              </TkButton>
              <TkButton variant="outline" onClick={copyLogs}>
                <Copy className="w-4 h-4 mr-2" />
                Copy Logs
              </TkButton>
              <TkButton variant="outline" onClick={downloadLogs}>
                <Download className="w-4 h-4 mr-2" />
                Download Logs
              </TkButton>
            </div>
          </TkCardContent>
        </TkCard>
      )}
    </div>
  )
}
