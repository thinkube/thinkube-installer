/*
 * Copyright 2025 Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { invoke } from '@tauri-apps/api/core'

let cachedFlags = null

export async function getConfigFlags() {
  if (cachedFlags === null) {
    try {
      const [testMode, shellConfig] = await invoke('get_config_flags')
      console.log('🔍 DEBUG getConfigFlags from Rust:', { testMode, shellConfig })
      cachedFlags = { testMode, shellConfig }
    } catch (error) {
      console.error('Failed to get config flags:', error)
      cachedFlags = { testMode: false, shellConfig: false }
    }
  }
  return cachedFlags
}

export async function isTestMode() {
  const flags = await getConfigFlags()
  return flags.testMode
}

export async function shouldEnableShellConfig() {
  const flags = await getConfigFlags()
  return flags.shellConfig
}