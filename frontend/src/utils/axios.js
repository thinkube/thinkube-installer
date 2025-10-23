/*
 * Copyright 2025 Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import axios from 'axios'

// Configure axios defaults
const isTauri = window.__TAURI__ !== undefined || window.location.protocol === 'tauri:'
const baseURL = isTauri || (window.location.protocol === 'http:' && window.location.hostname === 'localhost')
  ? 'http://localhost:8000'
  : ''

console.log('=== AXIOS CONFIG DEBUG ===')
console.log('window.__TAURI__:', window.__TAURI__)
console.log('isTauri:', isTauri)
console.log('window.location.protocol:', window.location.protocol)
console.log('window.location.hostname:', window.location.hostname)
console.log('baseURL:', baseURL)
console.log('=========================')

// Create axios instance with default config
const axiosInstance = axios.create({
  baseURL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json'
  }
})

// Request interceptor to ensure /api prefix
axiosInstance.interceptors.request.use(
  (config) => {
    // Ensure all requests have /api prefix
    if (config.url && !config.url.startsWith('/api')) {
      config.url = `/api${config.url}`
    }
    console.log('Axios request:', config.baseURL + config.url)
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// Response interceptor for error handling
axiosInstance.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.code === 'ERR_NETWORK' || error.message.includes('Network')) {
      console.error('Network error: Make sure the backend server is running on port 8000')
    }
    return Promise.reject(error)
  }
)

export default axiosInstance

// 🤖 AI-generated