/*
 * Copyright 2025 Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

<template>
  <div class="flex gap-4 h-screen p-4">
    <!-- Debug Sidebar (Fixed, Always Visible) -->
    <div class="w-80 flex-shrink-0">
      <div class="card bg-warning bg-opacity-10 border-2 border-warning shadow-xl sticky top-4">
        <div class="card-body p-4">
          <h2 class="card-title text-warning text-sm">Debug Info</h2>
          <div class="space-y-1 text-xs font-mono">
            <div><strong>Queue:</strong> {{ debugInfo.queueBuilt ? 'Yes' : 'No' }}</div>
            <div><strong>Total:</strong> {{ debugInfo.queueLength }}</div>
            <div><strong>Start:</strong> {{ debugInfo.startIndex }}</div>
            <div><strong>Current:</strong> {{ debugInfo.currentIndex }}</div>
            <div><strong>ID:</strong> {{ debugInfo.currentPlaybookId || 'None' }}</div>
            <div class="mt-2">
              <strong>Queue:</strong>
              <div class="max-h-96 overflow-y-auto bg-base-200 p-1 rounded mt-1 text-xs">
                <div v-for="(id, idx) in debugInfo.queueIds" :key="idx"
                     :class="{ 'text-success font-bold': idx === debugInfo.currentIndex, 'text-base-content opacity-50': idx < debugInfo.currentIndex }">
                  {{ idx }}: {{ id }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Main Content Area -->
    <div class="flex-1 overflow-y-auto">
      <div class="flex justify-between items-center mb-6">
        <h1 class="text-3xl font-bold">Deploying Thinkube Infrastructure</h1>
        <button
          class="btn btn-ghost btn-sm gap-2"
          @click="resetDeployment"
          title="Start over from configuration"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
          </svg>
          Reset
        </button>
      </div>

    <!-- Deployment Progress Overview -->
    <div class="card bg-base-100 shadow-xl mb-6">
      <div class="card-body">
        <h2 class="card-title mb-4">Deployment Progress</h2>

        <!-- Phase Indicators -->
        <div class="flex flex-wrap gap-2 mb-6">
          <div v-for="(phase, index) in deploymentPhases" :key="phase.id"
               class="badge gap-2"
               :class="getPhaseClass(phase)">
            <svg v-if="phase.status === 'completed'" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
            </svg>
            <svg v-else-if="phase.status === 'active'" class="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            {{ phase.name }}
          </div>
        </div>

        <progress class="progress progress-primary w-full" :value="overallProgress" max="100"></progress>
        <p class="text-sm text-center mt-2">{{ completedPlaybooks }} / {{ totalPlaybooks }} playbooks ({{ overallProgress }}%)</p>
      </div>
    </div>

    <!-- Current Playbook Execution -->
    <div v-if="currentPlaybook">
      <PlaybookExecutorStream
        ref="currentPlaybookExecutor"
        :key="currentPlaybook.id"
        :title="currentPlaybook.title"
        :playbook-name="currentPlaybook.name"
        :extra-vars="currentPlaybook.extraVars"
        :test-mode="testMode"
        :on-retry="retryCurrentPlaybook"
        @complete="handlePlaybookComplete"
        @continue="handlePlaybookContinue"
        @test-playbook="runTestPlaybook"
        @rollback="runRollbackPlaybook"
      />
    </div>

    <!-- Test Mode Control Buttons -->
    <div v-if="testMode && !currentPlaybook && !deploymentComplete" class="card bg-base-100 shadow-xl mb-6">
      <div class="card-body">
        <h2 class="card-title">🧪 Test Mode Controls</h2>
        <div class="flex gap-2">
          <button
            class="btn btn-primary"
            @click="handlePlaybookContinue"
            :disabled="!canContinue"
          >
            Next Playbook
          </button>
          <button
            class="btn btn-info"
            @click="runTestPlaybook"
          >
            Run Test (18)
          </button>
          <button
            class="btn btn-warning"
            @click="runRollbackPlaybook"
          >
            Rollback (19)
          </button>
        </div>
      </div>
    </div>

    <!-- Completion -->
    <div v-if="deploymentComplete" class="card bg-base-100 shadow-xl">
      <div class="card-body text-center">
        <div class="text-6xl mb-4">🎉</div>
        <h2 class="card-title justify-center mb-4">Deployment Complete!</h2>
        <p class="mb-6">Your Thinkube infrastructure has been successfully deployed.</p>
        <button
          class="btn btn-primary btn-lg gap-2"
          @click="$router.push('/complete')"
        >
          View Cluster Details
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7l5 5m0 0l-5 5m5-5H6"></path>
          </svg>
        </button>
      </div>
    </div>

    <!-- Error State -->
    <div v-if="deploymentError" class="alert alert-error">
      <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <div>
        <h3 class="font-bold">Deployment Failed</h3>
        <p>{{ deploymentError }}</p>
        <div class="flex gap-2 mt-2">
          <button class="btn btn-sm btn-outline" @click="retryCurrentPlaybook">Retry</button>
          <button class="btn btn-sm btn-ghost" @click="resetDeployment">Reset & Start Over</button>
        </div>
      </div>
    </div>
    </div>  <!-- End Main Content Area -->
  </div>  <!-- End Flex Container -->
</template>

<script setup>
import { ref, computed, onMounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import PlaybookExecutorStream from '@/components/PlaybookExecutorStream.vue'
import { isTestMode, shouldEnableShellConfig } from '@/utils/configFlags'

const router = useRouter()

// Deployment phases
const deploymentPhases = ref([
  { id: 'initial', name: 'Initial Setup', status: 'pending' },
  { id: 'kubernetes', name: 'Kubernetes', status: 'pending' }
])

// In-memory state (no persistence)
const playbookQueue = ref([])
const currentPlaybookIndex = ref(0)
const completedPlaybooks = ref(0)
const totalPlaybooks = ref(0)

// Debug info
const debugInfo = ref({
  queueBuilt: false,
  queueLength: 0,
  queueIds: [],
  startIndex: 0,
  currentIndex: 0,
  currentPlaybookId: null
})

// State variables
const currentPlaybook = ref(null)
const currentPhase = ref(null)
const deploymentComplete = ref(false)
const deploymentError = ref('')
const testMode = ref(false)

// Component refs
const currentPlaybookExecutor = ref(null)

// Progress tracking
const overallProgress = computed(() => {
  if (totalPlaybooks.value === 0) return 0
  return Math.round((completedPlaybooks.value / totalPlaybooks.value) * 100)
})

// Update phase statuses based on current playbook
const updatePhaseStatuses = () => {
  // Reset all phases to pending
  deploymentPhases.value.forEach(phase => {
    phase.status = 'pending'
  })

  // Mark completed phases
  const currentIdx = currentPlaybookIndex.value
  const queue = playbookQueue.value

  for (let i = 0; i < currentIdx && i < queue.length; i++) {
    const playbook = queue[i]
    const phase = deploymentPhases.value.find(p => p.id === playbook.phase)
    if (phase) {
      phase.status = 'completed'
    }
  }

  // Mark current phase as active
  if (currentPhase.value) {
    const phase = deploymentPhases.value.find(p => p.id === currentPhase.value)
    if (phase && phase.status === 'pending') {
      phase.status = 'active'
    }
  }
}

// Get phase class for styling
const getPhaseClass = (phase) => {
  switch (phase.status) {
    case 'completed': return 'badge-success'
    case 'active': return 'badge-warning'
    case 'failed': return 'badge-error'
    default: return 'badge-ghost'
  }
}

// Build playbook queue based on deployment type
const buildPlaybookQueue = async () => {
  const queue = []
  console.log('Building playbook queue...')

  // Load config from localStorage
  const config = JSON.parse(localStorage.getItem('thinkube-config') || '{}')

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
  console.log('🔍 DEBUG enableShellConfig:', enableShellConfig)
  if (enableShellConfig) {
    console.log('✅ Adding shell-setup playbook to queue')
    queue.push({
      id: 'shell-setup',
      phase: 'initial',
      title: 'Configuring Shell Environments',
      name: 'ansible/misc/00_setup_shells.yml'
    })
  } else {
    console.log('⏭️  Skipping shell-setup playbook')
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
  const clusterNodes = JSON.parse(sessionStorage.getItem('clusterNodes') || '[]')
  const hasWorkers = clusterNodes.some(n => n.role === 'worker')
  if (hasWorkers) {
    queue.push({
      id: 'k8s-join-workers',
      phase: 'kubernetes',
      title: 'Joining Worker Nodes to Cluster',
      name: 'ansible/40_thinkube/core/infrastructure/k8s/20_join_workers.yaml'
    })
  }

  // GPU operator if needed
  const serverHardware = JSON.parse(sessionStorage.getItem('serverHardware') || '[]')
  const needsGPUOperator = serverHardware.some(s => s.hardware?.gpu_detected)
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

  console.log('Final playbook queue:', queue.map(p => `${p.id}: ${p.title}`))
  console.log('Total playbooks in queue:', queue.length)

  // Capture debug info
  debugInfo.value.queueBuilt = true
  debugInfo.value.queueLength = queue.length
  debugInfo.value.queueIds = queue.map(p => p.id)

  return queue
}

// Execute next playbook in queue
const executeNextPlaybook = async () => {
  console.log('executeNextPlaybook called, current index:', currentPlaybookIndex.value)

  // Update debug info
  debugInfo.value.currentIndex = currentPlaybookIndex.value

  if (currentPlaybookIndex.value >= playbookQueue.value.length) {
    console.log('All playbooks completed!')
    deploymentComplete.value = true
    updatePhaseStatuses()
    return
  }

  const playbook = playbookQueue.value[currentPlaybookIndex.value]
  console.log('Next playbook:', playbook.id, '-', playbook.title)
  currentPlaybook.value = playbook
  debugInfo.value.currentPlaybookId = playbook.id

  // Update current phase
  if (currentPhase.value !== playbook.phase) {
    currentPhase.value = playbook.phase
  }

  updatePhaseStatuses()

  // Wait for component to mount
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 100))

  // Start playbook execution
  if (currentPlaybookExecutor.value?.startExecution) {
    const sudoPassword = sessionStorage.getItem('sudoPassword')

    currentPlaybookExecutor.value.startExecution({
      environment: {
        ANSIBLE_BECOME_PASSWORD: sudoPassword,
        ANSIBLE_SSH_PASSWORD: sudoPassword
      },
      extra_vars: playbook.extraVars || {}
    })
  } else {
    console.error('PlaybookExecutor not ready')
  }
}

// Handle playbook completion
const handlePlaybookComplete = async (result) => {
  console.log('Playbook complete:', currentPlaybook.value?.title, 'Result:', result.status)

  if (result.status === 'error' || result.status === 'failed' || result.status === 'cancelled') {
    deploymentError.value = `Playbook ${currentPlaybook.value.title} failed: ${result.message || 'Check the logs'}`
    return
  }

  // Success - clear any previous error
  deploymentError.value = ''

  // Handle test/rollback playbooks differently (they're outside the queue)
  const isTest = currentPlaybook.value?.id === 'test-18'
  const isRollback = currentPlaybook.value?.id === 'rollback-19'

  if (isTest) {
    // Test playbook - don't advance queue, allows continuing to next playbook
    console.log('Test playbook succeeded, queue index unchanged')
  } else if (isRollback) {
    // Rollback playbook - move back one step to retry the rolled-back playbook
    if (currentPlaybookIndex.value > 0) {
      currentPlaybookIndex.value--
      completedPlaybooks.value--
    }
    console.log('Rollback playbook succeeded, moved back to retry previous playbook')
  } else {
    // Normal playbook - increment completed counter only (index incremented in Continue handler)
    completedPlaybooks.value++
    console.log('Main playbook succeeded')
  }
}

// Handle user clicking Continue
const handlePlaybookContinue = () => {
  console.log('User clicked Continue - advancing to next playbook')
  currentPlaybook.value = null
  currentPlaybookIndex.value++
  executeNextPlaybook()
}

// Test mode functions
const canContinue = computed(() => {
  return !currentPlaybook.value && !deploymentComplete.value && currentPlaybookIndex.value < playbookQueue.value.length
})

const runTestPlaybook = async () => {
  console.log('🧪 Running test playbook 18...')
  currentPlaybook.value = {
    id: 'test-18',
    title: 'Test Deployment (18)',
    name: 'ansible/40_thinkube/core/thinkube-control/18_test.yaml',
    phase: 'test'
  }
  await nextTick()

  const sudoPassword = sessionStorage.getItem('sudoPassword')
  currentPlaybookExecutor.value?.startExecution({
    environment: {
      ANSIBLE_BECOME_PASSWORD: sudoPassword,
      ANSIBLE_SSH_PASSWORD: sudoPassword
    }
  })
}

const runRollbackPlaybook = async () => {
  console.log('🔄 Running rollback playbook 19...')
  currentPlaybook.value = {
    id: 'rollback-19',
    title: 'Rollback Deployment (19)',
    name: 'ansible/40_thinkube/core/thinkube-control/19_rollback.yaml',
    phase: 'rollback'
  }
  await nextTick()

  const sudoPassword = sessionStorage.getItem('sudoPassword')
  currentPlaybookExecutor.value?.startExecution({
    environment: {
      ANSIBLE_BECOME_PASSWORD: sudoPassword,
      ANSIBLE_SSH_PASSWORD: sudoPassword
    }
  })
}

// Retry current playbook
const retryCurrentPlaybook = () => {
  deploymentError.value = ''

  if (currentPlaybookExecutor.value?.startExecution) {
    const sudoPassword = sessionStorage.getItem('sudoPassword')
    currentPlaybookExecutor.value.startExecution({
      environment: {
        ANSIBLE_BECOME_PASSWORD: sudoPassword,
        ANSIBLE_SSH_PASSWORD: sudoPassword
      },
      extra_vars: currentPlaybook.value?.extraVars || {}
    })
  }
}

// Reset deployment
const resetDeployment = () => {
  router.push('/configuration')
}

// Start deployment on mount
onMounted(async () => {
  console.log('Deploy component mounted - starting fresh deployment')

  // Check test mode
  testMode.value = await isTestMode()
  if (testMode.value) {
    console.log('🧪 Test mode enabled - manual playbook control')
  }

  // Build queue
  const queue = await buildPlaybookQueue()
  playbookQueue.value = queue
  totalPlaybooks.value = queue.length
  currentPlaybookIndex.value = 0
  completedPlaybooks.value = 0

  // Capture start index in debug info
  debugInfo.value.startIndex = 0

  // Start deployment
  setTimeout(() => {
    executeNextPlaybook()
  }, 500)
})
</script>

<style scoped>
/* Custom styles for deployment view */
</style>
