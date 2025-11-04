/*
 * Copyright 2025 Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

"use client"

import { useState, useMemo, useEffect } from "react"
import { useRouter } from "next/navigation"
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
  TkSelectValue,
} from "thinkube-style/components/forms-inputs"
import { AlertTriangle, ChevronLeft, ChevronRight } from "lucide-react"

interface NodeData {
  id: string
  hostname: string
  ip: string
  type: string
  cpu: number
  memory: number
  disk: number
  hasGPU: boolean
  gpuInfo?: {
    gpu_count: number
    gpu_model: string
    gpu_passthrough_info: Array<{ passthrough_eligible: boolean }>
    iommu_enabled: boolean
  }
  role: string
  host?: string
  gpu?: any
}

export default function RoleAssignment() {
  const router = useRouter()
  const [allNodes, setAllNodes] = useState<NodeData[]>([])
  const [validationErrors, setValidationErrors] = useState<string[]>([])

  const baremetalNodes = useMemo(() => {
    return allNodes.filter(n => n.type === 'baremetal')
  }, [allNodes])

  const controlPlaneNodes = useMemo(() => {
    return allNodes.filter(n => n.role === 'control_plane')
  }, [allNodes])

  const workerNodes = useMemo(() => {
    return allNodes.filter(n => n.role === 'worker')
  }, [allNodes])

  const isValid = useMemo(() => {
    return validationErrors.length === 0 && controlPlaneNodes.length > 0
  }, [validationErrors, controlPlaneNodes])

  const canBeControlPlane = (node: NodeData) => {
    return node.cpu >= 4 && node.memory >= 8
  }

  const getNodeGPUStatus = (node: NodeData) => {
    if (!node.hasGPU || !node.gpuInfo) return null

    const totalGPUs = node.gpuInfo.gpu_count || 0

    return `${totalGPUs} GPU${totalGPUs > 1 ? 's' : ''}`
  }

  const validateRoles = () => {
    const errors: string[] = []

    const cpCount = controlPlaneNodes.length
    if (cpCount === 0) {
      errors.push('Exactly one control plane node is required')
    } else if (cpCount > 1) {
      errors.push('Only one control plane node is allowed for Thinkube')
    }

    const unassignedCount = allNodes.filter(n => !n.role).length
    if (unassignedCount > 0) {
      errors.push(`${unassignedCount} nodes have no role assigned`)
    }

    setValidationErrors(errors)
  }

  const handleRoleChange = (nodeId: string, newRole: string) => {
    setAllNodes(prevNodes =>
      prevNodes.map(node =>
        node.id === nodeId ? { ...node, role: newRole } : node
      )
    )
  }

  const saveAndContinue = () => {
    const clusterNodes = allNodes.filter(n => n.role).map(n => ({
      hostname: n.hostname,
      ip: n.ip,
      role: n.role,
      type: n.type,
      host: n.host,
      cpu: n.cpu,
      memory: n.memory,
      disk: n.disk,
      gpu: n.gpu,
      hasGPU: n.hasGPU,
      gpuInfo: n.gpuInfo
    }))

    sessionStorage.setItem('clusterNodes', JSON.stringify(clusterNodes))
    router.push('/configuration')
  }

  useEffect(() => {
    const serverHardware = JSON.parse(sessionStorage.getItem('serverHardware') || '[]')
    const baremetalList = serverHardware.map((s: any) => ({
      id: `bm-${s.hostname}`,
      hostname: s.hostname,
      ip: s.ip,
      type: 'baremetal',
      cpu: s.hardware?.cpu_cores || 0,
      memory: s.hardware?.memory_gb || 0,
      disk: s.hardware?.disk_gb || 0,
      hasGPU: s.hardware?.gpu_detected || false,
      gpuInfo: {
        gpu_count: s.hardware?.gpu_count || 0,
        gpu_model: s.hardware?.gpu_model || '',
        gpu_passthrough_info: s.hardware?.gpu_passthrough_info || [],
        iommu_enabled: s.hardware?.iommu_enabled || false
      },
      role: ''
    }))

    setAllNodes(baremetalList)

    const eligibleForCP = baremetalList.filter((n: NodeData) => canBeControlPlane(n))

    if (eligibleForCP.length > 0) {
      eligibleForCP[0].role = 'control_plane'
    }

    baremetalList.forEach((node: NodeData) => {
      if (!node.role && node.hostname !== 'dns' && (node.type === 'baremetal' || node.cpu >= 2)) {
        node.role = 'worker'
      }
    })

    setAllNodes(baremetalList)
  }, [])

  useEffect(() => {
    validateRoles()
  }, [allNodes])

  return (
    <TkPageWrapper title="Kubernetes Role Assignment">
      <TkCard className="mb-6">
        <TkCardContent className="pt-6">
          <h2 className="text-xl font-semibold mb-4">Role Requirements</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <h3 className="font-semibold mb-2">Control Plane Node</h3>
              <ul className="text-sm space-y-1 text-muted-foreground">
                <li>• Manages Kubernetes API and cluster state</li>
                <li>• Requires at least 4 CPU cores and 8GB RAM</li>
                <li>• Can also run workloads (single-node cluster)</li>
                <li>• Must be baremetal (no VM support)</li>
              </ul>
            </div>

            <div>
              <h3 className="font-semibold mb-2">Worker Nodes (Optional)</h3>
              <ul className="text-sm space-y-1 text-muted-foreground">
                <li>• Additional nodes for workloads</li>
                <li>• Not required for single-node setups</li>
                <li>• GPU nodes for AI workloads</li>
                <li>• More nodes = more capacity</li>
              </ul>
            </div>
          </div>
        </TkCardContent>
      </TkCard>

      <TkCard className="mb-6">
        <TkCardContent className="pt-6">
          <h2 className="text-xl font-semibold mb-4">Assign Roles to Nodes</h2>

          <div className="space-y-4">
            {baremetalNodes.length > 0 && (
              <div>
                <h3 className="font-semibold mb-2">Baremetal Servers</h3>
                <div className="space-y-2">
                  {baremetalNodes.map((node) => (
                    <div
                      key={node.id}
                      className="flex items-center justify-between p-3 rounded-lg bg-muted"
                    >
                      <div className="flex items-center gap-3">
                        <div>
                          <p className="font-medium">{node.hostname}</p>
                          <p className="text-sm text-muted-foreground">
                            {node.cpu} CPU, {node.memory} GB RAM
                            {getNodeGPUStatus(node) && (
                              <TkBadge variant="success" className="ml-2">
                                {getNodeGPUStatus(node)}
                              </TkBadge>
                            )}
                          </p>
                        </div>
                      </div>

                      <TkSelect
                        value={node.role || "none"}
                        onValueChange={(value: string) => handleRoleChange(node.id, value === "none" ? "" : value)}
                      >
                        <TkSelectTrigger className="w-[180px]">
                          <TkSelectValue placeholder="No Role" />
                        </TkSelectTrigger>
                        <TkSelectContent>
                          <TkSelectItem value="none">No Role</TkSelectItem>
                          <TkSelectItem value="worker">Worker</TkSelectItem>
                          <TkSelectItem
                            value="control_plane"
                            disabled={!canBeControlPlane(node) || (controlPlaneNodes.length > 0 && node.role !== 'control_plane')}
                          >
                            Control Plane
                          </TkSelectItem>
                        </TkSelectContent>
                      </TkSelect>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </TkCardContent>
      </TkCard>

      {validationErrors.length > 0 && (
        <TkAlert className="bg-warning/10 text-warning border-warning/20 mb-6">
          <AlertTriangle className="h-4 w-4" />
          <TkAlertDescription>
            <div className="space-y-1">
              {validationErrors.map((error, index) => (
                <p key={index}>{error}</p>
              ))}
            </div>
          </TkAlertDescription>
        </TkAlert>
      )}

      <div className="flex justify-between">
        <TkButton
          variant="ghost"
          className="gap-2"
          onClick={() => router.push('/hardware-detection')}
        >
          <ChevronLeft className="w-5 h-5" />
          Back
        </TkButton>

        <TkButton
          className="gap-2"
          onClick={saveAndContinue}
          disabled={!isValid}
        >
          Continue to Configuration
          <ChevronRight className="w-5 h-5" />
        </TkButton>
      </div>
    </TkPageWrapper>
  )
}
