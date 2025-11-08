/*
 * Copyright 2025 Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

"use client"

import { useState, useEffect, useRef, forwardRef, useImperativeHandle } from "react"
import { TkButton } from "thinkube-style/components/buttons-badges"
import { TkBadge } from "thinkube-style/components/buttons-badges"
import { TkCheckbox } from "thinkube-style/components/forms-inputs"
import { TkLabel } from "thinkube-style/components/forms-inputs"
import { Check, Loader2, Copy, Info, XCircle } from "lucide-react"
import { getAnsibleLogClassName, getAnsibleLogPrefix } from "@/lib/ansible-log-utils"
import { useCopyToClipboard } from "@/lib/use-copy-to-clipboard"

interface PlaybookExecutorProps {
  title: string
  playbookName: string
  testMode?: boolean
  onRetry?: () => void
  onComplete?: (result: any) => void
  playbookQueue?: Array<{ id: string; title: string; name: string; phase: string }>
  currentPlaybookIndex?: number
  onContinue?: () => void
  onTestPlaybook?: () => void
  onRollback?: () => void
  extraVars?: Record<string, any>
}

interface LogEntry {
  type: 'start' | 'play' | 'task' | 'ok' | 'changed' | 'failed' | 'output' | 'error' | 'complete' | 'skipped'
  message: string
  task?: string
  task_number?: number
}

interface TaskSummary {
  total: number
  ok: number
  changed: number
  skipped: number
  failed: number
}

export interface PlaybookExecutorRef {
  startExecution: (params: any) => void
  completeExecution: (result: any) => void
  cancelExecution: () => void
}

export const PlaybookExecutorStream = forwardRef<PlaybookExecutorRef, PlaybookExecutorProps>(
  (
    {
      title,
      playbookName,
      testMode = false,
      onRetry,
      onComplete,
      playbookQueue = [],
      currentPlaybookIndex = 0,
      onContinue,
      onTestPlaybook,
      onRollback,
      extraVars
    },
    ref
  ) => {
    // Reactive state
    const [isExecuting, setIsExecuting] = useState(false)
    const [status, setStatus] = useState<'pending' | 'running' | 'success' | 'error' | 'cancelled'>('pending')
    const [message, setMessage] = useState('')
    const [currentTask, setCurrentTask] = useState('')
    const [taskCount, setTaskCount] = useState(0)
    const [duration, setDuration] = useState<number | null>(null)
    const [isCancelling, setIsCancelling] = useState(false)
    const [logOutput, setLogOutput] = useState<LogEntry[]>([])
    const logContainerRef = useRef<HTMLDivElement>(null)
    const [autoScroll, setAutoScroll] = useState(true)
    const websocketRef = useRef<WebSocket | null>(null)
    const startTimeRef = useRef<number>(0)

    // Task summary - track unique tasks rather than host executions
    const [taskSummary, setTaskSummary] = useState<TaskSummary>({
      total: 0,
      ok: 0,
      changed: 0,
      skipped: 0,
      failed: 0
    })
    const seenTasksRef = useRef(new Set<string>())

    // Helper function for duration formatting
    const formatDuration = (seconds: number): string => {
      if (seconds < 60) {
        return `${seconds.toFixed(1)} seconds`
      } else {
        const minutes = Math.floor(seconds / 60)
        const remainingSeconds = Math.floor(seconds % 60)
        return `${minutes}m ${remainingSeconds}s`
      }
    }

    // Copy to clipboard
    const fullText = `Thinkube Installer - Playbook Execution Log
=====================================
Playbook: ${playbookName}
Title: ${title}
Status: ${status}
Duration: ${duration ? formatDuration(duration) : 'N/A'}
Tasks: Total ${taskSummary.total}, OK ${taskSummary.ok}, Changed ${taskSummary.changed}, Failed ${taskSummary.failed}
Timestamp: ${new Date().toISOString()}
=====================================

${logOutput.map(log => log.message).join('\n')}`

    const { copy, copied } = useCopyToClipboard(fullText)

    // Methods
    const startExecution = (params: any = {}) => {
      setIsExecuting(true)
      setStatus('running')
      setMessage('')
      setCurrentTask('Connecting...')
      setTaskCount(0)
      setDuration(null)
      setIsCancelling(false)
      setLogOutput([])
      setTaskSummary({ total: 0, ok: 0, changed: 0, skipped: 0, failed: 0 })
      seenTasksRef.current = new Set()
      startTimeRef.current = Date.now()

      // Connect WebSocket
      connectWebSocket(params)
    }

    const connectWebSocket = async (params: any) => {
      const encodedPlaybookName = encodeURIComponent(playbookName)

      // In Tauri, we need to connect directly to localhost:8000
      const isTauri = typeof window !== 'undefined' && window.location.protocol === 'tauri:'
      const wsBase =
        isTauri ||
        (typeof window !== 'undefined' &&
          window.location.protocol === 'http:' &&
          window.location.hostname === 'localhost')
          ? 'ws://localhost:8000'
          : typeof window !== 'undefined'
          ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`
          : 'ws://localhost:8000'

      const wsUrl = `${wsBase}/ws/playbook/${encodedPlaybookName}`

      try {
        const ws = new WebSocket(wsUrl)
        websocketRef.current = ws

        // Store params in closure to ensure they're available in onopen
        const paramsToSend = params

        ws.onopen = async () => {
          let inventoryYAML = ''

          // Check if this is SSH-related playbook - use minimal inventory
          if (playbookName === 'setup-ssh-keys' || playbookName === 'test-ssh-connectivity') {
            // Dynamically import minimal inventory
            const { generateMinimalInventory, minimalInventoryToYAML } = await import(
              '../utils/minimalInventory.js'
            )
            const minimalInventory = generateMinimalInventory()
            inventoryYAML = minimalInventoryToYAML(minimalInventory)
          } else {
            // Use full inventory for other playbooks
            const { generateDynamicInventory, inventoryToYAML } = await import(
              '../utils/inventoryGenerator.js'
            )
            const dynamicInventory = generateDynamicInventory()
            inventoryYAML = inventoryToYAML(dynamicInventory)
          }

          // Add inventory to parameters
          const paramsWithInventory = {
            ...paramsToSend,
            inventory: inventoryYAML
          }

          // Add ZeroTier-specific environment variables if this is a ZeroTier playbook
          if (playbookName.includes('zerotier')) {
            const zerotierApiToken = sessionStorage.getItem('zerotierApiToken')
            const zerotierNetworkId = sessionStorage.getItem('zerotierNetworkId')

            if (zerotierApiToken || zerotierNetworkId) {
              paramsWithInventory.environment = {
                ...paramsWithInventory.environment
              }

              if (zerotierApiToken) {
                paramsWithInventory.environment.ZEROTIER_API_TOKEN = zerotierApiToken
              }
              if (zerotierNetworkId) {
                paramsWithInventory.environment.ZEROTIER_NETWORK_ID = zerotierNetworkId
              }
            }
          }

          // Add Cloudflare token if needed
          if (playbookName.includes('cert-manager') || playbookName.includes('dns')) {
            const cloudflareToken = sessionStorage.getItem('cloudflareToken')
            if (cloudflareToken) {
              paramsWithInventory.environment = {
                ...paramsWithInventory.environment,
                CLOUDFLARE_TOKEN: cloudflareToken
              }
            }
          }

          // Add GitHub token if needed
          if (playbookName.includes('github') || playbookName.includes('devpi')) {
            const githubToken = sessionStorage.getItem('githubToken')
            if (githubToken) {
              paramsWithInventory.environment = {
                ...paramsWithInventory.environment,
                GITHUB_TOKEN: githubToken
              }
            }
          }

          // Send execution parameters with dynamic inventory
          try {
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify(paramsWithInventory))
            } else {
              setLogOutput((prev) => [
                ...prev,
                {
                  type: 'error',
                  message: 'WebSocket not ready - connection may have failed'
                }
              ])
            }
          } catch (error) {
            setLogOutput((prev) => [
              ...prev,
              {
                type: 'error',
                message: `Failed to send parameters: ${error}`
              }
            ])
          }
        }

        ws.onmessage = (event) => {
          const data = JSON.parse(event.data)
          handleWebSocketMessage(data)
        }

        ws.onerror = (error) => {
          setLogOutput((prev) => [
            ...prev,
            {
              type: 'error',
              message: 'Connection error occurred'
            }
          ])
        }

        ws.onclose = () => {
          if (status === 'running') {
            setStatus('error')
            setMessage('Connection lost')
            completeExecution({
              status: 'error',
              message: 'Connection to server lost'
            })
          }
        }
      } catch (error) {
        setLogOutput((prev) => [
          ...prev,
          {
            type: 'error',
            message: `Failed to connect: ${error}`
          }
        ])
        completeExecution({
          status: 'error',
          message: 'Failed to establish connection'
        })
      }
    }

    const handleWebSocketMessage = (data: any) => {
      // Add to log
      setLogOutput((prev) => [
        ...prev,
        {
          type: data.type,
          message: data.message,
          task: data.task,
          task_number: data.task_number
        }
      ])

      // Handle different message types
      switch (data.type) {
        case 'start':
          setCurrentTask('Starting playbook execution...')
          break

        case 'task':
          setCurrentTask(data.task_name)
          setTaskCount(data.task_number)

          // Track unique tasks only
          if (data.task_name && !seenTasksRef.current.has(data.task_name)) {
            seenTasksRef.current.add(data.task_name)
            setTaskSummary((prev) => ({ ...prev, total: prev.total + 1 }))
          }
          break

        case 'ok':
          // Count ok tasks separately (not changed)
          if (data.task && !seenTasksRef.current.has(data.task + '_ok')) {
            seenTasksRef.current.add(data.task + '_ok')
            setTaskSummary((prev) => ({ ...prev, ok: prev.ok + 1 }))
          }
          break

        case 'changed':
          // Count changed tasks separately
          if (data.task && !seenTasksRef.current.has(data.task + '_changed')) {
            seenTasksRef.current.add(data.task + '_changed')
            setTaskSummary((prev) => ({ ...prev, changed: prev.changed + 1 }))
          }
          break

        case 'skipped':
          // Count skipped tasks
          if (data.task && !seenTasksRef.current.has(data.task + '_skipped')) {
            seenTasksRef.current.add(data.task + '_skipped')
            setTaskSummary((prev) => ({ ...prev, skipped: prev.skipped + 1 }))
          }
          break

        case 'failed':
          // Mark task as failed
          if (data.task && !seenTasksRef.current.has(data.task + '_failed')) {
            seenTasksRef.current.add(data.task + '_failed')
            setTaskSummary((prev) => ({ ...prev, failed: prev.failed + 1 }))
          }
          break

        case 'complete':
          const executionDuration = (Date.now() - startTimeRef.current) / 1000
          setDuration(executionDuration)
          setStatus(data.status)
          setMessage(data.message)
          completeExecution({
            status: data.status,
            message: data.message,
            duration: executionDuration
          })
          break

        case 'error':
          setStatus('error')
          setMessage(data.message)
          break
      }
    }

    const completeExecution = (result: any) => {
      setIsExecuting(false)
      websocketRef.current?.close()
      websocketRef.current = null

      // Call onComplete prop if provided
      if (onComplete) {
        onComplete({
          ...result,
          logs: logOutput.map(log => log.message).join('\n')
        })
      }
    }

    const cancelExecution = () => {
      setIsCancelling(true)
      websocketRef.current?.close()
      setStatus('cancelled')
      setMessage('Execution was cancelled')
      setIsExecuting(false)
      setIsCancelling(false)

      // Call onComplete prop if provided
      const result = {
        status: 'cancelled',
        message: 'Execution was cancelled by user',
        duration,
        logs: logOutput.map(log => log.message).join('\n')
      }
      if (onComplete) {
        onComplete(result)
      }
    }

    const getLogTypeFromMessage = (message: string): LogEntry['type'] => {
      if (message.includes('ERROR') || message.includes('failed')) return 'failed'
      if (message.includes('WARNING')) return 'error'
      if (message.includes('TASK')) return 'task'
      if (message.includes('PLAY')) return 'play'
      if (message.includes('ok:')) return 'ok'
      if (message.includes('changed:')) return 'changed'
      if (message.includes('skipped:')) return 'skipped'
      return 'output'
    }

    // Expose methods to parent component
    useImperativeHandle(ref, () => ({
      startExecution,
      completeExecution,
      cancelExecution
    }))

    // Auto-scroll effect
    useEffect(() => {
      if (autoScroll && logContainerRef.current) {
        logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
      }
    }, [logOutput, autoScroll])

    // Render compact playbook queue steps
    const renderPlaybookQueue = () => {
      if (!playbookQueue || playbookQueue.length === 0) return null

      return (
        <div className="mb-3 overflow-x-auto">
          <div className="flex gap-1 min-h-2">
            {playbookQueue.map((playbook, idx) => {
              const isCompleted = idx < currentPlaybookIndex
              const isCurrent = idx === currentPlaybookIndex
              const isPending = idx > currentPlaybookIndex

              return (
                <div
                  key={playbook.id}
                  className="group relative cursor-help"
                  title={playbook.title}
                >
                  <div
                    className={`w-2 h-2 rounded-full transition-all ${
                      isCompleted
                        ? 'bg-primary'
                        : isCurrent
                        ? 'bg-warning animate-pulse'
                        : 'bg-muted'
                    }`}
                  />
                </div>
              )
            })}
          </div>
        </div>
      )
    }

    return (
      <div className="playbook-executor">
        {/* Only show when executing */}
        {isExecuting && (
          <div>
            {renderPlaybookQueue()}

            {/* Current Task */}
            {isExecuting && currentTask && (
              <div className="mb-4">
                <div className="flex justify-between text-sm mb-1">
                  <span className="font-semibold">{currentTask}</span>
                  {taskCount > 0 && (
                    <span className="text-sm text-muted-foreground">Task {taskCount}</span>
                  )}
                </div>
              </div>
            )}

            {/* Live Output Log */}
            {isExecuting && (
              <div className="mb-4">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm text-muted-foreground">Live Output:</span>
                  <div className="flex items-center gap-2">
                    <TkButton
                      variant="ghost"
                      size="sm"
                      onClick={copy}
                      className={copied ? 'text-success' : ''}
                    >
                      {copied ? <Check className="w-4 h-4 mr-1" /> : <Copy className="w-4 h-4 mr-1" />}
                      {copied ? 'Copied!' : 'Copy'}
                    </TkButton>
                    <div className="flex items-center gap-2">
                      <TkCheckbox
                        id="auto-scroll-exec"
                        checked={autoScroll}
                        onCheckedChange={(checked: boolean) => setAutoScroll(checked as boolean)}
                      />
                      <TkLabel htmlFor="auto-scroll-exec" className="text-xs cursor-pointer">
                        Auto-scroll
                      </TkLabel>
                    </div>
                  </div>
                </div>
                <div
                  ref={logContainerRef}
                  className="h-96 overflow-y-auto overflow-x-auto p-4 bg-muted/30 rounded-lg font-mono text-xs"
                >
                  {logOutput.length === 0 && (
                    <div className="text-muted-foreground">
                      <div className="flex items-start">
                        <span className="mr-2 shrink-0">$</span>
                        <code className="break-all">Waiting for output...</code>
                      </div>
                    </div>
                  )}
                  {logOutput.map((log, idx) => {
                    const logType = log.type || getLogTypeFromMessage(log.message)
                    return (
                      <div key={idx} className={`flex items-start ${getAnsibleLogClassName(logType)}`}>
                        <span className="text-muted-foreground mr-2 shrink-0">
                          {getAnsibleLogPrefix(logType)}
                        </span>
                        <code className="break-all">{log.message}</code>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}


            {/* Cancel Button (only during execution) */}
            {status === 'running' && (
              <div className="flex justify-end mb-4">
                <TkButton variant="outline" size="sm" onClick={cancelExecution} disabled={isCancelling}>
                  {isCancelling && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                  {isCancelling ? 'Cancelling...' : 'Cancel'}
                </TkButton>
              </div>
            )}
          </div>
        )}
      </div>
    )
  }
)

PlaybookExecutorStream.displayName = 'PlaybookExecutorStream'
