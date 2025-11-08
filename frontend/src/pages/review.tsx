/*
 * Copyright 2025 Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useMemo } from "react"
import { useNavigate } from "react-router-dom"
import { TkCard, TkCardContent, TkCardHeader, TkCardTitle } from "thinkube-style/components/cards-data"
import { TkButton } from "thinkube-style/components/buttons-badges"
import { tkToast } from "thinkube-style/components/feedback"
import { TkBadge } from "thinkube-style/components/buttons-badges"
import { TkPageWrapper } from "thinkube-style/components/utilities"
import {
  TkDialog,
  TkDialogRoot,
  TkDialogContent,
  TkDialogFooter,
  TkDialogHeader,
  TkDialogTitle
} from "thinkube-style/components/modals-overlays"
import { ChevronLeft, ChevronRight, Copy, Download, Eye } from "lucide-react"

interface Node {
  id: string
  hostname: string
  role: string
  type: string
  cpu?: number
  memory?: number
  disk?: number
  hasGPU?: boolean
  zerotierIP?: string
  localIP?: string
  gpuInfo?: {
    gpu_count: number
    gpu_model: string
    gpu_passthrough_info: any[]
    iommu_enabled: boolean
    gpu_passthrough_eligible_count: number
  }
  gpus?: any[]
}

interface Config {
  clusterName?: string
  domainName?: string
  adminUsername?: string
  networkMode?: string
}

export default function Review() {
  const navigate = useNavigate()
  const [config, setConfig] = useState<Config>({})
  const [allNodes, setAllNodes] = useState<Node[]>([])
  const [deploymentType, setDeploymentType] = useState("baremetal")
  const [gpuAssignments, setGpuAssignments] = useState<Record<string, string>>({})
  const [generatedInventory, setGeneratedInventory] = useState("")
  const [inventoryModalOpen, setInventoryModalOpen] = useState(false)

  const hasGPUs = useMemo(() => {
    return Object.keys(gpuAssignments).some(
      (key) => gpuAssignments[key] !== "baremetal"
    )
  }, [gpuAssignments])

  useEffect(() => {
    const loadConfiguration = async () => {
      // Load saved configuration
      const savedConfig = JSON.parse(
        localStorage.getItem("thinkube-config") || "{}"
      )
      setConfig(savedConfig)

      // Load deployment type
      setDeploymentType("baremetal")

      // Load nodes from role assignment
      const clusterNodes = JSON.parse(
        sessionStorage.getItem("clusterNodes") || "[]"
      )

      // Load hardware info for baremetal nodes
      const serverHardware = JSON.parse(
        sessionStorage.getItem("serverHardware") || "[]"
      )

      // Load network configuration
      const networkConfig = JSON.parse(
        sessionStorage.getItem("networkConfiguration") || "{}"
      )
      const physicalServers = networkConfig.physicalServers || []

      // Merge hardware info with cluster nodes
      const mergedNodes = clusterNodes.map((node: any) => {
        if (node.type === "baremetal") {
          const hwInfo = serverHardware.find(
            (s: any) => s.hostname === node.hostname
          )
          const networkInfo = physicalServers.find(
            (s: any) => s.hostname === node.hostname
          )

          const result: Node = {
            ...node,
            cpu: node.cpu || hwInfo?.hardware?.cpu_cores || 0,
            memory: node.memory || hwInfo?.hardware?.memory_gb || 0,
            disk: node.disk || hwInfo?.hardware?.disk_gb || 0,
            hasGPU: hwInfo?.hardware?.gpu_detected || false,
            zerotierIP: networkInfo?.zerotierIP || networkInfo?.ip || "",
            localIP: networkInfo?.localIP || hwInfo?.network?.ip_address || ""
          }

          if (hwInfo?.hardware?.gpu_detected) {
            result.gpuInfo = {
              gpu_count: hwInfo.hardware.gpu_count || 0,
              gpu_model: hwInfo.hardware.gpu_model || "",
              gpu_passthrough_info: hwInfo.hardware.gpu_passthrough_info || [],
              iommu_enabled: hwInfo.hardware.iommu_enabled || false,
              gpu_passthrough_eligible_count:
                hwInfo.hardware.gpu_passthrough_eligible_count || 0
            }
          }

          return result
        }
        return node
      })

      setAllNodes(mergedNodes)

      // Load GPU assignments from previous step
      const savedAssignments = JSON.parse(
        sessionStorage.getItem("gpuAssignments") || "{}"
      )
      setGpuAssignments(savedAssignments)

      // Update nodes with GPU data from nodeConfiguration
      const nodeConfig = JSON.parse(
        sessionStorage.getItem("nodeConfiguration") || "[]"
      )
      const updatedNodes = mergedNodes.map((node: Node) => {
        const configNode = nodeConfig.find((n: any) => n.hostname === node.hostname)
        if (configNode?.gpus) {
          return { ...node, gpus: configNode.gpus }
        }
        return node
      })
      setAllNodes(updatedNodes)

      // Generate fresh inventory with GPU assignments
      try {
        // For now, we'll use the saved inventory
        // In a full implementation, you'd import the inventory generator
        const savedInventory = sessionStorage.getItem("generatedInventory") || ""
        setGeneratedInventory(savedInventory)
      } catch (error) {
        // Fall back to saved inventory if generation fails
        const savedInventory = sessionStorage.getItem("generatedInventory") || ""
        setGeneratedInventory(savedInventory)
      }
    }

    loadConfiguration()
  }, [])

  const getRoleDisplay = (role: string) => {
    const roleMap: Record<string, string> = {
      control_plane: "Control Plane",
      worker: "Worker",
      dns: "DNS Server"
    }
    return roleMap[role] || role
  }

  const getRoleBadgeClass = (role: string) => {
    const classMap: Record<string, "default" | "secondary" | "outline"> = {
      control_plane: "default",
      worker: "secondary",
      dns: "outline"
    }
    return classMap[role] || "outline"
  }

  const copyInventory = async () => {
    try {
      await navigator.clipboard.writeText(generatedInventory)
      tkToast.success("Inventory copied to clipboard!")
    } catch (error: any) {
      tkToast.error("Failed to copy to clipboard: " + error.message)
    }
  }

  const downloadInventory = () => {
    const blob = new Blob([generatedInventory], { type: "text/yaml" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "inventory.yaml"
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const viewInventory = () => {
    setInventoryModalOpen(true)
  }

  const startDeployment = () => {
    navigate("/deploy")
  }

  return (
    <TkPageWrapper title="Review Configuration">
      {/* Cluster Settings */}
      <TkCard className="mb-6">
        <TkCardHeader>
          <TkCardTitle>Cluster Settings</TkCardTitle>
        </TkCardHeader>
        <TkCardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-muted-foreground font-medium">
                Cluster Name
              </p>
              <p className="font-semibold">{config.clusterName}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground font-medium">
                Domain Name
              </p>
              <p className="font-semibold">{config.domainName}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground font-medium">
                Admin Username
              </p>
              <p className="font-semibold">{config.adminUsername || "tkadmin"}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground font-medium">
                Network Mode
              </p>
              <p className="font-semibold">
                {config.networkMode === "overlay"
                  ? "ZeroTier Overlay"
                  : "Local Network"}
              </p>
            </div>
          </div>
        </TkCardContent>
      </TkCard>

      {/* Node Assignments */}
      <TkCard className="mb-6">
        <TkCardHeader>
          <TkCardTitle>Node Assignments</TkCardTitle>
        </TkCardHeader>
        <TkCardContent>
          <div className="space-y-3">
            {allNodes.map((node) => (
              <div
                key={node.id}
                className="border rounded-lg p-4 hover:bg-muted/20 transition-colors"
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <h3 className="font-semibold text-lg">{node.hostname}</h3>
                    <p className="text-sm text-muted-foreground">
                      Baremetal Server
                    </p>

                    {/* Hardware specs */}
                    <div className="text-sm mt-2">
                      <div>
                        <span className="font-medium">{node.cpu || 0}</span> CPU
                        cores,{" "}
                        <span className="font-medium">
                          {Math.round(node.memory || 0)}
                        </span>{" "}
                        GB RAM,
                        <span className="font-medium">
                          {Math.round(node.disk || 0)}
                        </span>{" "}
                        GB Storage
                      </div>
                    </div>

                    {/* Network information */}
                    <div className="text-sm mt-2 space-y-1">
                      {node.zerotierIP && (
                        <div>
                          <span className="text-muted-foreground">
                            ZeroTier:
                          </span>{" "}
                          <span className="font-mono">{node.zerotierIP}</span>
                        </div>
                      )}
                      {node.localIP && (
                        <div>
                          <span className="text-muted-foreground">Local:</span>{" "}
                          <span className="font-mono">{node.localIP}</span>
                        </div>
                      )}
                    </div>

                    {/* GPU information */}
                    {node.hasGPU && node.gpuInfo && (
                      <div className="mt-2">
                        <p className="text-sm font-medium">GPU:</p>
                        <div className="text-sm text-muted-foreground ml-2">
                          {node.gpuInfo.gpu_count}x {node.gpuInfo.gpu_model}
                        </div>
                      </div>
                    )}
                  </div>
                  <TkBadge variant={getRoleBadgeClass(node.role)} className="text-lg">
                    {getRoleDisplay(node.role)}
                  </TkBadge>
                </div>
              </div>
            ))}
          </div>
        </TkCardContent>
      </TkCard>

      {/* Generated Inventory */}
      {generatedInventory && (
        <TkCard className="mb-6">
          <TkCardHeader>
            <TkCardTitle>Generated Ansible Inventory</TkCardTitle>
          </TkCardHeader>
          <TkCardContent className="space-y-4">
            <p className="text-muted-foreground">
              Your configuration has been converted to an Ansible inventory file.
              You can download this for manual playbook execution.
            </p>

            <div className="flex gap-3">
              <TkButton variant="outline" size="sm" onClick={copyInventory}>
                <Copy className="w-4 h-4 mr-2" />
                Copy
              </TkButton>

              <TkButton variant="outline" size="sm" onClick={downloadInventory}>
                <Download className="w-4 h-4 mr-2" />
                Download inventory.yaml
              </TkButton>

              <TkButton variant="outline" size="sm" onClick={viewInventory}>
                <Eye className="w-4 h-4 mr-2" />
                View
              </TkButton>
            </div>
          </TkCardContent>
        </TkCard>
      )}

      {/* Actions */}
      <div className="flex justify-between">
        <TkButton
          variant="ghost"
          className="gap-2"
          onClick={() => navigate("/network-configuration")}
        >
          <ChevronLeft className="w-5 h-5" />
          Back to Network Configuration
        </TkButton>

        <TkButton className="gap-2" onClick={startDeployment}>
          Start Deployment
          <ChevronRight className="w-5 h-5" />
        </TkButton>
      </div>

      {/* Inventory View Modal */}
      <TkDialogRoot open={inventoryModalOpen} onOpenChange={setInventoryModalOpen}>
        <TkDialogContent className="max-w-5xl">
          <TkDialogHeader>
            <TkDialogTitle>Ansible Inventory</TkDialogTitle>
          </TkDialogHeader>

          <div className="bg-secondary text-sm max-h-96 overflow-auto p-4 rounded-md font-mono">
            <pre>{generatedInventory}</pre>
          </div>

          <TkDialogFooter>
            <TkButton variant="ghost" onClick={() => setInventoryModalOpen(false)}>
              Close
            </TkButton>
          </TkDialogFooter>
        </TkDialogContent>
      </TkDialogRoot>
    </TkPageWrapper>
  )
}
