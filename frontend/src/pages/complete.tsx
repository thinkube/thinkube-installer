/*
 * Copyright 2025 Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useMemo } from "react"
import { useNavigate } from "react-router-dom"
import { TkCard, TkCardContent, TkCardHeader, TkCardTitle } from "thinkube-style/components/cards-data"
import { TkAlert, TkAlertDescription, tkToast } from "thinkube-style/components/feedback"
import { TkButton } from "thinkube-style/components/buttons-badges"
import { TkLabel } from "thinkube-style/components/forms-inputs"
import { TkPageWrapper } from "thinkube-style/components/utilities"
import {
  CheckCircle2,
  AlertCircle,
  Home,
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
  overlayProvider: string
  gatewayHostname: string
  clusterName: string
}

export default function Complete() {
  const navigate = useNavigate()
  const [dataLoaded, setDataLoaded] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [deploymentData, setDeploymentData] = useState<DeploymentData>({
    domainName: "",
    adminUsername: "",
    adminPassword: "",
    systemUsername: "",
    controlPlaneIP: "",
    overlayProvider: "",
    gatewayHostname: "",
    clusterName: ""
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

    // Get domain name from configuration (saved in configuration page)
    const domainName = sessionStorage.getItem("domainName") || networkConfig.domainName || ""

    // SSO realm username for all services (Thinkube Control, Argo, Code Server)
    const adminUsername = "thinkube"

    // SSO password is the sudo password used during installation
    const adminPassword = sudoPassword || ""

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

    // overlayProvider, clusterName, and gatewayHostname are written to
    // sessionStorage by the configuration page (gatewayHostname there
    // already resolves the default to <clusterName>-gw if the user left
    // it blank — this page is just a reader).
    const overlayProvider = sessionStorage.getItem("overlayProvider") || ""
    const clusterName = sessionStorage.getItem("clusterName") || ""
    const gatewayHostname = sessionStorage.getItem("gatewayHostname") || ""

    // Check if we have the minimum required data
    if (domainName && adminUsername && controlPlaneIP) {
      setDataLoaded(true)
      setDeploymentData({
        domainName,
        adminUsername,
        adminPassword,
        systemUsername,
        controlPlaneIP,
        overlayProvider,
        gatewayHostname,
        clusterName,
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
    // This is a Tauri desktop application
    if (typeof window !== 'undefined' && (window as any).__TAURI__) {
      ;(window as any).__TAURI__.window.getCurrent().close()
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
          <TkButton onClick={() => navigate("/")}>Start Over</TkButton>
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

      {/* Tailscale-specific reachability summary */}
      {deploymentData.overlayProvider === "tailscale" && (
        <TkCard className="mb-6">
          <TkCardHeader>
            <TkCardTitle>Reaching Your Cluster Over Tailscale</TkCardTitle>
          </TkCardHeader>
          <TkCardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              The Tailscale Operator exposed your cluster's Gateway as a
              tailnet device named <code>{deploymentData.gatewayHostname}</code>.
              Any device joined to your tailnet can reach
              <code> *.{deploymentData.domainName}</code> via that Gateway.
            </p>

            <div>
              <TkLabel className="font-semibold mb-2 block">
                Find the Gateway tailnet IP
              </TkLabel>
              <div className="flex items-center justify-between border rounded-md px-3 py-2">
                <code className="text-sm">
                  tailscale ip {deploymentData.gatewayHostname}
                </code>
                <TkButton
                  intent="ghost"
                  size="sm"
                  onClick={() =>
                    copyToClipboard(`tailscale ip ${deploymentData.gatewayHostname}`)
                  }
                >
                  <Copy className="w-4 h-4" />
                </TkButton>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Or open <a
                  href="https://login.tailscale.com/admin/machines"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >Tailscale Admin → Machines</a>{" "}
                and look for <code>{deploymentData.gatewayHostname}</code>.
              </p>
            </div>

            <div>
              <TkLabel className="font-semibold mb-2 block">
                Verify a service resolves
              </TkLabel>
              <div className="flex items-center justify-between border rounded-md px-3 py-2">
                <code className="text-sm">
                  dig +short control.{deploymentData.domainName}
                </code>
                <TkButton
                  intent="ghost"
                  size="sm"
                  onClick={() =>
                    copyToClipboard(`dig +short control.${deploymentData.domainName}`)
                  }
                >
                  <Copy className="w-4 h-4" />
                </TkButton>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Should return the same address as
                <code> tailscale ip {deploymentData.gatewayHostname}</code>.
              </p>
            </div>

            <TkAlert>
              <AlertCircle className="h-4 w-4" />
              <TkAlertDescription>
                Each cluster node also appears as a separate tailnet device
                so you can SSH directly. The <code>tailscale</code> CLI on
                your laptop must be logged in to the same tailnet.
              </TkAlertDescription>
            </TkAlert>
          </TkCardContent>
        </TkCard>
      )}

      {/* SSO Credentials */}
      <TkCard className="mb-6">
        <TkCardHeader>
          <TkCardTitle>Single Sign-On Credentials</TkCardTitle>
        </TkCardHeader>
        <TkCardContent className="space-y-4">
          <TkAlert className="bg-warning/10 text-warning border-warning/20">
            <AlertCircle className="h-4 w-4" />
            <TkAlertDescription>
              Save these credentials securely. Use them to access all services (Thinkube Control, Argo Workflows, Code Server). They will not be shown again.
            </TkAlertDescription>
          </TkAlert>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <TkLabel className="font-semibold mb-2 block">SSO Username (Keycloak Realm)</TkLabel>
              <div className="flex items-center justify-between border rounded-md px-3 py-2">
                <span>{deploymentData.adminUsername}</span>
                <TkButton
                  intent="ghost"
                  size="sm"
                  onClick={() => copyToClipboard(deploymentData.adminUsername)}
                >
                  <Copy className="w-4 h-4" />
                </TkButton>
              </div>
            </div>

            <div>
              <TkLabel className="font-semibold mb-2 block">SSO Password</TkLabel>
              <div className="flex items-center justify-between border rounded-md px-3 py-2">
                <span className="font-mono">
                  {showPassword ? deploymentData.adminPassword : "••••••••"}
                </span>
                <div className="flex gap-1">
                  <TkButton
                    intent="ghost"
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
                    intent="ghost"
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
            <TkButton intent="secondary" className="gap-2" asChild>
              <a
                href="https://thinkube.org"
                target="_blank"
                rel="noopener noreferrer"
              >
                <BookOpen className="w-5 h-5" />
                Read Documentation
              </a>
            </TkButton>

            <TkButton intent="secondary" className="gap-2" asChild>
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
              intent="secondary"
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
        <TkButton intent="ghost" onClick={closeInstaller}>
          Close Installer
        </TkButton>
      </div>
    </TkPageWrapper>
  )
}
