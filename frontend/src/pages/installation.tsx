/*
 * Copyright 2025 Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, useMemo } from "react"
import { useNavigate } from "react-router-dom"
import { TkCard, TkCardContent, TkCardHeader, TkCardTitle } from "thinkube-style/components/cards-data"
import { TkButton } from "thinkube-style/components/buttons-badges"
import { TkBadge } from "thinkube-style/components/buttons-badges"
import { TkProgress } from "thinkube-style/components/feedback"
import { TkCheckbox } from "thinkube-style/components/forms-inputs"
import { TkLabel } from "thinkube-style/components/forms-inputs"
import { TkPageWrapper } from "thinkube-style/components/utilities"
import { ChevronRight } from "lucide-react"
import { getAnsibleLogClassName, getAnsibleLogPrefix } from "@/lib/ansible-log-utils"

interface InstallationStatus {
  phase: 'idle' | 'starting' | 'running' | 'completed' | 'failed'
  progress: number
  current_task: string
  logs: string[]
  errors: string[]
}

export default function Installation() {
  const navigate = useNavigate()

  // Check if we're in skip-config mode
  const skipConfigMode = typeof window !== 'undefined'
    ? sessionStorage.getItem('skipConfigMode') === 'true'
    : false

  const [status, setStatus] = useState<InstallationStatus>({
    phase: 'starting',
    progress: 0,
    current_task: 'Initializing installation...',
    logs: [],
    errors: []
  })

  const logContainerRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const wsRef = useRef<WebSocket | null>(null)

  const isComplete = useMemo(
    () => status.phase === 'completed' || status.phase === 'failed',
    [status.phase]
  )

  const getPhaseClass = (phase: string) => {
    const classes: Record<string, string> = {
      idle: 'bg-muted text-muted-foreground',
      starting: 'bg-info text-info-foreground',
      running: 'bg-primary text-primary-foreground',
      completed: 'bg-success text-success-foreground',
      failed: 'bg-destructive text-destructive-foreground'
    }
    return classes[phase] || 'bg-muted text-muted-foreground'
  }

  const getLogPrefix = (log: string) => {
    // Determine prefix based on log content
    if (log.includes('ERROR') || log.includes('failed')) return '✗'
    if (log.includes('WARNING')) return '!'
    if (log.includes('INSTALLER_STATUS')) return '>'
    if (log.includes('✅') || log.includes('complete')) return '✓'
    return '$'
  }

  const getLogClass = (log: string) => {
    // Add color classes based on log content
    if (log.includes('ERROR') || log.includes('failed')) return 'text-destructive font-semibold'
    if (log.includes('WARNING')) return 'text-warning'
    if (log.includes('INSTALLER_STATUS')) return 'text-info'
    if (log.includes('✅') || log.includes('complete')) return 'text-success'
    return 'text-foreground'
  }

  const connectWebSocket = () => {
    // In Tauri, we need to connect directly to localhost:8000
    // Tauri v2 uses tauri: protocol
    const isTauri = typeof window !== 'undefined' && window.location.protocol === 'tauri:'

    // Determine WebSocket base URL
    let wsBase: string
    if (isTauri) {
      // Tauri app - always connect to localhost:8000
      wsBase = 'ws://localhost:8000'
    } else if (
      typeof window !== 'undefined' &&
      window.location.hostname === 'localhost' &&
      window.location.port === '5173'
    ) {
      // Development mode (Vite dev server)
      wsBase = 'ws://localhost:8000'
    } else {
      // Production web deployment
      wsBase = typeof window !== 'undefined'
        ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`
        : 'ws://localhost:8000'
    }

    // Try /ws first, then /api/ws
    let wsUrl = `${wsBase}/ws`
    let retryWithApi = true

    const createConnection = (url: string) => {
      const ws = new WebSocket(url)
      wsRef.current = ws

      ws.onopen = () => {
        retryWithApi = false
      }

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data)
        setStatus(data)
      }

      ws.onerror = (error) => {
        if (retryWithApi && url.endsWith('/ws')) {
          // Try /api/ws endpoint
          retryWithApi = false
          wsUrl = `${wsBase}/api/ws`
          createConnection(wsUrl)
        }
      }

      ws.onclose = () => {
        // Reconnect after 5 seconds if not complete
        if (!isComplete) {
          setTimeout(() => createConnection(wsUrl), 5000)
        }
      }
    }

    createConnection(wsUrl)
  }

  // Auto-scroll effect
  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
    }
  }, [status.logs, autoScroll])

  const continueNext = () => {
    if (skipConfigMode) {
      navigate('/deploy')
    } else {
      navigate('/server-discovery')
    }
  }

  useEffect(() => {
    connectWebSocket()

    return () => {
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, [])

  return (
    <TkPageWrapper title="Installation Progress">
      {/* TkProgress Overview */}
      <TkCard className="mb-6">
        <TkCardContent className="pt-6">
          <div className="flex justify-between items-center mb-4">
            <div>
              <div className="flex items-center gap-3">
                <TkBadge className={getPhaseClass(status.phase)}>
                  {status.phase}
                </TkBadge>
                <span className="text-lg font-semibold">{status.current_task}</span>
              </div>
            </div>
            <div className="text-4xl font-bold text-primary">{status.progress}%</div>
          </div>

          <TkProgress value={status.progress} className="w-full" />
        </TkCardContent>
      </TkCard>

      {/* Installation Logs */}
      <TkCard>
        <TkCardContent className="pt-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">Installation Logs</h2>
            <div className="flex items-center gap-2">
              <TkCheckbox
                id="auto-scroll"
                checked={autoScroll}
                onCheckedChange={(checked: boolean) => setAutoScroll(checked)}
              />
              <TkLabel htmlFor="auto-scroll" className="text-xs cursor-pointer">
                Auto-scroll
              </TkLabel>
            </div>
          </div>

          <div
            ref={logContainerRef}
            className="h-96 overflow-y-auto p-4 bg-muted/30 rounded-lg font-mono text-xs"
          >
            {status.logs.length === 0 && (
              <div className="text-muted-foreground">
                <div className="flex items-start">
                  <span className="text-muted-foreground mr-2">$</span>
                  <code>Waiting for output...</code>
                </div>
              </div>
            )}
            {status.logs.map((log, index) => (
              <div key={index} className={`flex items-start ${getLogClass(log)}`}>
                <span className="text-muted-foreground mr-2">{getLogPrefix(log)}</span>
                <code>{log}</code>
              </div>
            ))}
            {status.errors.map((error, index) => (
              <div key={`error-${index}`} className="flex items-start text-destructive font-semibold">
                <span className="text-muted-foreground mr-2">!</span>
                <code>ERROR: {error}</code>
              </div>
            ))}
          </div>
        </TkCardContent>
      </TkCard>

      {/* Completion Actions */}
      {isComplete && (
        <div className="mt-6">
          {status.phase === 'failed' && (
            <div className="bg-destructive/10 border border-destructive text-destructive rounded-lg p-4 flex gap-3 mb-4">
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
              <span>Installation failed. Please check the logs for details.</span>
            </div>
          )}

          <div className="flex justify-end">
            <TkButton
              size="lg"
              className="gap-2"
              onClick={continueNext}
            >
              {skipConfigMode ? 'Continue to Deployment' : 'Continue to Server Discovery'}
              <ChevronRight className="w-5 h-5" />
            </TkButton>
          </div>
        </div>
      )}
    </TkPageWrapper>
  )
}
