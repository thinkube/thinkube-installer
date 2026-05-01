/*
 * Copyright 2025 Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as React from "react";
import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { TkCard, TkCardContent, TkCardHeader, TkCardTitle } from "thinkube-style/components/cards-data";
import { TkAlert, TkAlertDescription, TkAlertTitle } from "thinkube-style/components/feedback";
import { TkInput } from "thinkube-style/components/forms-inputs";
import { TkLabel } from "thinkube-style/components/forms-inputs";
import { TkButton } from "thinkube-style/components/buttons-badges";
import { TkBadge } from "thinkube-style/components/buttons-badges";
import { TkSeparator, TkPageWrapper } from "thinkube-style/components/utilities";
import { TkStatCard } from "thinkube-style/components/cards-data";
import {
  TkTable,
  TkTableBody,
  TkTableCell,
  TkTableHead,
  TkTableHeader,
  TkTableRow,
} from "thinkube-style/components/tables";
import {
  AlertTriangle,
  Info,
  XCircle,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Server,
  CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import axios from "@/utils/axios";

// TypeScript Interfaces
interface NetworkConfig {
  cidr: string;
  gateway: string;
  overlayCIDR: string;
  primaryIngressOctet: string;
  dnsExternalOctet: string;
  metallbStartOctet: string;
  metallbEndOctet: string;
  controllerOverlayIP: string;
}

interface PhysicalServer {
  hostname: string;
  ip: string;
  overlayIP: string;
  localIP: string;
}

interface ZeroTierMember {
  nodeId: string;
  name?: string;
  online: boolean;
  ipAssignments: string[];
}

interface DiscoveredServer {
  hostname: string;
  ip: string;
  is_local?: boolean;
  architecture?: string;
}

interface ServerNetworkInfo {
  hostname: string;
  cidr?: string;
  gateway?: string;
  localIP?: string;
}

interface ClusterNode {
  hostname: string;
  role: string;
  type: string;
}

interface SavedConfig {
  zerotierNetworkId?: string;
  zerotierApiToken?: string;
  overlayProvider?: string;
}

type BuildArchitecture = "amd64" | "arm64" | "both";

// Pure helper functions - extracted outside component to avoid initialization order issues
function isValidIP(ip: string): boolean {
  if (!ip) return false;
  const regex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;
  if (!regex.test(ip)) return false;

  const parts = ip.split(".");
  return parts.every((part) => {
    const num = parseInt(part, 10);
    return num >= 0 && num <= 255;
  });
}

function isValidCIDR(cidr: string): boolean {
  if (!cidr) return false;
  const parts = cidr.split("/");
  if (parts.length !== 2) return false;

  const ip = parts[0];
  const mask = parseInt(parts[1], 10);

  return isValidIP(ip) && mask >= 0 && mask <= 32;
}

function getNetworkBase(cidr: string): string {
  if (!cidr) return "";
  return cidr.split("/")[0].split(".").slice(0, 3).join(".");
}

function getLastOctet(ip: string): string {
  if (!ip) return "";
  return ip.split(".").pop() || "";
}

function setLastOctet(baseNetwork: string, octet: string): string {
  if (!baseNetwork || !octet) return "";
  return `${baseNetwork}.${octet}`;
}

export default function NetworkConfigurationPage() {
  const navigate = useNavigate();

  // Client-side only rendering flag
  const [mounted, setMounted] = useState(false);

  // State
  const [overlayProvider, setOverlayProvider] = useState<string>("zerotier");
  const [networkConfig, setNetworkConfig] = useState<NetworkConfig>({
    cidr: "192.168.1.0/24",
    gateway: "192.168.1.1",
    overlayCIDR: "",
    primaryIngressOctet: "200",
    dnsExternalOctet: "205",
    metallbStartOctet: "200",
    metallbEndOctet: "210",
    controllerOverlayIP: "",
  });
  const [physicalServers, setPhysicalServers] = useState<PhysicalServer[]>([]);
  const [networkValidationErrors, setNetworkValidationErrors] = useState<
    string[]
  >([]);
  const [buildArchitecture, setBuildArchitecture] =
    useState<BuildArchitecture | null>(null);

  // ZeroTier API state
  const [zerotierLoading, setZerotierLoading] = useState(false);
  const [zerotierError, setZerotierError] = useState("");
  const [zerotierNetworkName, setZerotierNetworkName] = useState("");
  const [zerotierUsedIPs, setZerotierUsedIPs] = useState<string[]>([]);
  const [zerotierMembers, setZerotierMembers] = useState<ZeroTierMember[]>([]);

  // External controller detection
  const [isExternalController, setIsExternalController] = useState(false);
  const [discoveredServers, setDiscoveredServers] = useState<
    DiscoveredServer[]
  >([]);

  // Computed: Detect architectures
  const detectedArchitectures = useMemo(() => {
    if (typeof window === "undefined") return [];

    const servers: DiscoveredServer[] = JSON.parse(
      sessionStorage.getItem("discoveredServers") || "[]"
    );
    const architectures = new Set<string>();

    servers.forEach((server) => {
      if (server.architecture) {
        const arch = server.architecture.toLowerCase();
        if (arch === "x86_64" || arch === "amd64") {
          architectures.add("amd64");
        } else if (arch === "aarch64" || arch === "arm64") {
          architectures.add("arm64");
        }
      }
    });

    return Array.from(architectures).sort();
  }, []);

  // Computed: IP conflicts
  const ipConflicts = useMemo(() => {
    const conflicts: string[] = [];
    const ipToServers: Record<string, string[]> = {};

    physicalServers.forEach((server) => {
      if (server.overlayIP) {
        if (!ipToServers[server.overlayIP]) {
          ipToServers[server.overlayIP] = [];
        }
        ipToServers[server.overlayIP].push(server.hostname);
      }
    });

    if (
      isExternalController &&
      networkConfig.controllerOverlayIP
    ) {
      if (!ipToServers[networkConfig.controllerOverlayIP]) {
        ipToServers[networkConfig.controllerOverlayIP] = [];
      }
      ipToServers[networkConfig.controllerOverlayIP].push("Controller");
    }

    Object.entries(ipToServers).forEach(([ip, servers]) => {
      if (servers.length > 1) {
        conflicts.push(
          `IP ${ip} is assigned to multiple servers: ${servers.join(", ")}`
        );
      }
    });

    return conflicts;
  }, [
    physicalServers,
    isExternalController,
    networkConfig.controllerOverlayIP,
  ]);

  // Computed: Configuration validity
  const isConfigurationValid = useMemo(() => {
    const allServersValid = physicalServers.every(
      (s) => s.overlayIP && isValidIP(s.overlayIP)
    );

    const networkValid =
      isValidIP(networkConfig.gateway) &&
      networkConfig.cidr &&
      networkConfig.overlayCIDR;

    return allServersValid && networkValid && ipConflicts.length === 0;
  }, [physicalServers, networkConfig, ipConflicts]);

  // Computed: Control plane hostname
  const controlPlaneHostname = useMemo(() => {
    if (typeof window === "undefined") return "";

    const clusterNodes: ClusterNode[] = JSON.parse(
      sessionStorage.getItem("clusterNodes") || "[]"
    );
    const controlPlane = clusterNodes.find((n) => n.role === "control_plane");
    return controlPlane?.hostname || "";
  }, []);

  // Computed: MetalLB IPs
  const metallbIPs = useMemo(() => {
    if (
      !networkConfig.overlayCIDR ||
      !networkConfig.metallbStartOctet ||
      !networkConfig.metallbEndOctet
    ) {
      return "";
    }

    const base = getNetworkBase(networkConfig.overlayCIDR);
    const start = parseInt(networkConfig.metallbStartOctet);
    const end = parseInt(networkConfig.metallbEndOctet);

    const ips: string[] = [];
    for (let i = start; i <= end; i++) {
      ips.push(`${base}.${i}`);
    }

    return ips.join(", ");
  }, [
    networkConfig.overlayCIDR,
    networkConfig.metallbStartOctet,
    networkConfig.metallbEndOctet,
  ]);

  // Helper functions (pure functions moved outside component)

  const isOverlayIPInUse = (ip: string): boolean => {
    return zerotierUsedIPs.includes(ip);
  };

  const getOverlayIPStatus = (ip: string): string => {
    if (!ip) return "";
    if (isOverlayIPInUse(ip)) {
      const member = zerotierMembers.find((m) =>
        m.ipAssignments.includes(ip)
      );
      if (member) {
        const memberName = member.name || member.nodeId.substring(0, 10);

        if (!member.online) {
          return `Previously assigned to ${memberName} (offline)`;
        }

        return `Used by ${memberName}`;
      }
      return "Already in use";
    }
    return "";
  };

  const isValidIngressOctet = (octet: string): boolean => {
    if (!octet) return false;
    const num = parseInt(octet, 10);
    return num >= 1 && num <= 254;
  };

  const isIngressIPInUse = (octet: string): boolean => {
    if (!octet) return false;
    if (!networkConfig.overlayCIDR) return false;

    const fullIP = `${getNetworkBase(networkConfig.overlayCIDR)}.${octet}`;
    if (isOverlayIPInUse(fullIP)) {
      const serverWithIP = physicalServers.find(
        (s) => s.overlayIP === fullIP
      );
      if (serverWithIP) return false;
      return true;
    }

    return false;
  };

  const isMetalLBRangeInvalid = (): boolean => {
    const start = parseInt(networkConfig.metallbStartOctet);
    const end = parseInt(networkConfig.metallbEndOctet);

    if (!start || !end || start > end) return true;

    return !isIngressIPInRange();
  };

  const isIngressIPInRange = (): boolean => {
    const start = parseInt(networkConfig.metallbStartOctet);
    const end = parseInt(networkConfig.metallbEndOctet);
    const primary = parseInt(networkConfig.primaryIngressOctet);

    if (!start || !end || !primary) return false;

    return primary >= start && primary <= end;
  };

  const getServerRole = (hostname: string): string => {
    const clusterNodes: ClusterNode[] = JSON.parse(
      (typeof window !== "undefined" ? sessionStorage.getItem("clusterNodes") : null) || "[]"
    );
    const node = clusterNodes.find(
      (n) => n.hostname === hostname && n.type === "baremetal"
    );
    if (!node) return "LXD Host";

    switch (node.role) {
      case "control_plane":
        return "Control Plane";
      case "worker":
        return "Worker";
      default:
        return node.role || "Host";
    }
  };

  const isDNSIPConflict = (): boolean => {
    const dnsOctet = networkConfig.dnsExternalOctet;
    if (!dnsOctet) return false;

    if (dnsOctet === networkConfig.primaryIngressOctet) {
      return true;
    }

    const networkBase = getNetworkBase(networkConfig.overlayCIDR);
    const dnsIP = `${networkBase}.${dnsOctet}`;

    return physicalServers.some(
      (server) => server.ip === dnsIP || server.overlayIP === dnsIP
    );
  };

  const isDNSInMetalLBRange = (): boolean => {
    const dnsOctet = parseInt(networkConfig.dnsExternalOctet);
    const start = parseInt(networkConfig.metallbStartOctet);
    const end = parseInt(networkConfig.metallbEndOctet);

    if (!dnsOctet || !start || !end) return true;

    return dnsOctet >= start && dnsOctet <= end;
  };

  const assignOverlayIPs = () => {
    if (!networkConfig.overlayCIDR) return;

    const zerotierBase = networkConfig.overlayCIDR
      .split("/")[0]
      .split(".")
      .slice(0, 3)
      .join(".");

    const usedIPSet = new Set(zerotierUsedIPs);

    if (isExternalController && networkConfig.controllerOverlayIP) {
      usedIPSet.add(networkConfig.controllerOverlayIP);
    }

    const findNextAvailableIP = (startFrom = 10): string | null => {
      let counter = startFrom;
      while (counter < 254) {
        const testIP = `${zerotierBase}.${counter}`;
        if (!usedIPSet.has(testIP)) {
          usedIPSet.add(testIP);
          return testIP;
        }
        counter++;
      }
      return null;
    };

    setPhysicalServers((servers) =>
      servers.map((server) => {
        if (!server.overlayIP || usedIPSet.has(server.overlayIP)) {
          const newIP = findNextAvailableIP();
          if (newIP) {
            return { ...server, overlayIP: newIP };
          } else {
            setZerotierError("No available ZeroTier IPs");
          }
        }
        return server;
      })
    );
  };

  const fetchOverlayMembers = async (config: SavedConfig) => {
    try {
      const response = await axios.post("/api/fetch-zerotier-members", {
        network_id: config.zerotierNetworkId,
        api_token: config.zerotierApiToken,
      });

      if (response.data.success) {
        setZerotierMembers(response.data.members);
        setZerotierUsedIPs(response.data.used_ips);
      }
    } catch (error) {
    }
  };

  const fetchOverlayNetwork = async () => {
    const config: SavedConfig = JSON.parse(
      localStorage.getItem("thinkube-config") || "{}"
    );

    if (!config.zerotierNetworkId || !config.zerotierApiToken) {
      if (networkConfig.overlayCIDR) {
        await fetchOverlayMembers(config);
        assignOverlayIPs();
      }
      return;
    }

    setZerotierLoading(true);
    setZerotierError("");
    setZerotierNetworkName("");

    try {
      const [networkResponse] = await Promise.all([
        axios.post("/api/fetch-zerotier-network", {
          network_id: config.zerotierNetworkId,
          api_token: config.zerotierApiToken,
        }),
        fetchOverlayMembers(config),
      ]);

      if (networkResponse.data.success) {
        if (!networkConfig.overlayCIDR) {
          setNetworkConfig((prev) => ({
            ...prev,
            overlayCIDR: networkResponse.data.cidr,
          }));
        }
        setZerotierNetworkName(networkResponse.data.network_name);
        setZerotierError("");

        assignOverlayIPs();
      } else {
        setZerotierError(networkResponse.data.message);
      }
    } catch (error: unknown) {
      const err = error as { response?: { data?: { message?: string } } };
      setZerotierError(
        err.response?.data?.message || "Failed to connect to ZeroTier API"
      );
    } finally {
      setZerotierLoading(false);
    }
  };

  const generateDefaultIPs = () => {
    const networkBase = networkConfig.cidr
      .split("/")[0]
      .split(".")
      .slice(0, 3)
      .join(".");

    const usedIPs = physicalServers
      .map((s) => parseInt(s.ip.split(".").pop() || "0"))
      .filter(Boolean);
    let vmIPCounter = Math.max(...usedIPs, 50) + 10;
  };

  const validateNetworkConsistency = (networkInfo: ServerNetworkInfo[]) => {
    setNetworkValidationErrors([]);

    if (networkInfo.length === 0) {
      return;
    }

    const cidrs = [...new Set(networkInfo.map((n) => n.cidr).filter(Boolean))];

    if (cidrs.length > 1) {
      setNetworkValidationErrors([
        `Nodes are on different networks: ${cidrs.join(", ")}`,
      ]);
    }

    if (cidrs.length > 0) {
      const detectedCIDR = cidrs[0];
      const detectedGateway =
        networkInfo.find((n) => n.gateway)?.gateway || "";

      if (detectedCIDR) {
        setNetworkConfig((prev) => ({ ...prev, cidr: detectedCIDR }));
      }
      if (detectedGateway) {
        setNetworkConfig((prev) => ({ ...prev, gateway: detectedGateway }));
      }
    }
  };

  const getClusterNetwork = (): {
    cidr: string;
    gateway: string;
    detected: boolean;
  } => {
    const serverNetworkInfo: ServerNetworkInfo[] = JSON.parse(
      (typeof window !== "undefined" ? sessionStorage.getItem("serverNetworkInfo") : null) || "[]"
    );

    if (serverNetworkInfo.length > 0 && serverNetworkInfo[0].cidr) {
      const clusterCIDR = serverNetworkInfo[0].cidr;
      const gateway =
        serverNetworkInfo[0].gateway ||
        clusterCIDR.split("/")[0].split(".").slice(0, 3).join(".") + ".1";

      return {
        cidr: clusterCIDR,
        gateway: gateway,
        detected: true,
      };
    }

    return {
      cidr: "",
      gateway: "",
      detected: false,
    };
  };

  const saveAndContinue = () => {
    sessionStorage.setItem(
      "networkConfiguration",
      JSON.stringify({
        networkConfig,
        physicalServers,
      })
    );

    navigate("/review");
  };

  // Update network config handlers
  const updateNetworkConfig = (key: keyof NetworkConfig, value: string) => {
    setNetworkConfig((prev) => ({ ...prev, [key]: value }));
  };

  const updateServerIP = (index: number, newOctet: string) => {
    setPhysicalServers((servers) =>
      servers.map((server, idx) => {
        if (idx === index) {
          const base = getNetworkBase(networkConfig.cidr);
          return { ...server, ip: setLastOctet(base, newOctet) };
        }
        return server;
      })
    );
  };

  // Effects
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || buildArchitecture === null) return;
    sessionStorage.setItem("buildArchitecture", buildArchitecture);
  }, [buildArchitecture, mounted]);

  useEffect(() => {
    if (!mounted) return;

    const initializeNetworkConfiguration = async () => {
      const selectedServers: DiscoveredServer[] = JSON.parse(
        sessionStorage.getItem("selectedServers") || "[]"
      );
      const discoveredServersData: DiscoveredServer[] = JSON.parse(
        sessionStorage.getItem("discoveredServers") || "[]"
      );
      const networkCIDR =
        sessionStorage.getItem("networkCIDR") || "192.168.1.0/24";
      const serverNetworkInfo: ServerNetworkInfo[] = JSON.parse(
        sessionStorage.getItem("serverNetworkInfo") || "[]"
      );
      const savedProvider = sessionStorage.getItem("overlayProvider") || "zerotier";
      setOverlayProvider(savedProvider);

      const serversToUse =
        selectedServers.length > 0 ? selectedServers : discoveredServersData;

      if (serversToUse.length > 0) {
        const mappedServers: PhysicalServer[] = serversToUse.map((server) => {
          const netInfo = serverNetworkInfo.find(
            (n) => n.hostname === server.hostname
          );

          return {
            hostname: server.hostname || server.ip,
            ip: netInfo?.localIP || "",
            overlayIP: (server as any).overlayIP || server.ip || "",
            localIP: netInfo?.localIP || "",
          };
        });

        setPhysicalServers(mappedServers);
        validateNetworkConsistency(serverNetworkInfo);
      }

      setDiscoveredServers(serversToUse);

      if (detectedArchitectures.length === 1) {
        setBuildArchitecture(detectedArchitectures[0] as BuildArchitecture);
      } else if (detectedArchitectures.length > 1) {
        setBuildArchitecture("both");
      } else {
        setBuildArchitecture("amd64");
      }

      const hasLocalServer = discoveredServers.some(
        (server) => server.is_local
      );
      setIsExternalController(!hasLocalServer && discoveredServers.length > 0);

      setNetworkConfig((prev) => ({ ...prev, overlayCIDR: networkCIDR }));

      const clusterNet = getClusterNetwork();
      if (clusterNet.detected) {
        setNetworkConfig((prev) => ({
          ...prev,
          cidr: clusterNet.cidr,
          gateway: clusterNet.gateway,
        }));
      } else {
        setNetworkValidationErrors([
          "Unable to detect cluster network from nodes. Hardware detection may have failed.",
        ]);
      }

      const existingCIDR = networkConfig.overlayCIDR;
      await fetchOverlayNetwork();
      if (!networkConfig.overlayCIDR && existingCIDR) {
        setNetworkConfig((prev) => ({ ...prev, overlayCIDR: existingCIDR }));
      }

      generateDefaultIPs();

      const savedConfig = sessionStorage.getItem("networkConfiguration");
      if (savedConfig) {
        const parsed = JSON.parse(savedConfig);
        const currentOverlayCIDR = networkConfig.overlayCIDR;
        const currentLocalCIDR = networkConfig.cidr;
        setNetworkConfig({ ...networkConfig, ...parsed.networkConfig });

        setNetworkConfig((prev) => ({
          ...prev,
          overlayCIDR: currentOverlayCIDR || parsed.networkConfig.overlayCIDR,
          cidr: currentLocalCIDR || parsed.networkConfig.cidr,
        }));
        if (parsed.physicalServers) setPhysicalServers(parsed.physicalServers);
      }

      if (networkConfig.overlayCIDR) {
        assignOverlayIPs();
      }
    };

    initializeNetworkConfiguration();
  }, [mounted]);

  // Prevent SSR rendering - wait for client-side mount
  if (!mounted) {
    return null;
  }

  return (
    <TkPageWrapper title="Network Configuration">
      {/* Network Validation Messages */}
      {networkValidationErrors.length > 0 && (
        <TkAlert className="mb-6 bg-warning/10 text-warning border-warning/50">
          <AlertTriangle className="h-5 w-5" />
          <div>
            <TkAlertTitle className="font-bold">
              Network Configuration Issues
            </TkAlertTitle>
            <TkAlertDescription>
              <ul className="text-sm mt-1 space-y-1">
                {networkValidationErrors.map((error, index) => (
                  <li key={index}>{error}</li>
                ))}
              </ul>
            </TkAlertDescription>
          </div>
        </TkAlert>
      )}

      {/* Network Overview */}
      <TkCard className="mb-6">
        <TkCardHeader>
          <TkCardTitle>Network Overview</TkCardTitle>
        </TkCardHeader>
        <TkCardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <TkLabel>
                    Overlay Network CIDR
                    <span className="text-xs text-muted-foreground ml-2">
                      Remote access network
                    </span>
                  </TkLabel>
                  <TkInput
                    value={networkConfig.overlayCIDR}
                    readOnly
                    className="bg-muted"
                  />
                </div>

                <div className="space-y-2">
                  <TkLabel>
                    Kubernetes Cluster CIDR
                    <span className="text-xs text-muted-foreground ml-2">
                      Node network
                    </span>
                  </TkLabel>
                  <TkInput
                    value={networkConfig.cidr}
                    placeholder="10.0.0.0/24"
                    readOnly
                    className="bg-muted"
                    title="Auto-detected from cluster nodes"
                  />
                </div>
          </div>

          {zerotierLoading && (
            <div className="flex items-center gap-3 mt-4">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Fetching overlay network details...</span>
            </div>
          )}

          {zerotierError && (
            <TkAlert variant="destructive" className="mt-4">
              <XCircle className="h-5 w-5" />
              <div>
                <TkAlertTitle className="font-bold">
                  Failed to fetch overlay network
                </TkAlertTitle>
                <TkAlertDescription className="text-sm">
                  {zerotierError}
                </TkAlertDescription>
              </div>
            </TkAlert>
          )}

          {zerotierNetworkName && (
            <TkAlert className="mt-4 bg-info/10 border-info/50">
              <Info className="h-5 w-5 text-info" />
              <div>
                <TkAlertTitle className="font-bold">
                  Dual Network Configuration
                </TkAlertTitle>
                <TkAlertDescription className="text-sm">
                  <strong>Overlay ({zerotierNetworkName}):</strong> Remote
                  management and distributed access
                  <br />
                  <strong>Local LAN ({networkConfig.cidr}):</strong> High-speed
                  cluster internal communication
                </TkAlertDescription>
              </div>
            </TkAlert>
          )}
        </TkCardContent>
      </TkCard>

      {/* Ingress IP Configuration */}
      {(
        <TkCard className="mb-6">
          <TkCardHeader>
            <TkCardTitle>Ingress IP Configuration</TkCardTitle>
          </TkCardHeader>
          <TkCardContent>
            <TkAlert className="mb-4 bg-info/10 border-info/50">
              <Info className="h-5 w-5 text-info" />
              <div>
                <TkAlertTitle className="font-bold">
                  Load Balancer IP Range
                </TkAlertTitle>
                <TkAlertDescription className="text-sm">
                  These IPs will be reserved on the overlay network for external access to services
                </TkAlertDescription>
              </div>
            </TkAlert>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <TkLabel>
                  Primary Ingress IP
                  <span className="text-xs text-muted-foreground ml-2">
                    For main services
                  </span>
                </TkLabel>
                <div className="flex items-center gap-1">
                  <span className="text-sm text-muted-foreground">
                    {getNetworkBase(
                      networkConfig.overlayCIDR
                    )}
                    .
                  </span>
                  <TkInput
                    type="number"
                    min={1}
                    max={254}
                    placeholder="200"
                    value={networkConfig.primaryIngressOctet}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      updateNetworkConfig("primaryIngressOctet", e.target.value)
                    }
                    className={cn(
                      "w-20",
                      (!isValidIngressOctet(networkConfig.primaryIngressOctet) ||
                        isIngressIPInUse(networkConfig.primaryIngressOctet)) &&
                        "border-warning focus-visible:ring-warning"
                    )}
                  />
                </div>
                {isIngressIPInUse(networkConfig.primaryIngressOctet) && (
                  <p className="text-xs text-warning mt-1">
                    This IP is already assigned to another ZeroTier member
                  </p>
                )}
              </div>

            </div>

            {/* DNS External IP */}
            <TkSeparator className="my-6" />
            <h3 className="font-medium mb-4">DNS Configuration</h3>

            <div className="space-y-2">
              <TkLabel>
                CoreDNS External IP
                <span className="text-xs text-muted-foreground ml-2">
                  External IP for DNS resolution
                </span>
              </TkLabel>
              <div className="flex items-center gap-1">
                <span className="text-sm text-muted-foreground">
                  {getNetworkBase(
networkConfig.overlayCIDR
                  )}
                  .
                </span>
                <TkInput
                  type="number"
                  min={1}
                  max={254}
                  placeholder="250"
                  value={networkConfig.dnsExternalOctet}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    updateNetworkConfig("dnsExternalOctet", e.target.value)
                  }
                  className={cn(
                    "w-20",
                    (!isValidIngressOctet(networkConfig.dnsExternalOctet) ||
                      isDNSIPConflict() ||
                      !isDNSInMetalLBRange()) &&
                      "border-destructive focus-visible:ring-destructive"
                  )}
                />
              </div>
              {isDNSIPConflict() && (
                <TkLabel className="text-xs text-destructive">
                  DNS IP conflicts with other assignments
                </TkLabel>
              )}
              {!isDNSIPConflict() && !isDNSInMetalLBRange() && (
                <TkLabel className="text-xs text-destructive">
                  DNS IP should be within MetalLB range (
                  {networkConfig.metallbStartOctet}-
                  {networkConfig.metallbEndOctet})
                </TkLabel>
              )}
            </div>

            {/* Load Balancer IP Range */}
            <TkSeparator className="my-6" />
            <h3 className="font-medium mb-4">Load Balancer IP Range</h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <TkLabel>
                  Load Balancer Start IP
                  <span className="text-xs text-muted-foreground ml-2">
                    First IP in range
                  </span>
                </TkLabel>
                <div className="flex items-center gap-1">
                  <span className="text-sm text-muted-foreground">
                    {getNetworkBase(
                      networkConfig.overlayCIDR
                    )}
                    .
                  </span>
                  <TkInput
                    type="number"
                    min={1}
                    max={254}
                    placeholder="200"
                    value={networkConfig.metallbStartOctet}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      updateNetworkConfig("metallbStartOctet", e.target.value)
                    }
                    className={cn(
                      "w-20",
                      (!isValidIngressOctet(networkConfig.metallbStartOctet) ||
                        isMetalLBRangeInvalid()) &&
                        "border-destructive focus-visible:ring-destructive"
                    )}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <TkLabel>
                  Load Balancer End IP
                  <span className="text-xs text-muted-foreground ml-2">
                    Last IP in range
                  </span>
                </TkLabel>
                <div className="flex items-center gap-1">
                  <span className="text-sm text-muted-foreground">
                    {getNetworkBase(
                      networkConfig.overlayCIDR
                    )}
                    .
                  </span>
                  <TkInput
                    type="number"
                    min={1}
                    max={254}
                    placeholder="210"
                    value={networkConfig.metallbEndOctet}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      updateNetworkConfig("metallbEndOctet", e.target.value)
                    }
                    className={cn(
                      "w-20",
                      (!isValidIngressOctet(networkConfig.metallbEndOctet) ||
                        isMetalLBRangeInvalid()) &&
                        "border-destructive focus-visible:ring-destructive"
                    )}
                  />
                </div>
              </div>
            </div>

            {isMetalLBRangeInvalid() && (
              <TkAlert variant="destructive" className="mt-2">
                <XCircle className="h-5 w-5" />
                <div>
                  {parseInt(networkConfig.metallbStartOctet) >
                  parseInt(networkConfig.metallbEndOctet) ? (
                    <TkAlertDescription>
                      Start IP must be less than or equal to End IP
                    </TkAlertDescription>
                  ) : (
                    <TkAlertDescription>
                      Primary ingress IP ({networkConfig.primaryIngressOctet}) must
                      be within the Load Balancer range
                    </TkAlertDescription>
                  )}
                </div>
              </TkAlert>
            )}

            {networkConfig.primaryIngressOctet &&
              networkConfig.metallbStartOctet &&
              networkConfig.metallbEndOctet &&
              !isMetalLBRangeInvalid() && (
                <div className="mt-4">
                  <div className="prose prose-sm max-w-none text-muted-foreground">
                    <p className="font-medium mb-2">Load Balancer Configuration:</p>
                    <ul className="space-y-1">
                      <li>
                        IP Range:{" "}
                        <span className="font-mono">
                          {getNetworkBase(
networkConfig.overlayCIDR
                          )}
                          .{networkConfig.metallbStartOctet}-
                          {getNetworkBase(
networkConfig.overlayCIDR
                          )}
                          .{networkConfig.metallbEndOctet}
                        </span>
                      </li>
                      <li>
                        Primary Ingress:{" "}
                        <span className="font-mono">
                          {getNetworkBase(
networkConfig.overlayCIDR
                          )}
                          .{networkConfig.primaryIngressOctet}
                        </span>
                      </li>
                    </ul>
                  </div>
                </div>
              )}
          </TkCardContent>
        </TkCard>
      )}

      {/* Container Build Architecture */}
      <TkCard className="mb-6">
        <TkCardHeader>
          <TkCardTitle>Container Build Architecture</TkCardTitle>
        </TkCardHeader>
        <TkCardContent>
          <TkAlert className="bg-info/10 border-info/50">
            <Info className="h-5 w-5 text-info" />
            <div className="text-sm">
              <TkAlertTitle className="font-medium">
                Auto-detected from cluster nodes
              </TkAlertTitle>
              <TkAlertDescription className="mt-1">
                {detectedArchitectures.length > 0 ? (
                  <>
                    Detected architectures:{" "}
                    <span className="font-mono font-semibold">
                      {detectedArchitectures.join(", ")}
                    </span>
                    . Container images will be built natively on nodes of each
                    architecture.
                    {detectedArchitectures.length > 1 &&
                      " Additional architectures can be added later by joining nodes through thinkube-control."}
                  </>
                ) : (
                  "No architectures detected from cluster nodes. Defaulting to amd64."
                )}
              </TkAlertDescription>
            </div>
          </TkAlert>
        </TkCardContent>
      </TkCard>

      {/* Baremetal Servers */}
      <TkCard className="mb-6">
        <TkCardHeader>
          <TkCardTitle>Baremetal Servers</TkCardTitle>
        </TkCardHeader>
        <TkCardContent>
          <div className="overflow-x-auto rounded-lg border">
            <TkTable>
              <TkTableHeader>
                <TkTableRow>
                  <TkTableHead className="font-semibold">Hostname</TkTableHead>
                  <TkTableHead className="font-semibold">Overlay IP</TkTableHead>
                  <TkTableHead className="font-semibold">Local IP</TkTableHead>
                  <TkTableHead className="font-semibold">Role</TkTableHead>
                </TkTableRow>
              </TkTableHeader>
              <TkTableBody>
                {physicalServers.map((server, idx) => (
                  <TkTableRow key={server.hostname}>
                    <TkTableCell className="font-medium">
                      {server.hostname}
                    </TkTableCell>
                    <TkTableCell>
                      <div className="flex flex-col gap-1">
                        <span className="text-sm text-muted-foreground">
                          {server.overlayIP || server.ip}
                        </span>
                        {server.overlayIP &&
                          isOverlayIPInUse(server.overlayIP) && (
                            <span className="text-xs text-warning">
                              {getOverlayIPStatus(server.overlayIP)}
                            </span>
                          )}
                      </div>
                    </TkTableCell>
                    <TkTableCell>
                      <div className="text-sm text-muted-foreground">
                        {server.localIP || "Not detected"}
                      </div>
                    </TkTableCell>
                    <TkTableCell>
                      <TkBadge appearance="outlined">
                        {getServerRole(server.hostname)}
                      </TkBadge>
                    </TkTableCell>
                  </TkTableRow>
                ))}
              </TkTableBody>
            </TkTable>
          </div>
        </TkCardContent>
      </TkCard>

      {/* Existing ZeroTier Members Info */}
      {ipConflicts.length > 0 && (
        <TkAlert className="mb-6 bg-info/10 border-info/50">
          <AlertTriangle className="h-5 w-5 text-info" />
          <div>
            <TkAlertTitle className="font-bold">
              Existing ZeroTier Members Detected
            </TkAlertTitle>
            <TkAlertDescription>
              <div className="prose prose-sm max-w-none mt-2">
                <p className="text-sm mb-2">
                  The following IPs are already assigned in your ZeroTier
                  network:
                </p>
                <ul className="text-warning space-y-1">
                  {ipConflicts.map((conflict, index) => (
                    <li key={index}>{conflict}</li>
                  ))}
                </ul>
                <p className="text-sm mt-2 text-info">
                  These are expected if you&apos;re reinstalling on the same
                  servers. The installer will reuse these assignments.
                </p>
              </div>
            </TkAlertDescription>
          </div>
        </TkAlert>
      )}

      {/* Validation Summary */}
      <TkCard className="mb-6">
        <TkCardHeader>
          <TkCardTitle>Configuration Summary</TkCardTitle>
        </TkCardHeader>
        <TkCardContent>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <TkStatCard
              title="Baremetal Servers"
              value={physicalServers.length}
              description={`${
                physicalServers.filter((s) => isValidIP(s.ip)).length
              } with valid IPs`}
              icon={Server}
              variant="primary"
            />

            <TkStatCard
              title="IP Conflicts"
              value={ipConflicts.length}
              description={
                ipConflicts.length === 0 ? "No conflicts" : "Need resolution"
              }
              icon={ipConflicts.length > 0 ? XCircle : CheckCircle2}
              variant={ipConflicts.length > 0 ? "destructive" : "success"}
            />
          </div>
        </TkCardContent>
      </TkCard>

      {/* Actions */}
      <div className="flex justify-between">
        <TkButton
          intent="ghost"
          onClick={() => navigate("/overlay-setup")}
          className="gap-2"
        >
          <ChevronLeft className="w-5 h-5" />
          Back to Configuration
        </TkButton>

        <TkButton
          onClick={saveAndContinue}
          disabled={!isConfigurationValid}
          className="gap-2"
        >
          Review Configuration
          <ChevronRight className="w-5 h-5" />
        </TkButton>
      </div>
    </TkPageWrapper>
  );
}
