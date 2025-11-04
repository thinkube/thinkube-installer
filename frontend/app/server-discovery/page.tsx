/*
 * Copyright 2025 Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { TkCard, TkCardContent, TkCardHeader, TkCardTitle } from "thinkube-style/components/cards-data"
import { TkAlert, TkAlertDescription } from "thinkube-style/components/feedback"
import { TkButton } from "thinkube-style/components/buttons-badges"
import { TkBadge } from "thinkube-style/components/buttons-badges"
import { TkProgress } from "thinkube-style/components/feedback"
import { TkInput } from "thinkube-style/components/forms-inputs"
import { TkLabel } from "thinkube-style/components/forms-inputs"
import { TkRadioGroup, TkRadioGroupItem } from "thinkube-style/components/forms-inputs"
import { TkPageWrapper } from "thinkube-style/components/utilities"
import {
  Search,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
  XCircle,
  HelpCircle,
  Loader2
} from "lucide-react"
import axios from "@/utils/axios"

interface Server {
  ip: string
  hostname?: string
  os_info?: string
  ssh_available?: boolean
  confidence?: "confirmed" | "possible" | "failed" | "unknown"
  error?: string
  banner?: string
}

interface DiscoveredServer extends Server {
  is_zerotier?: boolean
}

export default function ServerDiscovery() {
  const router = useRouter()

  const [config] = useState(() => {
    if (typeof window !== "undefined") {
      return JSON.parse(localStorage.getItem("thinkube-config") || "{}")
    }
    return {}
  })

  const [networkMode, setNetworkMode] = useState(config.networkMode || "overlay")
  const [networkCIDR, setNetworkCIDR] = useState("192.168.1.0/24")
  const [isScanning, setIsScanning] = useState(false)
  const [scanProgress, setScanProgress] = useState(0)
  const [scanStatus, setScanStatus] = useState("")
  const [discoveredServers, setDiscoveredServers] = useState<DiscoveredServer[]>([])
  const [selectedServers, setSelectedServers] = useState<DiscoveredServer[]>([])

  useEffect(() => {
    const loadInitialData = async () => {
      if (networkMode === "overlay") {
        try {
          const response = await axios.get("/api/zerotier-network")
          if (response.data.detected) {
            setNetworkCIDR(response.data.network_cidr)
          } else {
            setNetworkCIDR("172.30.0.0/24")
          }
        } catch (error) {
          setNetworkCIDR("172.30.0.0/24")
        }
      } else {
        await autoDetectNetwork()
      }
    }

    loadInitialData()
  }, [])

  const autoDetectNetwork = async () => {
    try {
      const response = await axios.get("/api/local-network")
      if (response.data.detected) {
        setNetworkCIDR(response.data.network_cidr)
      }
    } catch (error) {
      // Keep default value
    }
  }

  const onNetworkModeChange = async (value: string) => {
    setNetworkMode(value)

    if (typeof window !== "undefined") {
      const updatedConfig = { ...config, networkMode: value }
      localStorage.setItem("thinkube-config", JSON.stringify(updatedConfig))
    }

    setDiscoveredServers([])
    setSelectedServers([])

    if (value === "overlay") {
      try {
        const response = await axios.get("/api/zerotier-network")
        if (response.data.detected) {
          setNetworkCIDR(response.data.network_cidr)
        } else {
          setNetworkCIDR("")
        }
      } catch (error) {
        setNetworkCIDR("172.30.0.0/24")
      }
    } else {
      await autoDetectNetwork()
    }
  }

  const startDiscovery = async () => {
    setIsScanning(true)
    setScanProgress(0)
    setScanStatus(
      networkMode === "overlay"
        ? "Connecting to ZeroTier API..."
        : "Initializing scan..."
    )
    setDiscoveredServers([])

    const progressInterval = setInterval(() => {
      setScanProgress((prev) => {
        if (prev < 90) {
          const newProgress = Math.min(90, prev + Math.random() * 20)
          setScanStatus(
            networkMode === "overlay"
              ? `Scanning ZeroTier network ${networkCIDR} - Checking ${Math.floor(newProgress * 2.54)} of 254 hosts`
              : `Scanning ${networkCIDR} - Checking ${Math.floor(newProgress * 2.54)} of 254 hosts`
          )
          return newProgress
        } else {
          setScanStatus("Processing results...")
          return prev
        }
      })
    }, 500)

    try {
      const sudoPassword = sessionStorage.getItem("sudoPassword")
      const currentUsername = sessionStorage.getItem("systemUsername")

      const response = await axios.post(
        "/api/discover-servers",
        {
          network_cidr: networkCIDR,
          test_mode: false,
          username: currentUsername,
          password: sudoPassword
        },
        {
          timeout: 120000
        }
      )

      setDiscoveredServers(response.data.servers || [])
      setScanProgress(100)
      setScanStatus(
        networkMode === "overlay"
          ? `Scan complete - Found ${response.data.servers?.length || 0} servers on ZeroTier network`
          : `Scan complete - Found ${response.data.servers?.length || 0} servers`
      )
    } catch (error: any) {
      setScanStatus("Scan failed: " + error.message)
    } finally {
      clearInterval(progressInterval)
      setTimeout(() => {
        setIsScanning(false)
      }, 1000)
    }
  }

  const verifyServer = async (server: DiscoveredServer) => {
    try {
      const sudoPassword = sessionStorage.getItem("sudoPassword")

      const endpoint = server.is_zerotier
        ? "/api/verify-zerotier-ssh"
        : "/api/verify-server-ssh"
      const response = await axios.post(endpoint, {
        ip_address: server.ip,
        zerotier_ip: server.ip,
        password: sudoPassword,
        test_mode: false
      })

      const idx = discoveredServers.findIndex((s) => s.ip === server.ip)
      if (idx >= 0) {
        const updatedServers = [...discoveredServers]
        if (response.data.connected) {
          updatedServers[idx] = {
            ...updatedServers[idx],
            hostname: response.data.hostname || server.hostname,
            os_info: response.data.os_info,
            confidence: response.data.os_info?.includes("24.04")
              ? "confirmed"
              : "possible",
            error: undefined
          }
        } else {
          updatedServers[idx] = {
            ...updatedServers[idx],
            error: response.data.message || "SSH verification failed",
            confidence: "failed"
          }
          alert(
            `SSH verification failed for ${server.ip}:\n${response.data.message}`
          )
        }
        setDiscoveredServers(updatedServers)
      }
    } catch (error: any) {
      alert(
        `Failed to verify server ${server.ip}:\n${error.response?.data?.detail || error.message}`
      )
    }
  }

  const selectServer = (server: DiscoveredServer) => {
    if (!selectedServers.find((s) => s.ip === server.ip)) {
      setSelectedServers([...selectedServers, server])
    }
  }

  const proceedToNodeConfig = () => {
    sessionStorage.setItem("selectedServers", JSON.stringify(selectedServers))
    sessionStorage.setItem("testMode", "false")
    sessionStorage.setItem("discoveredServers", JSON.stringify(selectedServers))
    sessionStorage.setItem("networkCIDR", networkCIDR)
    router.push("/ssh-setup")
  }

  const getConfidenceIcon = (confidence?: string) => {
    switch (confidence) {
      case "confirmed":
        return <CheckCircle2 className="w-8 h-8 text-success" />
      case "possible":
        return <AlertCircle className="w-8 h-8 text-warning" />
      case "failed":
        return <AlertCircle className="w-8 h-8 text-destructive" />
      default:
        return <HelpCircle className="w-8 h-8 text-muted-foreground" />
    }
  }

  const getConfidenceTooltip = (confidence?: string) => {
    switch (confidence) {
      case "confirmed":
        return "Confirmed Ubuntu"
      case "possible":
        return "Possible Ubuntu"
      case "failed":
        return "SSH Verification Failed"
      default:
        return "Unknown OS"
    }
  }

  return (
    <TkPageWrapper title="Server Discovery">
      {/* Network Mode Selection */}
      <TkCard className="mb-6">
        <TkCardHeader>
          <TkCardTitle>Network Mode</TkCardTitle>
        </TkCardHeader>
        <TkCardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Choose how to discover your servers. ZeroTier is recommended for
            distributed nodes.
          </p>

          <TkRadioGroup
            value={networkMode}
            onValueChange={onNetworkModeChange}
            className="gap-4"
          >
            <div className="flex items-start gap-4 cursor-pointer">
              <TkRadioGroupItem value="overlay" id="overlay" />
              <TkLabel htmlFor="overlay" className="cursor-pointer flex-1">
                <div className="flex flex-col gap-1">
                  <span className="font-medium">
                    Overlay Network (ZeroTier) - Recommended
                  </span>
                  <span className="text-sm text-muted-foreground">
                    Discover nodes on your ZeroTier network
                  </span>
                </div>
              </TkLabel>
            </div>
            <div className="flex items-start gap-4 cursor-pointer">
              <TkRadioGroupItem value="local" id="local" />
              <TkLabel htmlFor="local" className="cursor-pointer flex-1">
                <div className="flex flex-col gap-1">
                  <span className="font-medium">Local Network</span>
                  <span className="text-sm text-muted-foreground">
                    Scan your local network for Ubuntu servers
                  </span>
                </div>
              </TkLabel>
            </div>
          </TkRadioGroup>
        </TkCardContent>
      </TkCard>

      {/* Discovery Controls */}
      <TkCard className="mb-6">
        <TkCardHeader>
          <TkCardTitle>
            {networkMode === "overlay"
              ? "Discover ZeroTier Nodes"
              : "Scan Network for Ubuntu Servers"}
          </TkCardTitle>
        </TkCardHeader>
        <TkCardContent>
          <div className="mb-4">
            <div className="flex justify-between items-end mb-2">
              <TkLabel htmlFor="networkCIDR">
                {networkMode === "overlay"
                  ? "ZeroTier Network CIDR"
                  : "Network CIDR"}
              </TkLabel>
              <span className="text-sm text-muted-foreground">
                {networkMode === "overlay"
                  ? "e.g., 172.30.0.0/24"
                  : "e.g., 192.168.1.0/24"}
              </span>
            </div>
            <TkInput
              id="networkCIDR"
              value={networkCIDR}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNetworkCIDR(e.target.value)}
              placeholder={
                networkMode === "overlay"
                  ? "Enter your ZeroTier network CIDR"
                  : "192.168.1.0/24"
              }
              disabled={isScanning}
            />
          </div>

          <div className="flex items-center gap-4">
            <TkButton onClick={startDiscovery} disabled={isScanning}>
              {isScanning ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Search className="w-5 h-5" />
              )}
              {isScanning
                ? "Discovering..."
                : networkMode === "overlay"
                  ? "Discover ZeroTier Nodes"
                  : "Start Network Scan"}
            </TkButton>
          </div>
        </TkCardContent>
      </TkCard>

      {/* Scanning TkProgress */}
      {isScanning && (
        <TkCard className="mb-6">
          <TkCardContent className="pt-6">
            <div className="flex justify-between items-center mb-4">
              <div>
                <p className="text-lg font-semibold">Scanning Network...</p>
                <p className="text-sm text-muted-foreground">{scanStatus}</p>
              </div>
              <div className="text-2xl font-bold text-primary">
                {Math.round(scanProgress)}%
              </div>
            </div>
            <TkProgress value={scanProgress} />
          </TkCardContent>
        </TkCard>
      )}

      {/* Discovered Servers */}
      {discoveredServers.length > 0 && (
        <TkCard className="mb-6">
          <TkCardHeader>
            <div className="flex items-center gap-2">
              <TkCardTitle>Discovered Servers</TkCardTitle>
              <TkBadge variant="default">{discoveredServers.length}</TkBadge>
            </div>
          </TkCardHeader>
          <TkCardContent>
            <div className="space-y-4">
              {discoveredServers.map((server) => (
                <TkCard key={server.ip} className="bg-muted/50">
                  <TkCardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div
                          className="flex-shrink-0"
                          title={getConfidenceTooltip(server.confidence)}
                        >
                          {getConfidenceIcon(server.confidence)}
                        </div>

                        <div>
                          <h3 className="font-semibold text-lg">
                            {server.ip}
                            {server.hostname && (
                              <span className="text-sm text-muted-foreground ml-2">
                                ({server.hostname})
                              </span>
                            )}
                          </h3>
                          <div className="text-sm text-muted-foreground">
                            {server.error ? (
                              <span className="text-destructive">
                                {server.error}
                              </span>
                            ) : server.os_info ? (
                              <span>{server.os_info}</span>
                            ) : server.ssh_available ? (
                              <span>SSH Available</span>
                            ) : (
                              <span>No SSH Access</span>
                            )}
                            {server.banner && !server.error && (
                              <span className="ml-2 font-mono text-xs">
                                • {server.banner.substring(0, 30)}...
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {server.confidence === "possible" && (
                          <TkButton
                            size="sm"
                            variant="ghost"
                            onClick={() => verifyServer(server)}
                          >
                            Verify
                          </TkButton>
                        )}
                        {server.ssh_available &&
                          !server.error &&
                          !selectedServers.find((s) => s.ip === server.ip) && (
                            <TkButton
                              size="sm"
                              onClick={() => selectServer(server)}
                            >
                              Select
                            </TkButton>
                          )}
                        {server.error && (
                          <TkButton size="sm" variant="destructive" disabled>
                            Failed
                          </TkButton>
                        )}
                        {selectedServers.find((s) => s.ip === server.ip) && (
                          <TkBadge variant="success">Selected</TkBadge>
                        )}
                      </div>
                    </div>
                  </TkCardContent>
                </TkCard>
              ))}
            </div>
          </TkCardContent>
        </TkCard>
      )}

      {/* Navigation */}
      <div className="flex justify-between mt-6">
        <TkButton
          variant="ghost"
          className="gap-2"
          onClick={() => router.push("/installation")}
        >
          <ChevronLeft className="w-5 h-5" />
          Back
        </TkButton>
        <TkButton
          className="gap-2"
          onClick={proceedToNodeConfig}
          disabled={selectedServers.length === 0}
        >
          Continue with {selectedServers.length} Server
          {selectedServers.length !== 1 ? "s" : ""}
          <ChevronRight className="w-5 h-5" />
        </TkButton>
      </div>
    </TkPageWrapper>
  )
}
