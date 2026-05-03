/*
 * Copyright 2025 Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { TkCard, TkCardContent, TkCardHeader, TkCardTitle } from "thinkube-style/components/cards-data"
import { TkAlert, TkAlertDescription, tkToast } from "thinkube-style/components/feedback"
import { TkButton } from "thinkube-style/components/buttons-badges"
import { TkBadge } from "thinkube-style/components/buttons-badges"
import { TkPageWrapper } from "thinkube-style/components/utilities"
import {
  ChevronLeft,
  ChevronRight,
  Info,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Network,
  Loader2,
} from "lucide-react"
import { PlaybookExecutorStream } from "@/components/PlaybookExecutorStream"
import axios from "@/utils/axios"

interface ServerNode {
  hostname: string
  lanIp: string
  role: string
  status: "pending" | "installing" | "connected" | "failed"
  overlayIp: string
  error?: string
}

type OverlayProvider = "zerotier" | "tailscale"

export default function OverlaySetup() {
  const navigate = useNavigate()
  const [nodes, setNodes] = useState<ServerNode[]>([])
  const [overlayProvider, setOverlayProvider] = useState<OverlayProvider>("zerotier")
  const [setupStarted, setSetupStarted] = useState(false)
  const [setupComplete, setSetupComplete] = useState(false)
  const [ipAllocationLoading, setIpAllocationLoading] = useState(false)
  const [ipAllocationDone, setIpAllocationDone] = useState(false)
  const playbookExecutorRef = useRef<any>(null)

  const providerLabel = overlayProvider === "zerotier" ? "ZeroTier" : "Tailscale"

  useEffect(() => {
    const provider = (sessionStorage.getItem("overlayProvider") || "zerotier") as OverlayProvider
    setOverlayProvider(provider)

    const discoveredServers = JSON.parse(sessionStorage.getItem("discoveredServers") || "[]")
    const roleAssignments = JSON.parse(sessionStorage.getItem("roleAssignments") || "{}")

    const serverNodes: ServerNode[] = discoveredServers.map((s: any) => ({
      hostname: s.hostname,
      lanIp: s.ip_address || s.ip,
      role: roleAssignments[s.hostname] || "worker",
      status: "pending" as const,
      overlayIp: s.overlayIP || "",
    }))

    setNodes(serverNodes)

    // For ZeroTier, allocate IPs automatically on mount
    if (provider === "zerotier" && serverNodes.length > 0) {
      allocateZerotierIps(serverNodes)
    }
  }, [])

  // Auto-start the playbook once prerequisites are ready. Both providers must
  // run automatically — selecting an overlay implies installing it on every
  // node, no separate user action required.
  useEffect(() => {
    if (setupStarted || setupComplete || nodes.length === 0) return
    if (overlayProvider === "zerotier" && !ipAllocationDone) return
    startSetup()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlayProvider, nodes.length, ipAllocationDone, setupStarted, setupComplete])

  const allocateZerotierIps = async (serverNodes: ServerNode[]) => {
    const networkId = sessionStorage.getItem("zerotierNetworkId")
    const apiToken = sessionStorage.getItem("zerotierApiToken")

    if (!networkId || !apiToken) {
      tkToast.error("ZeroTier credentials not found. Go back to Configuration.")
      return
    }

    setIpAllocationLoading(true)
    try {
      const response = await axios.post("/api/overlay/allocate-ips", {
        hostnames: serverNodes.map((n) => n.hostname),
        network_id: networkId,
        api_token: apiToken,
      })

      if (response.data.allocations) {
        setNodes((prev) =>
          prev.map((node) => ({
            ...node,
            overlayIp: response.data.allocations[node.hostname] || node.overlayIp,
          }))
        )
        setIpAllocationDone(true)
      }
    } catch (error: any) {
      tkToast.error(
        error.response?.data?.detail || "Failed to allocate ZeroTier IPs. Check credentials."
      )
    } finally {
      setIpAllocationLoading(false)
    }
  }

  const startSetup = () => {
    const sudoPassword = sessionStorage.getItem("sudoPassword")
    if (!sudoPassword) {
      tkToast.error("Sudo password not found. Please go back and enter your password.")
      return
    }

    setSetupStarted(true)
    setNodes((prev) => prev.map((n) => ({ ...n, status: "installing" })))

    const extraVars: Record<string, any> = {
      ansible_user: sessionStorage.getItem("systemUsername") || "ubuntu",
      ansible_ssh_pass: sudoPassword,
      ansible_become_pass: sudoPassword,
    }

    if (overlayProvider === "zerotier") {
      extraVars.zerotier_network_id = sessionStorage.getItem("zerotierNetworkId")
      extraVars.zerotier_api_token = sessionStorage.getItem("zerotierApiToken")
      // Pass pre-allocated IPs so the playbook can assign them
      const ipMap: Record<string, string> = {}
      nodes.forEach((n) => {
        if (n.overlayIp) ipMap[n.hostname] = n.overlayIp
      })
      extraVars.overlay_ip_allocations = JSON.stringify(ipMap)
    } else {
      extraVars.tailscale_auth_key = sessionStorage.getItem("tailscaleAuthKey")
      extraVars.tailscale_api_token = sessionStorage.getItem("tailscaleApiToken")
    }

    const playbookName =
      overlayProvider === "zerotier" ? "install-zerotier" : "install-tailscale"

    playbookExecutorRef.current?.startExecution({
      environment: {
        ANSIBLE_BECOME_PASSWORD: sudoPassword,
        ANSIBLE_SSH_PASSWORD: sudoPassword,
      },
      extra_vars: extraVars,
      playbook_name: playbookName,
    })
  }

  const handlePlaybookComplete = (result: any) => {
    if (result.status === "success") {
      setNodes((prev) => prev.map((n) => ({ ...n, status: "connected" })))
      setSetupComplete(true)

      // Save overlay IPs to session storage for downstream pages
      const updatedServers = JSON.parse(sessionStorage.getItem("discoveredServers") || "[]")
      nodes.forEach((node) => {
        const server = updatedServers.find(
          (s: any) => s.hostname === node.hostname
        )
        if (server) {
          server.overlayIP = node.overlayIp
        }
      })
      sessionStorage.setItem("discoveredServers", JSON.stringify(updatedServers))
      sessionStorage.setItem("overlaySetupComplete", "true")
    } else {
      setNodes((prev) => prev.map((n) => ({ ...n, status: "failed" })))
      setSetupComplete(false)
    }
  }

  const getStatusBadge = (status: ServerNode["status"]) => {
    switch (status) {
      case "connected":
        return "healthy"
      case "failed":
        return "unhealthy"
      case "installing":
        return "warning"
      default:
        return "pending"
    }
  }

  const allConnected = nodes.every((n) => n.status === "connected")
  const hasFailed = nodes.some((n) => n.status === "failed")

  return (
    <TkPageWrapper title={`${providerLabel} Overlay Setup`}>
      {/* Provider Info */}
      <TkCard className="mb-6">
        <TkCardHeader>
          <TkCardTitle className="flex items-center gap-2">
            <Network className="w-5 h-5" />
            {providerLabel} Network Setup
          </TkCardTitle>
        </TkCardHeader>
        <TkCardContent>
          <TkAlert className="bg-info/10 text-info border-info/20">
            <Info className="h-4 w-4" />
            <TkAlertDescription>
              {overlayProvider === "zerotier" ? (
                <p>
                  Installing ZeroTier on all nodes, joining the network, and assigning
                  overlay IPs. Each node will get a static IP from the ZeroTier network.
                </p>
              ) : (
                <p>
                  Installing Tailscale on all nodes and connecting to your tailnet. Each
                  node will receive an automatically assigned IP from the 100.x.x.x range.
                </p>
              )}
            </TkAlertDescription>
          </TkAlert>
        </TkCardContent>
      </TkCard>

      {/* Node Status Table */}
      <TkCard className="mb-6">
        <TkCardHeader>
          <TkCardTitle>Node Status</TkCardTitle>
        </TkCardHeader>
        <TkCardContent>
          {ipAllocationLoading && (
            <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Allocating ZeroTier IPs...
            </div>
          )}
          <div className="overflow-x-auto rounded-lg">
            <table className="w-full">
              <thead className="border-b">
                <tr>
                  <th className="text-left font-semibold py-2 px-4">Hostname</th>
                  <th className="text-left font-semibold py-2 px-4">LAN IP</th>
                  <th className="text-left font-semibold py-2 px-4">Role</th>
                  <th className="text-left font-semibold py-2 px-4">Status</th>
                  <th className="text-left font-semibold py-2 px-4">Overlay IP</th>
                </tr>
              </thead>
              <tbody>
                {nodes.map((node) => (
                  <tr key={node.hostname} className="border-b hover:bg-muted/50">
                    <td className="font-medium py-2 px-4">{node.hostname}</td>
                    <td className="py-2 px-4 font-mono text-sm">{node.lanIp}</td>
                    <td className="py-2 px-4 capitalize">{node.role}</td>
                    <td className="py-2 px-4">
                      <TkBadge status={getStatusBadge(node.status)}>
                        {node.status}
                      </TkBadge>
                    </td>
                    <td className="py-2 px-4 font-mono text-sm">
                      {node.overlayIp || (
                        <span className="text-muted-foreground italic">
                          {overlayProvider === "tailscale"
                            ? "Assigned after install"
                            : "Pending allocation"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TkCardContent>
      </TkCard>

      {/* Setup status / retry control */}
      {!setupComplete && (
        <div className="flex justify-center mb-6">
          {!setupStarted ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              {overlayProvider === "zerotier" && !ipAllocationDone
                ? "Allocating overlay IPs..."
                : `Preparing ${providerLabel} installation...`}
            </div>
          ) : hasFailed ? (
            <TkButton onClick={() => { setSetupStarted(false); startSetup() }} className="gap-2">
              <RefreshCw className="w-5 h-5" />
              Retry Setup
            </TkButton>
          ) : null}
        </div>
      )}

      {/* Success Banner */}
      {setupComplete && allConnected && (
        <TkCard className="mb-6 bg-success/10 border-success/20">
          <TkCardContent className="pt-6">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-8 w-8 text-success" />
              <div>
                <h3 className="font-bold text-lg">{providerLabel} Setup Complete</h3>
                <p className="text-sm text-muted-foreground">
                  All {nodes.length} nodes are connected via the overlay network.
                </p>
              </div>
            </div>
          </TkCardContent>
        </TkCard>
      )}

      {/* Failure Banner */}
      {hasFailed && setupStarted && (
        <TkAlert className="bg-destructive/10 text-destructive border-destructive/20 mb-6">
          <XCircle className="h-4 w-4" />
          <TkAlertDescription>
            {providerLabel} setup failed on one or more nodes. Check the logs below for details.
          </TkAlertDescription>
        </TkAlert>
      )}

      {/* Playbook Executor */}
      <TkCard className="mb-6">
        <TkCardContent className="pt-6">
          <PlaybookExecutorStream
            ref={playbookExecutorRef}
            title={`${providerLabel} Installation`}
            playbookName={overlayProvider === "zerotier" ? "install-zerotier" : "install-tailscale"}
            onRetry={startSetup}
            onComplete={handlePlaybookComplete}
          />
        </TkCardContent>
      </TkCard>

      {/* Navigation */}
      <div className="flex justify-between mt-6">
        <TkButton
          type="button"
          intent="ghost"
          onClick={() => navigate("/configuration")}
        >
          <ChevronLeft className="w-5 h-5 mr-2" />
          Back to Configuration
        </TkButton>
        <TkButton
          onClick={() => navigate("/network-configuration")}
          disabled={!setupComplete || !allConnected}
        >
          Configure Network
          <ChevronRight className="w-5 h-5 ml-2" />
        </TkButton>
      </div>
    </TkPageWrapper>
  )
}
