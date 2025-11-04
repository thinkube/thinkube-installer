/*
 * Copyright 2025 Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

"use client"

import { useState, useEffect, useMemo } from "react"
import { useRouter } from "next/navigation"
import { TkCard, TkCardContent, TkCardHeader, TkCardTitle } from "thinkube-style/components/cards-data"
import { TkAlert, TkAlertDescription } from "thinkube-style/components/feedback"
import { TkButton } from "thinkube-style/components/buttons-badges"
import { TkLabel } from "thinkube-style/components/forms-inputs"
import { TkPageWrapper } from "thinkube-style/components/utilities"
import {
  CheckCircle2,
  AlertCircle,
  Home,
  Sparkles,
  Code2,
  Terminal,
  BookOpen,
  Github,
  Download,
  Eye,
  EyeOff,
  Copy
} from "lucide-react"

interface DeploymentData {
  domainName: string
  adminUsername: string
  adminPassword: string
  systemUsername: string
  controlPlaneIP: string
}

export default function Complete() {
  const router = useRouter()
  const [dataLoaded, setDataLoaded] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [deploymentData, setDeploymentData] = useState<DeploymentData>({
    domainName: "",
    adminUsername: "",
    adminPassword: "",
    systemUsername: "",
    controlPlaneIP: ""
  })

  const isElectron = useMemo(() => {
    return typeof window !== "undefined" && !!(window as any).electronAPI
  }, [])

  useEffect(() => {
    // Get configuration from sessionStorage first (current session data)
    const networkConfig = JSON.parse(
      sessionStorage.getItem("networkConfiguration") || "{}"
    )
    const currentUser = sessionStorage.getItem("currentUser")
    const sudoPassword = sessionStorage.getItem("sudoPassword")

    // Get domain name from network configuration
    const domainName = networkConfig.domainName || "thinkube.local"

    // Admin username is always tkadmin
    const adminUsername = "tkadmin"

    // Admin password is the sudo password
    const adminPassword = sudoPassword || "ChangeMeNow123!"

    // System username
    const systemUsername = currentUser || "thinkube"

    // Get control plane IP from cluster nodes
    const clusterNodes = JSON.parse(sessionStorage.getItem("clusterNodes") || "[]")
    const controlNode = clusterNodes.find((n: any) => n.role === "control-plane")

    let controlPlaneIP = ""
    if (controlNode) {
      controlPlaneIP = controlNode.ip
    } else {
      // Fallback to first discovered server
      const servers = JSON.parse(sessionStorage.getItem("discoveredServers") || "[]")
      if (servers.length > 0) {
        controlPlaneIP = servers[0].ip_address || servers[0].ip
      }
    }

    // Check if we have the minimum required data
    if (domainName && adminUsername && controlPlaneIP) {
      setDataLoaded(true)
      setDeploymentData({
        domainName,
        adminUsername,
        adminPassword,
        systemUsername,
        controlPlaneIP
      })
    }
  }, [])

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch (err) {
      // Silently fail
    }
  }

  const downloadLogs = () => {
    try {
      window.location.href = "/api/logs/download"
    } catch (error) {
      // Silently fail
    }
  }

  const closeInstaller = () => {
    if ((window as any).electronAPI) {
      ;(window as any).electronAPI.close()
    } else {
      // For web version, just show a message
      alert("Installation complete! You can now close this browser tab.")
    }
  }

  if (!dataLoaded) {
    return (
      <TkPageWrapper title="Configuration Not Found">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-24 h-24 bg-destructive/20 rounded-full mb-6">
            <AlertCircle className="w-16 h-16 text-destructive" />
          </div>
          <p className="text-xl text-muted-foreground mb-8">
            The deployment configuration could not be loaded. Please ensure you've
            completed all previous steps.
          </p>
          <TkButton onClick={() => router.push("/")}>Start Over</TkButton>
        </div>
      </TkPageWrapper>
    )
  }

  return (
    <TkPageWrapper title="Cluster Deployment Complete!">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-24 h-24 bg-success/20 rounded-full mb-6">
          <CheckCircle2 className="w-16 h-16 text-success" />
        </div>
        <p className="text-xl text-muted-foreground">
          Your thinkube platform has been successfully deployed and is ready for
          AI workloads.
        </p>
      </div>

      {/* Access Information */}
      <TkCard className="mb-6">
        <TkCardHeader>
          <TkCardTitle>Access Your Platform</TkCardTitle>
        </TkCardHeader>
        <TkCardContent className="space-y-4">
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0 w-12 h-12 bg-primary/20 rounded-lg flex items-center justify-center">
              <Home className="w-6 h-6 text-primary" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold mb-1">Thinkube Control</h3>
              <a
                href={`https://control.${deploymentData.domainName}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                https://control.{deploymentData.domainName}
              </a>
              <p className="text-sm text-muted-foreground mt-1">
                Central management dashboard for your Thinkube platform
              </p>
            </div>
          </div>

          <div className="flex items-start gap-4">
            <div className="flex-shrink-0 w-12 h-12 bg-primary/20 rounded-lg flex items-center justify-center">
              <Sparkles className="w-6 h-6 text-primary" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold mb-1">Argo Workflows</h3>
              <a
                href={`https://argo.${deploymentData.domainName}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                https://argo.{deploymentData.domainName}
              </a>
              <p className="text-sm text-muted-foreground mt-1">
                Run and manage AI workflows and CI/CD pipelines
              </p>
            </div>
          </div>

          <div className="flex items-start gap-4">
            <div className="flex-shrink-0 w-12 h-12 bg-primary/20 rounded-lg flex items-center justify-center">
              <Code2 className="w-6 h-6 text-primary" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold mb-1">Code Server</h3>
              <a
                href={`https://code.${deploymentData.domainName}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                https://code.{deploymentData.domainName}
              </a>
              <p className="text-sm text-muted-foreground mt-1">
                VS Code in the browser with CI/CD integration
              </p>
            </div>
          </div>

          <div className="flex items-start gap-4">
            <div className="flex-shrink-0 w-12 h-12 bg-primary/20 rounded-lg flex items-center justify-center">
              <Terminal className="w-6 h-6 text-primary" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold mb-1">SSH Access</h3>
              <code className="text-sm bg-secondary px-2 py-1 rounded">
                ssh {deploymentData.systemUsername}@{deploymentData.controlPlaneIP}
              </code>
              <p className="text-sm text-muted-foreground mt-1">
                Direct access to control plane node
              </p>
            </div>
          </div>
        </TkCardContent>
      </TkCard>

      {/* Admin Credentials */}
      <TkCard className="mb-6">
        <TkCardHeader>
          <TkCardTitle>Administrator Credentials</TkCardTitle>
        </TkCardHeader>
        <TkCardContent className="space-y-4">
          <TkAlert className="bg-warning/10 text-warning border-warning/20">
            <AlertCircle className="h-4 w-4" />
            <TkAlertDescription>
              Save these credentials securely. They will not be shown again.
            </TkAlertDescription>
          </TkAlert>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <TkLabel className="font-semibold mb-2 block">Admin Username</TkLabel>
              <div className="flex items-center justify-between border rounded-md px-3 py-2">
                <span>{deploymentData.adminUsername}</span>
                <TkButton
                  variant="ghost"
                  size="sm"
                  onClick={() => copyToClipboard(deploymentData.adminUsername)}
                >
                  <Copy className="w-4 h-4" />
                </TkButton>
              </div>
            </div>

            <div>
              <TkLabel className="font-semibold mb-2 block">Admin Password</TkLabel>
              <div className="flex items-center justify-between border rounded-md px-3 py-2">
                <span className="font-mono">
                  {showPassword ? deploymentData.adminPassword : "••••••••"}
                </span>
                <div className="flex gap-1">
                  <TkButton
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </TkButton>
                  <TkButton
                    variant="ghost"
                    size="sm"
                    onClick={() => copyToClipboard(deploymentData.adminPassword)}
                  >
                    <Copy className="w-4 h-4" />
                  </TkButton>
                </div>
              </div>
            </div>
          </div>
        </TkCardContent>
      </TkCard>

      {/* Next Steps */}
      <TkCard className="mb-6">
        <TkCardHeader>
          <TkCardTitle>Next Steps</TkCardTitle>
        </TkCardHeader>
        <TkCardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <TkButton variant="outline" className="gap-2" asChild>
              <a
                href="https://docs.thinkube.org"
                target="_blank"
                rel="noopener noreferrer"
              >
                <BookOpen className="w-5 h-5" />
                Read Documentation
              </a>
            </TkButton>

            <TkButton variant="outline" className="gap-2" asChild>
              <a
                href="https://github.com/thinkube/thinkube"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Github className="w-5 h-5" />
                Explore Examples
              </a>
            </TkButton>

            <TkButton
              variant="outline"
              className="gap-2"
              onClick={downloadLogs}
            >
              <Download className="w-5 h-5" />
              Download Logs
            </TkButton>
          </div>
        </TkCardContent>
      </TkCard>

      {/* Actions */}
      <div className="text-center">
        <TkButton variant="ghost" onClick={closeInstaller}>
          Close Installer
        </TkButton>
      </div>
    </TkPageWrapper>
  )
}
