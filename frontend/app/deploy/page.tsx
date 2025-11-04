/*
 * Copyright 2025 Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

"use client"

import { useState, useEffect, useMemo } from "react"
import { useRouter } from "next/navigation"
import { TkCard, TkCardContent, TkCardHeader, TkCardTitle } from "thinkube-style/components/cards-data"
import { TkButton } from "thinkube-style/components/buttons-badges"
import { TkBadge } from "thinkube-style/components/buttons-badges"
import { TkProgress } from "thinkube-style/components/feedback"
import { RotateCcw, Check, Loader2, ArrowRight, PartyPopper } from "lucide-react"
import { PlaybookExecutorStream } from "@/components/PlaybookExecutorStream"

interface DeploymentPhase {
  id: string
  name: string
  status: 'pending' | 'active' | 'completed' | 'failed'
}

interface Playbook {
  id: string
  phase: string
  title: string
  name: string
  extraVars?: Record<string, any>
}

interface DebugInfo {
  queueBuilt: boolean
  queueLength: number
  queueIds: string[]
  startIndex: number
  currentIndex: number
  currentPlaybookId: string | null
}

interface PlaybookExecutorRef {
  startExecution: (params: any) => void
}

export default function Deploy() {
  const router = useRouter()

  // Deployment phases
  const [deploymentPhases, setDeploymentPhases] = useState<DeploymentPhase[]>([
    { id: 'initial', name: 'Initial Setup', status: 'pending' },
    { id: 'kubernetes', name: 'Kubernetes', status: 'pending' }
  ])

  // In-memory state (no persistence)
  const [playbookQueue, setPlaybookQueue] = useState<Playbook[]>([])
  const [currentPlaybookIndex, setCurrentPlaybookIndex] = useState(0)
  const [completedPlaybooks, setCompletedPlaybooks] = useState(0)
  const [totalPlaybooks, setTotalPlaybooks] = useState(0)

  // Debug info
  const [debugInfo, setDebugInfo] = useState<DebugInfo>({
    queueBuilt: false,
    queueLength: 0,
    queueIds: [],
    startIndex: 0,
    currentIndex: 0,
    currentPlaybookId: null
  })

  // State variables
  const [currentPlaybook, setCurrentPlaybook] = useState<Playbook | null>(null)
  const [currentPhase, setCurrentPhase] = useState<string | null>(null)
  const [deploymentComplete, setDeploymentComplete] = useState(false)
  const [deploymentError, setDeploymentError] = useState('')
  const [testMode, setTestMode] = useState(false)

  // Component refs
  const [currentPlaybookExecutor, setCurrentPlaybookExecutor] = useState<PlaybookExecutorRef | null>(null)

  // TkProgress tracking
  const overallProgress = useMemo(() => {
    if (totalPlaybooks === 0) return 0
    return Math.round((completedPlaybooks / totalPlaybooks) * 100)
  }, [completedPlaybooks, totalPlaybooks])

  // Update phase statuses based on current playbook
  const updatePhaseStatuses = () => {
    setDeploymentPhases(prevPhases => {
      const newPhases: DeploymentPhase[] = prevPhases.map(phase => ({
        ...phase,
        status: 'pending' as 'pending' | 'active' | 'completed' | 'failed'
      }))

      // Mark completed phases
      const currentIdx = currentPlaybookIndex
      const queue = playbookQueue

      for (let i = 0; i < currentIdx && i < queue.length; i++) {
        const playbook = queue[i]
        const phaseIdx = newPhases.findIndex(p => p.id === playbook.phase)
        if (phaseIdx !== -1) {
          newPhases[phaseIdx].status = 'completed'
        }
      }

      // Mark current phase as active
      if (currentPhase) {
        const phaseIdx = newPhases.findIndex(p => p.id === currentPhase)
        if (phaseIdx !== -1 && newPhases[phaseIdx].status === 'pending') {
          newPhases[phaseIdx].status = 'active'
        }
      }

      return newPhases
    })
  }

  // Get phase class for styling
  const getPhaseClass = (phase: DeploymentPhase) => {
    switch (phase.status) {
      case 'completed': return 'bg-success text-success-foreground'
      case 'active': return 'bg-warning text-warning-foreground'
      case 'failed': return 'bg-destructive text-destructive-foreground'
      default: return 'bg-muted text-muted-foreground'
    }
  }

  // Build playbook queue based on deployment type
  const buildPlaybookQueue = async () => {
    const queue: Playbook[] = []

    // Load config from localStorage (client-side only)
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

    // Add shell configuration (optional, controlled by TK_SHELL_CONFIG=1)
    const enableShellConfig = await shouldEnableShellConfig()
    if (enableShellConfig) {
      queue.push({
        id: 'shell-setup',
        phase: 'initial',
        title: 'Configuring Shell Environments',
        name: 'ansible/misc/00_setup_shells.yml'
      })
    }

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

    // Capture debug info
    setDebugInfo({
      queueBuilt: true,
      queueLength: queue.length,
      queueIds: queue.map(p => p.id),
      startIndex: 0,
      currentIndex: 0,
      currentPlaybookId: null
    })

    return queue
  }

  // Execute next playbook in queue
  const executeNextPlaybook = async () => {
    // Update debug info
    setDebugInfo(prev => ({
      ...prev,
      currentIndex: currentPlaybookIndex
    }))

    if (currentPlaybookIndex >= playbookQueue.length) {
      setDeploymentComplete(true)
      updatePhaseStatuses()
      return
    }

    const playbook = playbookQueue[currentPlaybookIndex]
    setCurrentPlaybook(playbook)
    setDebugInfo(prev => ({
      ...prev,
      currentPlaybookId: playbook.id
    }))

    // Update current phase
    if (currentPhase !== playbook.phase) {
      setCurrentPhase(playbook.phase)
    }

    updatePhaseStatuses()

    // Wait for component to mount
    await new Promise(resolve => setTimeout(resolve, 100))

    // Start playbook execution
    if (currentPlaybookExecutor?.startExecution) {
      const sudoPassword = sessionStorage.getItem('sudoPassword')

      currentPlaybookExecutor.startExecution({
        environment: {
          ANSIBLE_BECOME_PASSWORD: sudoPassword,
          ANSIBLE_SSH_PASSWORD: sudoPassword
        },
        extra_vars: playbook.extraVars || {}
      })
    }
  }

  // Handle playbook completion
  const handlePlaybookComplete = async (result: any) => {
    if (result.status === 'error' || result.status === 'failed' || result.status === 'cancelled') {
      setDeploymentError(`Playbook ${currentPlaybook?.title} failed: ${result.message || 'Check the logs'}`)
      return
    }

    // Success - clear any previous error
    setDeploymentError('')

    // Handle test/rollback playbooks differently (they're outside the queue)
    const isTest = currentPlaybook?.id === 'test-18'
    const isRollback = currentPlaybook?.id === 'rollback-19'

    if (isTest) {
      // Test playbook - don't advance queue, allows continuing to next playbook
    } else if (isRollback) {
      // Rollback playbook - move back one step to retry the rolled-back playbook
      if (currentPlaybookIndex > 0) {
        setCurrentPlaybookIndex(prev => prev - 1)
        setCompletedPlaybooks(prev => prev - 1)
      }
    } else {
      // Normal playbook - increment completed counter only (index incremented in Continue handler)
      setCompletedPlaybooks(prev => prev + 1)
    }
  }

  // Handle user clicking Continue
  const handlePlaybookContinue = () => {
    setCurrentPlaybook(null)
    setCurrentPlaybookIndex(prev => prev + 1)
    executeNextPlaybook()
  }

  // Test mode functions
  const canContinue = useMemo(() => {
    return !currentPlaybook && !deploymentComplete && currentPlaybookIndex < playbookQueue.length
  }, [currentPlaybook, deploymentComplete, currentPlaybookIndex, playbookQueue.length])

  const runTestPlaybook = async () => {
    setCurrentPlaybook({
      id: 'test-18',
      title: 'Test Deployment (18)',
      name: 'ansible/40_thinkube/core/thinkube-control/18_test.yaml',
      phase: 'test'
    })
    await new Promise(resolve => setTimeout(resolve, 0))

    const sudoPassword = sessionStorage.getItem('sudoPassword')
    currentPlaybookExecutor?.startExecution({
      environment: {
        ANSIBLE_BECOME_PASSWORD: sudoPassword,
        ANSIBLE_SSH_PASSWORD: sudoPassword
      }
    })
  }

  const runRollbackPlaybook = async () => {
    setCurrentPlaybook({
      id: 'rollback-19',
      title: 'Rollback Deployment (19)',
      name: 'ansible/40_thinkube/core/thinkube-control/19_rollback.yaml',
      phase: 'rollback'
    })
    await new Promise(resolve => setTimeout(resolve, 0))

    const sudoPassword = sessionStorage.getItem('sudoPassword')
    currentPlaybookExecutor?.startExecution({
      environment: {
        ANSIBLE_BECOME_PASSWORD: sudoPassword,
        ANSIBLE_SSH_PASSWORD: sudoPassword
      }
    })
  }

  // Retry current playbook
  const retryCurrentPlaybook = () => {
    setDeploymentError('')

    if (currentPlaybookExecutor?.startExecution) {
      const sudoPassword = sessionStorage.getItem('sudoPassword')
      currentPlaybookExecutor.startExecution({
        environment: {
          ANSIBLE_BECOME_PASSWORD: sudoPassword,
          ANSIBLE_SSH_PASSWORD: sudoPassword
        },
        extra_vars: currentPlaybook?.extraVars || {}
      })
    }
  }

  // Reset deployment
  const resetDeployment = () => {
    router.push('/configuration')
  }

  // Helper function to check test mode
  const isTestMode = async () => {
    // Implementation would check for test mode flag
    return false
  }

  // Helper function to check shell config
  const shouldEnableShellConfig = async () => {
    // Implementation would check TK_SHELL_CONFIG environment variable
    return false
  }

  // Start deployment on mount
  const [initialized, setInitialized] = useState(false)

  useEffect(() => {
    const initDeployment = async () => {
      // Check test mode
      const testModeEnabled = await isTestMode()
      setTestMode(testModeEnabled)

      // Build queue
      const queue = await buildPlaybookQueue()
      setPlaybookQueue(queue)
      setTotalPlaybooks(queue.length)
      setCurrentPlaybookIndex(0)
      setCompletedPlaybooks(0)

      // Capture start index in debug info
      setDebugInfo(prev => ({
        ...prev,
        startIndex: 0
      }))

      // Mark as initialized - this will trigger execution in separate useEffect
      setInitialized(true)
    }

    initDeployment()
  }, [])

  // Start execution after queue is initialized (only once)
  useEffect(() => {
    if (initialized && playbookQueue.length > 0 && currentPlaybookIndex === 0 && !currentPlaybook) {
      setTimeout(() => {
        executeNextPlaybook()
      }, 500)
    }
  }, [initialized, playbookQueue.length])

  // Update phase statuses when dependencies change
  useEffect(() => {
    updatePhaseStatuses()
  }, [currentPlaybookIndex, currentPhase])

  return (
    <div className="h-screen p-4">
      <div className="w-full overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold">Deploying Thinkube Infrastructure</h1>
          <TkButton
            variant="ghost"
            size="sm"
            onClick={resetDeployment}
            title="Start over from configuration"
          >
            <RotateCcw className="w-4 h-4 mr-2" />
            Reset
          </TkButton>
        </div>

        {/* Deployment TkProgress Overview */}
        <TkCard className="mb-6">
          <TkCardContent className="pt-6">
            <h2 className="text-xl font-semibold mb-4">Deployment Progress</h2>

            {/* Phase Indicators */}
            <div className="flex flex-wrap gap-2 mb-6">
              {deploymentPhases.map((phase) => (
                <TkBadge
                  key={phase.id}
                  className={getPhaseClass(phase)}
                >
                  {phase.status === 'completed' && (
                    <Check className="w-4 h-4 mr-1" />
                  )}
                  {phase.status === 'active' && (
                    <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                  )}
                  {phase.name}
                </TkBadge>
              ))}
            </div>

            <TkProgress value={overallProgress} className="w-full mb-2" />
            <p className="text-sm text-center text-muted-foreground">
              {completedPlaybooks} / {totalPlaybooks} playbooks ({overallProgress}%)
            </p>
          </TkCardContent>
        </TkCard>

        {/* Current Playbook Execution */}
        {currentPlaybook && (
          <PlaybookExecutorStream
            key={currentPlaybook.id}
            ref={setCurrentPlaybookExecutor}
            title={currentPlaybook.title}
            playbookName={currentPlaybook.name}
            extraVars={currentPlaybook.extraVars}
            testMode={testMode}
            onRetry={retryCurrentPlaybook}
            playbookQueue={playbookQueue}
            currentPlaybookIndex={currentPlaybookIndex}
            onComplete={handlePlaybookComplete}
            onContinue={handlePlaybookContinue}
            onTestPlaybook={runTestPlaybook}
            onRollback={runRollbackPlaybook}
          />
        )}

        {/* Test Mode Control Buttons */}
        {testMode && !currentPlaybook && !deploymentComplete && (
          <TkCard className="mb-6">
            <TkCardContent className="pt-6">
              <h2 className="text-xl font-semibold mb-4">Test Mode Controls</h2>
              <div className="flex gap-2">
                <TkButton
                  onClick={handlePlaybookContinue}
                  disabled={!canContinue}
                >
                  Next Playbook
                </TkButton>
                <TkButton
                  variant="outline"
                  className="bg-info text-info-foreground"
                  onClick={runTestPlaybook}
                >
                  Run Test (18)
                </TkButton>
                <TkButton
                  variant="outline"
                  className="bg-warning text-warning-foreground"
                  onClick={runRollbackPlaybook}
                >
                  Rollback (19)
                </TkButton>
              </div>
            </TkCardContent>
          </TkCard>
        )}

        {/* Completion */}
        {deploymentComplete && (
          <TkCard>
            <TkCardContent className="pt-6 text-center">
              <PartyPopper className="w-16 h-16 mx-auto mb-4 text-primary" />
              <h2 className="text-2xl font-bold mb-4">Deployment Complete!</h2>
              <p className="mb-6 text-muted-foreground">
                Your Thinkube infrastructure has been successfully deployed.
              </p>
              <TkButton
                size="lg"
                onClick={() => router.push('/complete')}
              >
                View Cluster Details
                <ArrowRight className="w-5 h-5 ml-2" />
              </TkButton>
            </TkCardContent>
          </TkCard>
        )}

        {/* Error State */}
        {deploymentError && (
          <div className="bg-destructive/10 border border-destructive text-destructive rounded-lg p-4 flex gap-3">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-6 w-6 shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <div className="flex-1">
              <h3 className="font-bold">Deployment Failed</h3>
              <p>{deploymentError}</p>
              <div className="flex gap-2 mt-2">
                <TkButton variant="outline" size="sm" onClick={retryCurrentPlaybook}>
                  Retry
                </TkButton>
                <TkButton variant="ghost" size="sm" onClick={resetDeployment}>
                  Reset & Start Over
                </TkButton>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
