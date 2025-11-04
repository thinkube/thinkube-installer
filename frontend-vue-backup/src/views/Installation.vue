/*
 * Copyright 2025 Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

<template>
  <div class="max-w-4xl mx-auto">
    <h1 class="text-3xl font-bold mb-6">Installation Progress</h1>
    
    <!-- Progress Overview -->
    <div class="card bg-base-100 shadow-xl mb-6">
      <div class="card-body">
        <div class="flex justify-between items-center mb-4">
          <div>
            <div class="flex items-center gap-3">
              <div class="badge" :class="getPhaseClass(status.phase)">
                {{ status.phase }}
              </div>
              <span class="text-lg font-semibold">{{ status.current_task }}</span>
            </div>
          </div>
          <div class="text-4xl font-bold text-primary">{{ status.progress }}%</div>
        </div>

        <progress class="progress progress-primary w-full" :value="status.progress" max="100"></progress>
      </div>
    </div>

    <!-- Installation Logs -->
    <div class="card bg-base-100 shadow-xl">
      <div class="card-body">
        <div class="flex items-center justify-between mb-4">
          <h2 class="card-title">Installation Logs</h2>
          <label class="label cursor-pointer gap-2">
            <span class="label-text text-xs">Auto-scroll</span>
            <input type="checkbox" v-model="autoScroll" class="checkbox checkbox-xs" />
          </label>
        </div>

        <div
          class="mockup-code h-96 overflow-y-auto text-xs"
          ref="logContainer"
        >
          <div v-if="status.logs.length === 0" class="text-base-content text-opacity-50">
            <pre data-prefix="$"><code>Waiting for output...</code></pre>
          </div>
          <pre
            v-for="(log, index) in status.logs"
            :key="index"
            :data-prefix="getLogPrefix(log)"
            :class="getLogClass(log)"
          ><code>{{ log }}</code></pre>
          <pre
            v-for="(error, index) in status.errors"
            :key="`error-${index}`"
            data-prefix="!"
            class="text-error font-semibold"
          ><code>ERROR: {{ error }}</code></pre>
        </div>
      </div>
    </div>

    <!-- Completion Actions -->
    <div v-if="isComplete" class="mt-6">
      <div v-if="status.phase === 'failed'" class="alert alert-error mb-4">
        <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span>Installation failed. Please check the logs for details.</span>
      </div>
      
      <button 
        class="btn btn-primary btn-block btn-lg gap-2"
        @click="continueNext"
      >
        {{ skipConfigMode ? 'Continue to Deployment' : 'Continue to Server Discovery' }}
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
        </svg>
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()

// Check if we're in skip-config mode
const skipConfigMode = sessionStorage.getItem('skipConfigMode') === 'true'

const status = ref({
  phase: 'starting',
  progress: 0,
  current_task: 'Initializing installation...',
  logs: [],
  errors: []
})

const logContainer = ref(null)
const autoScroll = ref(true)
let ws = null

const isComplete = computed(() => 
  status.value.phase === 'completed' || status.value.phase === 'failed'
)

const getPhaseClass = (phase) => {
  const classes = {
    idle: 'badge-ghost',
    starting: 'badge-info',
    running: 'badge-primary',
    completed: 'badge-success',
    failed: 'badge-error'
  }
  return classes[phase] || 'badge-ghost'
}

const getLogPrefix = (log) => {
  // Determine prefix based on log content
  if (log.includes('ERROR') || log.includes('failed')) return '✗'
  if (log.includes('WARNING')) return '!'
  if (log.includes('INSTALLER_STATUS')) return '>'
  if (log.includes('✅') || log.includes('complete')) return '✓'
  return '$'
}

const getLogClass = (log) => {
  // Add color classes based on log content
  if (log.includes('ERROR') || log.includes('failed')) return 'text-error font-semibold'
  if (log.includes('WARNING')) return 'text-warning'
  if (log.includes('INSTALLER_STATUS')) return 'text-info'
  if (log.includes('✅') || log.includes('complete')) return 'text-success'
  return 'text-base-content'
}

const connectWebSocket = () => {
  // In Tauri, we need to connect directly to localhost:8000
  // Tauri v2 uses tauri: protocol, not window.__TAURI__
  const isTauri = window.location.protocol === 'tauri:'

  // Determine WebSocket base URL
  let wsBase
  if (isTauri) {
    // Tauri app - always connect to localhost:8000
    wsBase = 'ws://localhost:8000'
  } else if (window.location.hostname === 'localhost' && window.location.port === '5173') {
    // Development mode (Vite dev server)
    wsBase = 'ws://localhost:8000'
  } else {
    // Production web deployment
    wsBase = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`
  }

  console.log('WebSocket base URL:', wsBase, 'isTauri:', isTauri)

  // Try /ws first, then /api/ws
  let wsUrl = `${wsBase}/ws`
  let retryWithApi = true
  
  const createConnection = (url) => {
    console.log('Connecting to WebSocket:', url)
    ws = new WebSocket(url)
    
    ws.onopen = () => {
      console.log('WebSocket connected successfully')
      retryWithApi = false
    }
    
    ws.onmessage = (event) => {
      console.log('WebSocket message received:', event.data)
      const data = JSON.parse(event.data)
      status.value = data
      console.log('Status updated:', status.value)
    }
    
    ws.onerror = (error) => {
      console.error('WebSocket error:', error)
      if (retryWithApi && url.endsWith('/ws')) {
        // Try /api/ws endpoint
        retryWithApi = false
        wsUrl = `${wsBase}/api/ws`
        createConnection(wsUrl)
      }
    }
    
    ws.onclose = () => {
      // Reconnect after 5 seconds if not complete
      if (!isComplete.value) {
        setTimeout(() => createConnection(wsUrl), 5000)
      }
    }
  }
  
  createConnection(wsUrl)
}

watch(() => status.value.logs.length, async () => {
  if (autoScroll.value && logContainer.value) {
    await nextTick()
    logContainer.value.scrollTop = logContainer.value.scrollHeight
  }
})

const continueNext = () => {
  if (skipConfigMode) {
    router.push('/deploy')
  } else {
    router.push('/server-discovery')
  }
}

onMounted(() => {
  connectWebSocket()
})

onUnmounted(() => {
  if (ws) {
    ws.close()
  }
})
</script>

<style scoped>
/* Custom scrollbar for log container */
.overflow-y-auto::-webkit-scrollbar {
  width: 8px;
}

.overflow-y-auto::-webkit-scrollbar-track {
  background: rgba(0, 0, 0, 0.2);
  border-radius: 4px;
}

.overflow-y-auto::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.3);
  border-radius: 4px;
}

.overflow-y-auto::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.5);
}

/* Override mockup-code background for better contrast */
.mockup-code {
  background-color: #1a1a1a !important;
  color: #e0e0e0 !important;
}

.mockup-code pre {
  color: inherit !important;
}

.mockup-code code {
  color: inherit !important;
  background: transparent !important;
}

/* Ensure prefix symbols are visible */
.mockup-code pre::before {
  color: #666 !important;
}

/* Adjust semantic colors for dark background */
.mockup-code .text-info {
  color: #60a5fa !important; /* Bright blue */
}

.mockup-code .text-success {
  color: #4ade80 !important; /* Bright green */
}

.mockup-code .text-warning {
  color: #fbbf24 !important; /* Bright yellow */
}

.mockup-code .text-error {
  color: #f87171 !important; /* Bright red */
}

.mockup-code .text-base-content {
  color: #e0e0e0 !important; /* Light gray for regular text */
}
</style>