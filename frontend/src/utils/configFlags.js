/*
 * Copyright 2025 Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { invoke } from '@tauri-apps/api/core'

// Don't cache - always read fresh from Rust to handle environment variable changes
export async function getConfigFlags() {
  try {
    const [testMode, shellConfig] = await invoke('get_config_flags')
    console.log('🔍 DEBUG getConfigFlags from Rust:', { testMode, shellConfig })
    return { testMode, shellConfig }
  } catch (error) {
    console.error('Failed to get config flags:', error)
    return { testMode: false, shellConfig: false }
  }
}

export async function isTestMode() {
  const flags = await getConfigFlags()
  return flags.testMode
}

export async function shouldEnableShellConfig() {
  const flags = await getConfigFlags()
  return flags.shellConfig
}