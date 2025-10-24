/*
 * Copyright 2025 Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

<template>
  <div class="max-w-6xl mx-auto">
    <h1 class="text-3xl font-bold mb-6 text-base-content">GPU Driver Detection</h1>

    <!-- Loading state -->
    <div v-if="loading" class="flex flex-col items-center justify-center py-12">
      <span class="loading loading-spinner loading-lg"></span>
      <p class="mt-4 text-base-content">Detecting GPUs and drivers on all nodes...</p>
    </div>

    <!-- Error state -->
    <div v-else-if="error" class="alert alert-error mb-6">
      <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <span>{{ error }}</span>
    </div>

    <!-- Results -->
    <div v-else-if="nodes.length > 0">
      <!-- Summary card -->
      <div class="card bg-base-100 shadow-xl mb-6">
        <div class="card-body">
          <h2 class="card-title">Detection Summary</h2>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
            <div class="stat bg-base-200 rounded-lg">
              <div class="stat-title">Ready</div>
              <div class="stat-value text-success">{{ summary.ready }}</div>
              <div class="stat-desc">Compatible drivers</div>
            </div>
            <div class="stat bg-base-200 rounded-lg">
              <div class="stat-title">Need Install</div>
              <div class="stat-value text-warning">{{ summary.needs_install }}</div>
              <div class="stat-desc">No drivers found</div>
            </div>
            <div class="stat bg-base-200 rounded-lg">
              <div class="stat-title">Need Upgrade</div>
              <div class="stat-value text-error">{{ summary.needs_upgrade }}</div>
              <div class="stat-desc">Old drivers</div>
            </div>
            <div class="stat bg-base-200 rounded-lg">
              <div class="stat-title">No GPU</div>
              <div class="stat-value text-base-content">{{ summary.no_gpu }}</div>
              <div class="stat-desc">CPU only</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Nodes table -->
      <div class="card bg-base-100 shadow-xl mb-6">
        <div class="card-body">
          <h2 class="card-title mb-4">Node Details</h2>
          <div class="overflow-x-auto">
            <table class="table table-zebra">
              <thead>
                <tr>
                  <th>Node</th>
                  <th>GPU</th>
                  <th>Driver Version</th>
                  <th>Status</th>
                  <th>Action Required</th>
                  <th>Your Decision</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="node in nodes" :key="node.ip">
                  <td>
                    <div class="font-bold">{{ node.hostname }}</div>
                    <div class="text-sm opacity-50">{{ node.ip }}</div>
                  </td>
                  <td>
                    <div v-if="node.gpu_detected" class="flex items-center gap-2">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <div>
                        <div class="font-medium">{{ node.gpu_name }}</div>
                        <div class="text-xs opacity-50" v-if="node.gpu_count > 1">{{ node.gpu_count }} GPUs</div>
                      </div>
                    </div>
                    <div v-else class="text-base-content opacity-50">No GPU</div>
                  </td>
                  <td>
                    <span v-if="node.driver_version" class="badge badge-outline">{{ node.driver_version }}</span>
                    <span v-else class="text-base-content opacity-50">Not installed</span>
                  </td>
                  <td>
                    <span v-if="node.driver_status === 'compatible'" class="badge badge-success gap-2">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                      </svg>
                      Compatible
                    </span>
                    <span v-else-if="node.driver_status === 'old'" class="badge badge-error gap-2">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                      Old ({{ node.min_required_version }}+ required)
                    </span>
                    <span v-else-if="node.driver_status === 'missing'" class="badge badge-warning gap-2">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      Missing
                    </span>
                    <span v-else class="badge badge-ghost">{{ node.driver_status }}</span>
                  </td>
                  <td>
                    <span v-if="node.action_required === 'install'" class="text-warning">Install driver</span>
                    <span v-else-if="node.action_required === 'upgrade'" class="text-error">Upgrade driver</span>
                    <span v-else class="text-success">None</span>
                  </td>
                  <td>
                    <!-- Compatible drivers - no decision needed -->
                    <span v-if="node.driver_status === 'compatible'" class="text-success">✓ Ready for GPU</span>

                    <!-- No GPU detected - no decision needed -->
                    <span v-else-if="!node.gpu_detected" class="text-base-content opacity-50">CPU-only node</span>

                    <!-- Missing drivers - offer to install -->
                    <select
                      v-else-if="node.action_required === 'install'"
                      v-model="decisions[node.ip]"
                      class="select select-bordered select-sm"
                    >
                      <option value="">-- Choose action --</option>
                      <option value="install">Install drivers automatically</option>
                      <option value="exclude">Exclude from GPU (CPU-only)</option>
                    </select>

                    <!-- Old drivers - user must upgrade manually -->
                    <select
                      v-else-if="node.action_required === 'upgrade'"
                      v-model="decisions[node.ip]"
                      class="select select-bordered select-sm select-error"
                    >
                      <option value="">-- Choose action --</option>
                      <option value="abort">I will upgrade manually (abort)</option>
                      <option value="exclude">Exclude from GPU (CPU-only)</option>
                    </select>

                    <span v-else class="text-base-content opacity-50">N/A</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Warning for nodes needing manual upgrade -->
      <div v-if="summary.needs_upgrade > 0" class="alert alert-warning mb-6">
        <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <div>
          <h3 class="font-bold">Old NVIDIA Drivers Detected</h3>
          <div class="text-sm mt-1">
            Some nodes have NVIDIA drivers older than version 580.x. GPU Operator v25.3.4 requires driver 580.0 or newer.
            <br><br>
            <strong>To upgrade manually:</strong>
            <ol class="list-decimal list-inside mt-2 ml-4">
              <li>Download driver from: <a href="https://www.nvidia.com/download/index.aspx" target="_blank" class="link">nvidia.com/download</a></li>
              <li>SSH to the node and run: <code class="bg-base-300 px-2 py-1 rounded">sudo sh NVIDIA-Linux-x86_64-580.95.05.run --silent --dkms</code></li>
              <li>Verify with: <code class="bg-base-300 px-2 py-1 rounded">nvidia-smi</code></li>
              <li>Re-run the installer</li>
            </ol>
          </div>
        </div>
      </div>

      <!-- Final decision summary -->
      <div class="card bg-base-100 shadow-xl mb-6">
        <div class="card-body">
          <h2 class="card-title">Deployment Plan</h2>
          <div class="space-y-2 mt-4">
            <p><strong>{{ gpuEnabledCount }}</strong> node(s) will have GPU capabilities enabled</p>
            <p><strong>{{ cpuOnlyCount }}</strong> node(s) will be CPU-only</p>
            <p v-if="installCount > 0" class="text-warning">
              <strong>{{ installCount }}</strong> node(s) will have drivers installed automatically
            </p>
            <p v-if="abortCount > 0" class="text-error">
              <strong>Deployment will abort</strong> - you have chosen to upgrade drivers manually
            </p>
          </div>
        </div>
      </div>

      <!-- Navigation buttons -->
      <div class="flex justify-between mt-8">
        <button type="button" class="btn btn-outline" @click="goBack">
          Back
        </button>
        <button
          type="button"
          class="btn btn-primary"
          @click="continueToDeployment"
          :disabled="!canContinue"
        >
          {{ abortCount > 0 ? 'Abort Deployment' : 'Continue to Deployment' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import axios from 'axios'

const router = useRouter()

const loading = ref(true)
const error = ref('')
const nodes = ref([])
const summary = ref({
  ready: 0,
  needs_install: 0,
  needs_upgrade: 0,
  no_gpu: 0,
  error: 0
})

// User decisions for each node (keyed by IP)
const decisions = ref({})

onMounted(async () => {
  await detectGpuDrivers()
})

async function detectGpuDrivers() {
  try {
    loading.value = true
    error.value = ''

    // Load saved configuration
    const savedConfig = localStorage.getItem('thinkube-config')
    if (!savedConfig) {
      error.value = 'No configuration found. Please complete the Configuration screen first.'
      loading.value = false
      return
    }

    const config = JSON.parse(savedConfig)

    // Load discovered servers
    const discoveredServers = JSON.parse(localStorage.getItem('discoveredServers') || '[]')
    if (discoveredServers.length === 0) {
      error.value = 'No servers discovered. Please complete Server Discovery first.'
      loading.value = false
      return
    }

    // Prepare node list for detection
    const nodeList = discoveredServers.map(server => ({
      hostname: server.hostname || 'unknown',
      ip: server.ip,
      username: server.username,
      password: server.password,
      ssh_key: server.ssh_key
    }))

    // Call detection API
    const response = await axios.post('/api/gpu/detect-drivers', {
      nodes: nodeList
    })

    nodes.value = response.data.nodes
    summary.value = response.data.summary

    // Initialize decisions for nodes that need them
    nodes.value.forEach(node => {
      if (node.action_required === 'install' || node.action_required === 'upgrade') {
        decisions.value[node.ip] = ''
      }
    })

    loading.value = false
  } catch (e) {
    console.error('Error detecting GPU drivers:', e)
    error.value = e.response?.data?.detail || e.message || 'Failed to detect GPU drivers'
    loading.value = false
  }
}

// Computed: count nodes that need decisions
const nodesNeedingDecisions = computed(() => {
  return nodes.value.filter(node =>
    node.action_required === 'install' || node.action_required === 'upgrade'
  )
})

// Computed: check if all decisions are made
const allDecisionsMade = computed(() => {
  return nodesNeedingDecisions.value.every(node => decisions.value[node.ip])
})

// Computed: count nodes with each decision type
const installCount = computed(() => {
  return Object.values(decisions.value).filter(d => d === 'install').length
})

const abortCount = computed(() => {
  return Object.values(decisions.value).filter(d => d === 'abort').length
})

const excludeCount = computed(() => {
  return Object.values(decisions.value).filter(d => d === 'exclude').length
})

const gpuEnabledCount = computed(() => {
  // Nodes with compatible drivers + nodes where we'll install drivers
  return summary.value.ready + installCount.value
})

const cpuOnlyCount = computed(() => {
  // Nodes with no GPU + nodes excluded by user
  return summary.value.no_gpu + excludeCount.value
})

const canContinue = computed(() => {
  // Can continue if all decisions are made
  return allDecisionsMade.value
})

function goBack() {
  router.push('/configuration')
}

async function continueToDeployment() {
  if (!canContinue.value) {
    return
  }

  // If user chose to abort, show confirmation
  if (abortCount.value > 0) {
    const confirmed = confirm(
      'You have chosen to upgrade drivers manually. The deployment will not proceed.\n\n' +
      'After upgrading drivers on the affected nodes, please restart the installer.'
    )
    if (confirmed) {
      // Clear state and go back to welcome
      localStorage.removeItem('thinkube-config')
      localStorage.removeItem('discoveredServers')
      localStorage.removeItem('thinkube-deployment-state-v2')
      router.push('/')
    }
    return
  }

  try {
    // Build GPU node configuration based on decisions
    const gpuNodeConfig = nodes.value.map(node => {
      let gpu_enabled = true
      let driver_preinstalled = false
      let reason = null

      if (!node.gpu_detected) {
        gpu_enabled = false
        reason = 'No GPU detected'
      } else if (node.driver_status === 'compatible') {
        gpu_enabled = true
        driver_preinstalled = true
      } else if (decisions.value[node.ip] === 'install') {
        gpu_enabled = true
        driver_preinstalled = false // Will be installed by playbook
      } else if (decisions.value[node.ip] === 'exclude') {
        gpu_enabled = false
        reason = 'Excluded by user'
      }

      return {
        hostname: node.hostname,
        ip: node.ip,
        gpu_detected: node.gpu_detected,
        gpu_name: node.gpu_name,
        gpu_enabled,
        driver_preinstalled,
        driver_version: node.driver_version,
        needs_driver_install: decisions.value[node.ip] === 'install',
        reason
      }
    })

    // Save GPU configuration to localStorage
    const config = JSON.parse(localStorage.getItem('thinkube-config') || '{}')
    config.gpuNodes = gpuNodeConfig
    localStorage.setItem('thinkube-config', JSON.stringify(config))

    // Save GPU configuration to backend as well
    await axios.post('/api/save-configuration', {
      ...config,
      gpuNodes: gpuNodeConfig
    })

    // Continue to deployment
    router.push('/deploy')
  } catch (e) {
    console.error('Error saving GPU configuration:', e)
    error.value = e.response?.data?.detail || e.message || 'Failed to save GPU configuration'
  }
}
</script>
