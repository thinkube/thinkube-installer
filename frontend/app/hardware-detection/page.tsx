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
import { TkBadge } from "thinkube-style/components/buttons-badges"
import { TkProgress } from "thinkube-style/components/feedback"
import { TkStatCard } from "thinkube-style/components/cards-data"
import { TkPageWrapper } from "thinkube-style/components/utilities"
import {
  Cpu,
  MemoryStick,
  HardDrive,
  Gpu,
  ChevronLeft,
  ChevronRight,
  XCircle,
  AlertTriangle,
  CheckCircle2,
  Info,
  X
} from "lucide-react"
import axios from "@/utils/axios"

interface Hardware {
  cpu_cores: number
  memory_gb: number
  disk_gb: number
  gpu_detected: boolean
  gpu_count?: number
  gpu_model?: string
  nvidia_driver_version?: string
  driver_status?: "compatible" | "old" | "missing"
}

interface Network {
  ip_address?: string
  cidr?: string
  gateway?: string
  interface?: string
}

interface Server {
  hostname: string
  ip: string
  hardware?: Hardware | null
  network?: Network | null
  error?: string | null
}

export default function HardwareDetection() {
  const router = useRouter()

  const [servers, setServers] = useState<Server[]>([])
  const [isDetecting, setIsDetecting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [currentServer, setCurrentServer] = useState("")

  const totalResources = useMemo(() => {
    return servers.reduce(
      (acc, server) => {
        if (server.hardware) {
          acc.cpu += server.hardware.cpu_cores || 0
          acc.memory += server.hardware.memory_gb || 0
          acc.storage += server.hardware.disk_gb || 0
          acc.gpus += server.hardware.gpu_count || 0
        }
        return acc
      },
      { cpu: 0, memory: 0, storage: 0, gpus: 0 }
    )
  }, [servers])

  const hasDetectionErrors = useMemo(() => {
    return servers.some((server) => server.error)
  }, [servers])

  const hasValidHardware = useMemo(() => {
    return servers.some(
      (server) =>
        server.hardware &&
        server.hardware.cpu_cores > 0 &&
        server.hardware.memory_gb > 0 &&
        server.hardware.disk_gb > 0
    )
  }, [servers])

  const gpuServers = useMemo(() => {
    return servers.filter((server) => server.hardware?.gpu_detected)
  }, [servers])

  const compatibleDriverServers = useMemo(() => {
    return gpuServers.filter(
      (server) => server.hardware?.driver_status === "compatible"
    )
  }, [gpuServers])

  const missingDriverServers = useMemo(() => {
    return gpuServers.filter(
      (server) => server.hardware?.driver_status === "missing"
    )
  }, [gpuServers])

  const oldDriverServers = useMemo(() => {
    return gpuServers.filter(
      (server) => server.hardware?.driver_status === "old"
    )
  }, [gpuServers])

  useEffect(() => {
    const loadServers = async () => {
      const discoveredServers = JSON.parse(
        sessionStorage.getItem("discoveredServers") || "[]"
      )
      setServers(
        discoveredServers.map((s: any) => ({
          hostname: s.hostname,
          ip: s.ip_address || s.ip,
          hardware: null,
          network: null,
          error: null
        }))
      )

      if (discoveredServers.length > 0) {
        await detectHardware(
          discoveredServers.map((s: any) => ({
            hostname: s.hostname,
            ip: s.ip_address || s.ip,
            hardware: null,
            network: null,
            error: null
          }))
        )
      }
    }

    loadServers()
  }, [])

  const detectHardware = async (initialServers: Server[]) => {
    setIsDetecting(true)
    setProgress(0)

    try {
      const sshCreds = JSON.parse(
        sessionStorage.getItem("sshCredentials") || "{}"
      )

      const updatedServers = [...initialServers]

      for (let i = 0; i < updatedServers.length; i++) {
        const server = updatedServers[i]
        setCurrentServer(`Detecting ${server.hostname}...`)
        setProgress(((i + 1) / updatedServers.length) * 100)

        try {
          const response = await axios.post("/api/detect-hardware", {
            server: server.ip,
            username: sshCreds.username,
            password: sshCreds.password
          })

          if (response.data.error) {
            server.error = response.data.error
            server.hardware = null
            server.network = null
          } else if (response.data.hardware) {
            const hardware = response.data.hardware
            server.hardware = hardware
            server.network = response.data.network || null

            if (
              hardware.cpu_cores === 0 ||
              hardware.memory_gb === 0 ||
              hardware.disk_gb === 0
            ) {
              server.error = "Hardware detection returned invalid values"
              server.hardware = null
            }
          } else {
            server.error = "Failed to detect hardware"
          }
        } catch (error: any) {
          server.error = error.response?.data?.detail || "Detection failed"
        }

        setServers([...updatedServers])
      }
    } finally {
      setIsDetecting(false)
    }
  }

  const stopInstallation = () => {
    if (
      confirm(
        "Are you sure you want to stop the installation? You will need to manually upgrade NVIDIA drivers on the affected servers and restart the installer."
      )
    ) {
      sessionStorage.clear()
      router.push("/")
    }
  }

  const continueToRoleAssignment = () => {
    sessionStorage.setItem("serverHardware", JSON.stringify(servers))

    const networkInfo = servers
      .filter((s) => s.network?.cidr)
      .map((s) => ({
        hostname: s.hostname,
        ip: s.ip,
        localIP: s.network?.ip_address,
        cidr: s.network?.cidr,
        gateway: s.network?.gateway,
        interface: s.network?.interface
      }))
    sessionStorage.setItem("serverNetworkInfo", JSON.stringify(networkInfo))

    router.push("/role-assignment")
  }

  return (
    <TkPageWrapper title="Hardware Detection">
      {/* Detection TkProgress */}
      {isDetecting && (
        <TkCard className="mb-6">
          <TkCardHeader>
            <TkCardTitle>Detecting Hardware Capabilities</TkCardTitle>
          </TkCardHeader>
          <TkCardContent>
            <TkProgress value={progress} />
            <p className="text-sm mt-2">{currentServer}</p>
          </TkCardContent>
        </TkCard>
      )}

      {/* Server Hardware List */}
      {!isDetecting && (
        <div className="space-y-4 mb-6">
          {servers.map((server) => (
            <TkCard key={server.ip}>
              <TkCardContent className="pt-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <h2 className="text-xl font-bold">{server.hostname}</h2>
                    <TkBadge variant="outline" className="font-mono">
                      {server.ip}
                    </TkBadge>
                  </div>
                </div>

                {/* Hardware Stats */}
                {server.hardware && (
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <TkStatCard
                      title="CPU"
                      value={server.hardware.cpu_cores}
                      description="cores"
                      icon={Cpu}
                      variant="primary"
                    />

                    <TkStatCard
                      title="RAM"
                      value={Math.round(server.hardware.memory_gb)}
                      description="GB"
                      icon={MemoryStick}
                      variant="primary"
                    />

                    <TkStatCard
                      title="Disk"
                      value={Math.round(server.hardware.disk_gb)}
                      description="GB"
                      icon={HardDrive}
                      variant="primary"
                    />

                    {server.hardware.gpu_detected && (
                      <TkStatCard
                        title="GPU"
                        value={server.hardware.gpu_count || 0}
                        description={
                          server.hardware.gpu_model
                            ?.split(" ")
                            .slice(-2)
                            .join(" ") || "Detected"
                        }
                        icon={Gpu}
                        variant="primary"
                        badge={
                          server.hardware.driver_status === "compatible" ? (
                            <TkBadge variant="success">
                              Driver {server.hardware.nvidia_driver_version}
                            </TkBadge>
                          ) : server.hardware.driver_status === "old" ? (
                            <TkBadge variant="warning">
                              Driver {server.hardware.nvidia_driver_version}
                            </TkBadge>
                          ) : (
                            <TkBadge className="bg-info">
                              No driver
                            </TkBadge>
                          )
                        }
                      />
                    )}
                  </div>
                )}

                {/* Detection Error */}
                {server.error && (
                  <TkAlert className="bg-destructive/10 text-destructive border-destructive/20">
                    <XCircle className="h-6 w-6" />
                    <TkAlertDescription>{server.error}</TkAlertDescription>
                  </TkAlert>
                )}
              </TkCardContent>
            </TkCard>
          ))}
        </div>
      )}

      {/* Summary */}
      {!isDetecting && servers.length > 0 && (
        <TkCard className="mb-6">
          <TkCardHeader>
            <TkCardTitle>Cluster Capacity Summary</TkCardTitle>
          </TkCardHeader>
          <TkCardContent>
            <h3 className="font-semibold mb-2">Total Resources</h3>
            <ul className="space-y-1 text-sm text-muted-foreground">
              <li>
                CPU Cores: <span className="font-medium">{totalResources.cpu}</span>
              </li>
              <li>
                Memory:{" "}
                <span className="font-medium">
                  {Math.round(totalResources.memory)}
                </span>{" "}
                GB
              </li>
              <li>
                Storage:{" "}
                <span className="font-medium">
                  {Math.round(totalResources.storage)}
                </span>{" "}
                GB
              </li>
              {totalResources.gpus > 0 && (
                <li>
                  GPUs: <span className="font-medium">{totalResources.gpus}</span>
                </li>
              )}
            </ul>
          </TkCardContent>
        </TkCard>
      )}

      {/* GPU Driver Status */}
      {!isDetecting && gpuServers.length > 0 && (
        <TkCard className="mb-6">
          <TkCardHeader>
            <TkCardTitle>GPU Driver Status</TkCardTitle>
          </TkCardHeader>
          <TkCardContent className="space-y-4">
            {/* Compatible Drivers */}
            {compatibleDriverServers.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <TkBadge variant="success">Compatible</TkBadge>
                  <span className="text-sm">
                    {compatibleDriverServers.length} server(s) with driver &gt;=
                    580.x
                  </span>
                </div>
                <ul className="text-sm text-muted-foreground ml-4 space-y-1">
                  {compatibleDriverServers.map((server) => (
                    <li key={server.ip}>
                      {server.hostname} - Driver{" "}
                      {server.hardware?.nvidia_driver_version}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Missing Drivers */}
            {missingDriverServers.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <TkBadge className="bg-info">Will Install</TkBadge>
                  <span className="text-sm">
                    {missingDriverServers.length} server(s) without drivers
                  </span>
                </div>
                <ul className="text-sm text-muted-foreground ml-4 space-y-1">
                  {missingDriverServers.map((server) => (
                    <li key={server.ip}>
                      {server.hostname} - Driver 580.95.05 will be installed
                      automatically
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Old Drivers */}
            {oldDriverServers.length > 0 && (
              <TkAlert className="bg-warning/10 text-warning border-warning/20">
                <AlertTriangle className="h-6 w-6" />
                <TkAlertDescription>
                  <div>
                    <h3 className="font-bold">Outdated Drivers Detected</h3>
                    <div className="text-sm mt-2">
                      The following servers have NVIDIA drivers older than 580.x,
                      which are not compatible with GPU Operator v25.3.4:
                      <ul className="mt-2 space-y-1 ml-4">
                        {oldDriverServers.map((server) => (
                          <li key={server.ip}>
                            {server.hostname} - Driver{" "}
                            {server.hardware?.nvidia_driver_version} (requires
                            &gt;= 580.x)
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </TkAlertDescription>
              </TkAlert>
            )}
          </TkCardContent>
        </TkCard>
      )}

      {/* Actions */}
      {!isDetecting && (
        <div className="space-y-4">
          {/* Warning for old drivers */}
          {oldDriverServers.length > 0 && (
            <TkAlert className="bg-destructive/10 text-destructive border-destructive/20">
              <XCircle className="h-6 w-6" />
              <TkAlertDescription>
                <div>
                  <h3 className="font-bold">Action Required</h3>
                  <div className="text-sm">
                    Servers with outdated NVIDIA drivers cannot be used for GPU
                    workloads. You have two options:
                    <ul className="mt-2 ml-4 list-disc">
                      <li>
                        <strong>Stop Installation:</strong> Exit the installer,
                        manually upgrade the NVIDIA drivers to 580.x or newer on
                        the affected servers, then restart the installer.
                      </li>
                      <li>
                        <strong>Continue Without GPU Nodes:</strong> Proceed with
                        installation but exclude the affected servers from GPU
                        workloads (they will still be part of the Kubernetes
                        cluster).
                      </li>
                    </ul>
                  </div>
                </div>
              </TkAlertDescription>
            </TkAlert>
          )}

          <div className="flex justify-between">
            <TkButton
              variant="ghost"
              className="gap-2"
              onClick={() => router.push("/ssh-setup")}
            >
              <ChevronLeft className="w-5 h-5" />
              Back
            </TkButton>

            <div className="flex gap-2">
              {oldDriverServers.length > 0 && (
                <TkButton
                  variant="destructive"
                  className="gap-2"
                  onClick={stopInstallation}
                >
                  <X className="w-5 h-5" />
                  Stop Installation
                </TkButton>
              )}

              <TkButton
                className="gap-2"
                onClick={continueToRoleAssignment}
                disabled={
                  servers.length === 0 || hasDetectionErrors || !hasValidHardware
                }
              >
                {oldDriverServers.length > 0
                  ? "Continue Without GPU Nodes"
                  : "Continue to Role Assignment"}
                <ChevronRight className="w-5 h-5" />
              </TkButton>
            </div>
          </div>
        </div>
      )}
    </TkPageWrapper>
  )
}
