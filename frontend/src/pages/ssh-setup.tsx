/*
 * Copyright 2025 Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useMemo, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { TkCard, TkCardContent, TkCardHeader, TkCardTitle } from "thinkube-style/components/cards-data"
import { TkAlert, TkAlertDescription, tkToast } from "thinkube-style/components/feedback"
import { TkButton } from "thinkube-style/components/buttons-badges"
import { TkBadge } from "thinkube-style/components/buttons-badges"
import { TkPageWrapper } from "thinkube-style/components/utilities"
import {
  Info,
  CheckCircle2,
  XCircle,
  RefreshCw
} from "lucide-react"
import { PlaybookExecutorStream } from "@/components/PlaybookExecutorStream"

interface Server {
  hostname: string
  ip: string
  status: "pending" | "connected" | "failed" | "configuring"
  error?: string
}

interface TestResult {
  success: boolean
  message: string
}

export default function SSHSetup() {
  const navigate = useNavigate()
  const [servers, setServers] = useState<Server[]>([])
  const [currentUser, setCurrentUser] = useState("")
  const [sshSetupComplete, setSshSetupComplete] = useState(false)
  const [isTestRunning, setIsTestRunning] = useState(false)
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [autoStartSetup, setAutoStartSetup] = useState(false)
  const playbookExecutorRef = useRef<any>(null)
  const testPlaybookExecutorRef = useRef<any>(null)

  const hasErrors = useMemo(() => {
    return servers.some((server) => server.status === "failed")
  }, [servers])

  useEffect(() => {
    const loadServers = async () => {
      // Load discovered servers from session storage
      const discoveredServers = JSON.parse(
        sessionStorage.getItem("discoveredServers") || "[]"
      )
      setServers(
        discoveredServers.map((s: any) => ({
          hostname: s.hostname,
          ip: s.ip_address || s.ip,
          status: "pending"
        }))
      )

      // Get current user from session storage
      const username = sessionStorage.getItem("systemUsername") || "ubuntu"
      setCurrentUser(username)

      // Signal that we should auto-start setup once currentUser is set
      if (discoveredServers.length > 0 && username) {
        setAutoStartSetup(true)
      }
    }

    loadServers()
  }, [])

  // Auto-start SSH setup once currentUser is loaded
  useEffect(() => {
    if (autoStartSetup && currentUser && servers.length > 0) {
      setAutoStartSetup(false) // Prevent re-triggering
      setTimeout(() => {
        setupSSH()
      }, 500)
    }
  }, [autoStartSetup, currentUser, servers])

  const getStatusClass = (status: Server["status"]) => {
    switch (status) {
      case "connected":
        return "success"
      case "failed":
        return "destructive"
      case "configuring":
        return "warning"
      default:
        return "secondary"
    }
  }

  const setupSSH = () => {
    const sudoPassword = sessionStorage.getItem("sudoPassword")

    if (!sudoPassword) {
      tkToast.error("Sudo password not found. Please go back and enter your password.")
      return
    }

    // Mark all servers as configuring
    setServers((prev) =>
      prev.map((server) => ({ ...server, status: "configuring" }))
    )

    // Execute playbook with streaming output
    playbookExecutorRef.current?.startExecution({
      environment: {
        ANSIBLE_BECOME_PASSWORD: sudoPassword,
        ANSIBLE_SSH_PASSWORD: sudoPassword
      },
      extra_vars: {
        ansible_user: currentUser,
        ansible_ssh_pass: sudoPassword,
        ansible_become_pass: sudoPassword
      }
    })
  }

  const handlePlaybookComplete = (result: any) => {
    if (result.status === "success") {
      // Mark all servers as configured
      setServers((prev) =>
        prev.map((server) => ({ ...server, status: "connected" }))
      )

      // Store SSH info for later use
      sessionStorage.setItem(
        "sshCredentials",
        JSON.stringify({
          username: currentUser,
          password: sessionStorage.getItem("sudoPassword")
        })
      )

      setSshSetupComplete(true)

      // Automatically run test after setup succeeds
      setTimeout(() => {
        runTestPlaybook()
      }, 500)
    } else {
      // Mark servers as failed
      setServers((prev) =>
        prev.map((server) => ({ ...server, status: "failed" }))
      )
      setSshSetupComplete(false)
    }
  }

  const runTestPlaybook = () => {
    setIsTestRunning(true)
    setTestResult(null)

    // Show the test playbook executor
    testPlaybookExecutorRef.current?.startExecution({
      environment: {},
      extra_vars: {
        ansible_user: currentUser
      }
    })
  }

  const handleTestComplete = (result: any) => {
    setIsTestRunning(false)

    if (result.status === "success") {
      setTestResult({
        success: true,
        message:
          "SSH connectivity test passed! All servers are accessible via SSH keys."
      })

      // Automatically proceed to next screen after short delay
      setTimeout(() => {
        navigate("/hardware-detection")
      }, 2000)
    } else {
      setTestResult({
        success: false,
        message: "SSH connectivity test failed. Please check the logs for details."
      })
    }
  }

  return (
    <TkPageWrapper title="SSH Connectivity Check">
      {/* SSH Info */}
      <TkCard className="mb-6">
        <TkCardHeader>
          <TkCardTitle>Verifying SSH Access</TkCardTitle>
        </TkCardHeader>
        <TkCardContent>
          <TkAlert className="bg-info/10 text-info border-info/20">
            <Info className="h-4 w-4" />
            <TkAlertDescription>
              <div>
                <p className="font-medium mb-1">
                  Checking SSH connectivity to all discovered servers.
                </p>
                <p className="text-sm">
                  Using credentials:{" "}
                  <span className="font-mono text-primary">{currentUser}</span>{" "}
                  with the sudo password provided earlier.
                </p>
              </div>
            </TkAlertDescription>
          </TkAlert>
        </TkCardContent>
      </TkCard>

      {/* Discovered Servers */}
      <TkCard className="mb-6">
        <TkCardHeader>
          <TkCardTitle>Servers to Configure</TkCardTitle>
        </TkCardHeader>
        <TkCardContent>
          <div className="overflow-x-auto rounded-lg">
            <table className="w-full">
              <thead className="border-b">
                <tr>
                  <th className="text-left font-semibold py-2 px-4">Hostname</th>
                  <th className="text-left font-semibold py-2 px-4">IP Address</th>
                  <th className="text-left font-semibold py-2 px-4">Status</th>
                </tr>
              </thead>
              <tbody>
                {servers.map((server) => (
                  <tr key={server.ip} className="border-b hover:bg-muted/50">
                    <td className="font-medium py-2 px-4">{server.hostname}</td>
                    <td className="py-2 px-4">{server.ip}</td>
                    <td className="py-2 px-4">
                      <div>
                        <TkBadge variant={getStatusClass(server.status)}>
                          {server.status || "Pending"}
                        </TkBadge>
                        {server.error && (
                          <div className="text-sm text-destructive mt-1">
                            {server.error}
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TkCardContent>
      </TkCard>

      {/* Error TkAlert */}
      {hasErrors && (
        <TkAlert className="bg-destructive/10 text-destructive border-destructive/20 mb-6">
          <XCircle className="h-4 w-4" />
          <TkAlertDescription>
            <div>
              <h3 className="font-bold">SSH Connection Failed</h3>
              <div className="text-sm">
                <p>Unable to connect to one or more servers. Please ensure:</p>
                <ul className="list-disc list-inside mt-2">
                  <li>User &apos;{currentUser}&apos; exists on all servers</li>
                  <li>The sudo password is the same on all servers</li>
                  <li>SSH service is running on all servers</li>
                </ul>
              </div>
            </div>
          </TkAlertDescription>
        </TkAlert>
      )}

      {/* SSH Setup and Testing Status */}
      {sshSetupComplete && (
        <TkCard className="mb-6 bg-success/10 border-success/20">
          <TkCardContent className="pt-6">
            <div className="flex items-center gap-3 mb-4">
              <CheckCircle2 className="h-8 w-8 text-success" />
              <div>
                <h3 className="font-bold text-lg">SSH Setup Complete!</h3>
                <div className="text-sm text-muted-foreground">
                  {isTestRunning
                    ? "Running connectivity test..."
                    : "Passwordless SSH has been configured between all servers."}
                </div>
              </div>
            </div>

            {testResult && (
              <TkAlert
                className={
                  testResult.success
                    ? "bg-success/10 text-success border-success/20"
                    : "bg-destructive/10 text-destructive border-destructive/20"
                }
              >
                {testResult.success ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <XCircle className="h-4 w-4" />
                )}
                <TkAlertDescription>
                  <div>
                    <span>{testResult.message}</span>
                    {testResult.success && (
                      <div className="text-sm mt-1">
                        Proceeding to hardware detection...
                      </div>
                    )}
                  </div>
                </TkAlertDescription>
              </TkAlert>
            )}
          </TkCardContent>
        </TkCard>
      )}

      {!sshSetupComplete && servers.some((s) => s.status === "failed") && (
        <div className="flex justify-end">
          <TkButton className="gap-2" onClick={setupSSH}>
            Retry SSH Setup
            <RefreshCw className="w-5 h-5" />
          </TkButton>
        </div>
      )}

      {/* Streaming Playbook Executor */}
      <TkCard className="mb-6">
        <TkCardContent className="pt-6">
          <PlaybookExecutorStream
            ref={playbookExecutorRef}
            title="SSH Key Setup"
            playbookName="setup-ssh-keys"
            onRetry={setupSSH}
            onComplete={handlePlaybookComplete}
          />
        </TkCardContent>
      </TkCard>

      {/* Test Playbook Executor */}
      <TkCard className="mb-6">
        <TkCardContent className="pt-6">
          <PlaybookExecutorStream
            ref={testPlaybookExecutorRef}
            title="SSH Connectivity Test"
            playbookName="test-ssh-connectivity"
            onRetry={runTestPlaybook}
            onComplete={handleTestComplete}
          />
        </TkCardContent>
      </TkCard>
    </TkPageWrapper>
  )
}
