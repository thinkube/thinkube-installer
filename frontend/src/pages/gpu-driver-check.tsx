/*
 * Copyright 2025 Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useMemo } from "react"
import { useNavigate } from "react-router-dom"
import { TkCard, TkCardContent, TkCardHeader, TkCardTitle } from "thinkube-style/components/cards-data"
import { TkAlert, TkAlertDescription } from "thinkube-style/components/feedback"
import { TkButton } from "thinkube-style/components/buttons-badges"
import { TkBadge } from "thinkube-style/components/buttons-badges"
import { TkPageWrapper } from "thinkube-style/components/utilities"
import {
  TkSelect,
  TkSelectContent,
  TkSelectItem,
  TkSelectTrigger,
  TkSelectValue
} from "thinkube-style/components/forms-inputs"
import { CheckCircle2, XCircle, Loader2, AlertCircle } from "lucide-react"
import axios from "@/utils/axios"

interface Node {
  hostname: string
  ip: string
  gpu_detected: boolean
  gpu_name?: string
  gpu_count?: number
  driver_version?: string
  driver_status?: "compatible" | "old" | "missing" | "unsupported_gpu"
  min_required_version?: string
  action_required?: "install" | "upgrade" | "exclude" | "none"
  compute_cap?: string
  gpu_supported?: boolean
}

interface Summary {
  ready: number
  needs_install: number
  needs_upgrade: number
  no_gpu: number
  unsupported: number
  error?: number
}

export default function GpuDriverCheck() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [nodes, setNodes] = useState<Node[]>([])
  const [summary, setSummary] = useState<Summary>({
    ready: 0,
    needs_install: 0,
    needs_upgrade: 0,
    no_gpu: 0,
    unsupported: 0,
    error: 0
  })
  const [decisions, setDecisions] = useState<Record<string, string>>({})

  useEffect(() => {
    detectGpuDrivers()
  }, [])

  const detectGpuDrivers = async () => {
    try {
      setLoading(true)
      setError("")

      // Load saved configuration
      const savedConfig = localStorage.getItem("thinkube-config")
      if (!savedConfig) {
        setError("No configuration found. Please complete the Configuration screen first.")
        setLoading(false)
        return
      }

      const config = JSON.parse(savedConfig)

      // Load discovered servers from sessionStorage
      const discoveredServers = JSON.parse(
        sessionStorage.getItem("discoveredServers") || "[]"
      )
      if (discoveredServers.length === 0) {
        setError("No servers discovered. Please complete Server Discovery first.")
        setLoading(false)
        return
      }

      // Prepare node list for detection
      const nodeList = discoveredServers.map((server: any) => ({
        hostname: server.hostname || "unknown",
        ip: server.ip,
        username: server.username,
        password: server.password,
        ssh_key: server.ssh_key
      }))

      // Call detection API
      const response = await axios.post("/api/gpu/detect-drivers", {
        nodes: nodeList
      })

      // Ensure response has expected structure
      if (!response.data || !response.data.nodes) {
        throw new Error("Invalid response from GPU detection API")
      }

      setNodes(response.data.nodes || [])
      setSummary(
        response.data.summary || {
          ready: 0,
          needs_install: 0,
          needs_upgrade: 0,
          no_gpu: 0,
          unsupported: 0,
          error: 0
        }
      )

      // Initialize decisions for nodes that need them
      if (Array.isArray(response.data.nodes)) {
        const initialDecisions: Record<string, string> = {}
        response.data.nodes.forEach((node: Node) => {
          if (node.action_required === "install" || node.action_required === "upgrade") {
            initialDecisions[node.ip] = ""
          }
        })
        setDecisions(initialDecisions)
      }

      setLoading(false)
    } catch (e: any) {
      setError(
        e.response?.data?.detail || e.message || "Failed to detect GPU drivers"
      )
      setLoading(false)
      setNodes([])
      setSummary({
        ready: 0,
        needs_install: 0,
        needs_upgrade: 0,
        no_gpu: 0,
        unsupported: 0,
        error: 0
      })
    }
  }

  const nodesNeedingDecisions = useMemo(() => {
    if (!nodes || !Array.isArray(nodes)) return []
    return nodes.filter(
      (node) =>
        node.action_required === "install" ||
        (node.action_required === "upgrade" && node.driver_status !== "unsupported_gpu")
    )
  }, [nodes])

  const allDecisionsMade = useMemo(() => {
    const neededDecisions = nodesNeedingDecisions
    if (!neededDecisions || neededDecisions.length === 0) return true
    return neededDecisions.every((node) => decisions && decisions[node.ip])
  }, [nodesNeedingDecisions, decisions])

  const installCount = useMemo(() => {
    if (!decisions) return 0
    return Object.values(decisions).filter((d) => d === "install").length
  }, [decisions])

  const abortCount = useMemo(() => {
    if (!decisions) return 0
    return Object.values(decisions).filter((d) => d === "abort").length
  }, [decisions])

  const excludeCount = useMemo(() => {
    if (!decisions) return 0
    return Object.values(decisions).filter((d) => d === "exclude").length
  }, [decisions])

  const gpuEnabledCount = useMemo(() => {
    return summary.ready + installCount
  }, [summary.ready, installCount])

  const cpuOnlyCount = useMemo(() => {
    return summary.no_gpu + summary.unsupported + excludeCount
  }, [summary.no_gpu, summary.unsupported, excludeCount])

  const canContinue = useMemo(() => {
    return allDecisionsMade
  }, [allDecisionsMade])

  const goBack = () => {
    navigate("/configuration")
  }

  const continueToDeployment = async () => {
    if (!canContinue) {
      return
    }

    // If user chose to abort, show confirmation
    if (abortCount > 0) {
      const confirmed = confirm(
        "You have chosen to upgrade drivers manually. The deployment will not proceed.\n\n" +
          "After upgrading drivers on the affected nodes, please restart the installer."
      )
      if (confirmed) {
        // Clear state and go back to welcome
        localStorage.removeItem("thinkube-config")
        localStorage.removeItem("discoveredServers")
        navigate("/")
      }
      return
    }

    try {
      // Build GPU node configuration based on decisions
      const gpuNodeConfig = nodes.map((node) => {
        let gpu_enabled = true
        let driver_preinstalled = false
        let reason = null

        if (!node.gpu_detected) {
          gpu_enabled = false
          reason = "No GPU detected"
        } else if (node.driver_status === "unsupported_gpu") {
          gpu_enabled = false
          reason = `GPU architecture too old (compute capability ${node.compute_cap || "< 7.0"})`
        } else if (node.driver_status === "compatible") {
          gpu_enabled = true
          driver_preinstalled = true
        } else if (decisions[node.ip] === "install") {
          gpu_enabled = true
          driver_preinstalled = false
        } else if (decisions[node.ip] === "exclude") {
          gpu_enabled = false
          reason = "Excluded by user"
        }

        return {
          hostname: node.hostname,
          ip: node.ip,
          gpu_detected: node.gpu_detected,
          gpu_name: node.gpu_name,
          gpu_enabled,
          driver_preinstalled,
          driver_version: node.driver_version,
          needs_driver_install: decisions[node.ip] === "install",
          reason
        }
      })

      // Save GPU configuration to localStorage
      const config = JSON.parse(localStorage.getItem("thinkube-config") || "{}")
      config.gpuNodes = gpuNodeConfig
      localStorage.setItem("thinkube-config", JSON.stringify(config))

      // Save GPU configuration to backend as well
      await axios.post("/api/save-configuration", {
        ...config,
        gpuNodes: gpuNodeConfig
      })

      // Continue to deployment
      navigate("/deploy")
    } catch (e: any) {
      setError(
        e.response?.data?.detail || e.message || "Failed to save GPU configuration"
      )
    }
  }

  if (loading) {
    return (
      <TkPageWrapper title="GPU Driver Detection">
        <div className="flex flex-col items-center justify-center py-12">
          <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
          <p className="text-lg">Detecting GPUs and drivers on all nodes...</p>
        </div>
      </TkPageWrapper>
    )
  }

  if (error) {
    return (
      <TkPageWrapper title="GPU Driver Detection">
        <TkAlert className="bg-destructive/10 text-destructive border-destructive/20 mb-6">
          <XCircle className="h-4 w-4" />
          <TkAlertDescription>{error}</TkAlertDescription>
        </TkAlert>
      </TkPageWrapper>
    )
  }

  return (
    <TkPageWrapper title="GPU Driver Detection">

      {/* Summary card */}
      <TkCard className="mb-6">
        <TkCardHeader>
          <TkCardTitle>Detection Summary</TkCardTitle>
        </TkCardHeader>
        <TkCardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
            <div className="bg-secondary rounded-lg p-4">
              <div className="text-sm text-muted-foreground">GPU Ready</div>
              <div className="text-3xl font-bold text-success">{summary.ready}</div>
              <div className="text-xs text-muted-foreground">Compatible drivers</div>
            </div>
            {summary.needs_install > 0 && (
              <div className="bg-secondary rounded-lg p-4">
                <div className="text-sm text-muted-foreground">Need Install</div>
                <div className="text-3xl font-bold text-warning">
                  {summary.needs_install}
                </div>
                <div className="text-xs text-muted-foreground">Driver not found</div>
              </div>
            )}
            {summary.needs_upgrade > 0 && (
              <div className="bg-secondary rounded-lg p-4">
                <div className="text-sm text-muted-foreground">Need Upgrade</div>
                <div className="text-3xl font-bold text-warning">
                  {summary.needs_upgrade}
                </div>
                <div className="text-xs text-muted-foreground">Driver too old</div>
              </div>
            )}
            <div className="bg-secondary rounded-lg p-4">
              <div className="text-sm text-muted-foreground">CPU Only</div>
              <div className="text-3xl font-bold text-muted-foreground">
                {summary.no_gpu + summary.unsupported}
              </div>
              <div className="text-xs text-muted-foreground">
                {summary.unsupported > 0 && summary.no_gpu > 0
                  ? "No GPU or older architecture"
                  : summary.unsupported > 0
                    ? "Older GPU architecture"
                    : "No GPU detected"}
              </div>
            </div>
          </div>
        </TkCardContent>
      </TkCard>

      {/* Nodes table */}
      <TkCard className="mb-6">
        <TkCardHeader>
          <TkCardTitle className="mb-4">Node Details</TkCardTitle>
        </TkCardHeader>
        <TkCardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b">
                <tr>
                  <th className="text-left py-2 px-4">Node</th>
                  <th className="text-left py-2 px-4">GPU</th>
                  <th className="text-left py-2 px-4">Driver Version</th>
                  <th className="text-left py-2 px-4">Status</th>
                  <th className="text-left py-2 px-4">Action Required</th>
                  <th className="text-left py-2 px-4">Your Decision</th>
                </tr>
              </thead>
              <tbody>
                {nodes.map((node) => (
                  <tr key={node.ip} className="border-b">
                    <td className="py-2 px-4">
                      <div className="font-bold">{node.hostname}</div>
                      <div className="text-sm text-muted-foreground">{node.ip}</div>
                    </td>
                    <td className="py-2 px-4">
                      {node.gpu_detected ? (
                        <div className="flex items-center gap-2">
                          {node.driver_status === "unsupported_gpu" ? (
                            <AlertCircle className="h-5 w-5 text-muted-foreground" />
                          ) : (
                            <CheckCircle2 className="h-5 w-5 text-success" />
                          )}
                          <div>
                            <div className="font-medium">{node.gpu_name}</div>
                            {node.gpu_count && node.gpu_count > 1 && (
                              <div className="text-xs text-muted-foreground">
                                {node.gpu_count} GPUs
                              </div>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="text-muted-foreground">No GPU</div>
                      )}
                    </td>
                    <td className="py-2 px-4">
                      {node.driver_version ? (
                        <TkBadge appearance="outlined">{node.driver_version}</TkBadge>
                      ) : (
                        <span className="text-muted-foreground">Not installed</span>
                      )}
                    </td>
                    <td className="py-2 px-4">
                      {node.driver_status === "compatible" && (
                        <TkBadge status="healthy" className="gap-2">
                          <CheckCircle2 className="h-4 w-4" />
                          Compatible
                        </TkBadge>
                      )}
                      {node.driver_status === "unsupported_gpu" && (
                        <TkBadge status="pending" className="gap-2">
                          Pre-Volta architecture
                        </TkBadge>
                      )}
                      {node.driver_status === "old" && (
                        <TkBadge status="warning" className="gap-2">
                          <AlertCircle className="h-4 w-4" />
                          Update available ({node.min_required_version}+)
                        </TkBadge>
                      )}
                      {node.driver_status === "missing" && (
                        <TkBadge status="warning" className="gap-2">
                          <AlertCircle className="h-4 w-4" />
                          Missing
                        </TkBadge>
                      )}
                      {!node.driver_status && !node.gpu_detected && (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>
                    <td className="py-2 px-4">
                      {node.driver_status === "unsupported_gpu" && (
                        <span className="text-muted-foreground">CPU-only node</span>
                      )}
                      {node.driver_status !== "unsupported_gpu" && node.action_required === "install" && (
                        <span className="text-warning">Install driver</span>
                      )}
                      {node.driver_status !== "unsupported_gpu" && node.action_required === "upgrade" && (
                        <span className="text-warning">Upgrade driver</span>
                      )}
                      {node.action_required === "none" && (
                        <span className="text-success">None</span>
                      )}
                      {!node.action_required && node.driver_status !== "unsupported_gpu" && <span>-</span>}
                    </td>
                    <td className="py-2 px-4">
                      {node.driver_status === "compatible" && (
                        <span className="text-success">Ready for GPU</span>
                      )}
                      {node.driver_status === "unsupported_gpu" && (
                        <span className="text-muted-foreground">
                          Will run as CPU-only
                        </span>
                      )}
                      {!node.gpu_detected && (
                        <span className="text-muted-foreground">CPU-only node</span>
                      )}
                      {node.driver_status !== "unsupported_gpu" && node.action_required === "install" && (
                        <TkSelect
                          value={decisions[node.ip] || ""}
                          onValueChange={(value: string) =>
                            setDecisions({ ...decisions, [node.ip]: value })
                          }
                        >
                          <TkSelectTrigger className="w-[200px]">
                            <TkSelectValue placeholder="-- Choose action --" />
                          </TkSelectTrigger>
                          <TkSelectContent>
                            <TkSelectItem value="install">
                              Install drivers automatically
                            </TkSelectItem>
                            <TkSelectItem value="exclude">
                              Exclude from GPU (CPU-only)
                            </TkSelectItem>
                          </TkSelectContent>
                        </TkSelect>
                      )}
                      {node.driver_status !== "unsupported_gpu" && node.action_required === "upgrade" && (
                        <TkSelect
                          value={decisions[node.ip] || ""}
                          onValueChange={(value: string) =>
                            setDecisions({ ...decisions, [node.ip]: value })
                          }
                        >
                          <TkSelectTrigger className="w-[200px]">
                            <TkSelectValue placeholder="-- Choose action --" />
                          </TkSelectTrigger>
                          <TkSelectContent>
                            <TkSelectItem value="abort">
                              I will upgrade manually (abort)
                            </TkSelectItem>
                            <TkSelectItem value="exclude">
                              Exclude from GPU (CPU-only)
                            </TkSelectItem>
                          </TkSelectContent>
                        </TkSelect>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TkCardContent>
      </TkCard>

      {summary.unsupported > 0 && (
        <TkAlert className="bg-secondary text-muted-foreground border-border mb-6">
          <AlertCircle className="h-4 w-4" />
          <TkAlertDescription>
            {summary.unsupported === 1
              ? "One node has a pre-Volta NVIDIA GPU (compute capability below 7.0). "
              : `${summary.unsupported} nodes have pre-Volta NVIDIA GPUs (compute capability below 7.0). `}
            These GPUs are not supported by the NVIDIA GPU Operator and will run as CPU-only nodes.
            GPU workloads require Volta (V100) or newer architecture.
          </TkAlertDescription>
        </TkAlert>
      )}

      {/* Final decision summary */}
      <TkCard className="mb-6">
        <TkCardHeader>
          <TkCardTitle>Deployment Plan</TkCardTitle>
        </TkCardHeader>
        <TkCardContent className="space-y-2">
          <p>
            <strong>{gpuEnabledCount}</strong> node(s) will have GPU capabilities
            enabled
          </p>
          <p>
            <strong>{cpuOnlyCount}</strong> node(s) will be CPU-only
          </p>
          {installCount > 0 && (
            <p>
              <strong>{installCount}</strong> node(s) will have drivers installed
              automatically
            </p>
          )}
          {abortCount > 0 && (
            <p className="text-warning">
              Deployment paused — upgrade drivers on {abortCount} node(s) manually, then restart the installer
            </p>
          )}
        </TkCardContent>
      </TkCard>

      {/* Navigation buttons */}
      <div className="flex justify-between mt-8">
        <TkButton intent="secondary" onClick={goBack}>
          Back
        </TkButton>
        <TkButton onClick={continueToDeployment} disabled={!canContinue}>
          {abortCount > 0 ? "Abort Deployment" : "Continue to Deployment"}
        </TkButton>
      </div>
    </TkPageWrapper>
  )
}
