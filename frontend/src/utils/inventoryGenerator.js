/*
 * Copyright 2025 Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Dynamic Inventory Generator for Thinkube Installer
 * Generates Ansible inventory based on user configuration with dynamic network allocation
 */

export function generateDynamicInventory() {
  // Get all configuration from sessionStorage and localStorage
  const config = JSON.parse(localStorage.getItem('thinkube-config') || '{}')
  const networkConfiguration = JSON.parse(sessionStorage.getItem('networkConfiguration') || '{}')
  const clusterNodes = JSON.parse(sessionStorage.getItem('clusterNodes') || '[]')
  const gpuAssignments = JSON.parse(sessionStorage.getItem('gpuAssignments') || '{}')  // GPU assignments from Review
  const hardwareData = JSON.parse(sessionStorage.getItem('hardwareData') || '{}')  // Hardware detection data
  const deploymentType = sessionStorage.getItem('deploymentType')
  
  // Debug GPU assignments
  console.log('GPU Assignments:', gpuAssignments)
  console.log('Cluster Nodes:', clusterNodes)
  console.log('Hardware Data:', hardwareData)
  
  // Validate required configuration exists
  if (!networkConfiguration.networkConfig) {
    throw new Error('Network configuration is required. Please complete the network configuration step.')
  }
  
  if (!networkConfiguration.physicalServers || networkConfiguration.physicalServers.length === 0) {
    throw new Error('Baremetal server configuration is required.')
  }
  
  if (!config.domainName) {
    throw new Error('Domain name is required.')
  }
  
  // Overlay provider credential validation
  const overlayProvider = config.overlayProvider || 'zerotier'
  if (overlayProvider === 'zerotier') {
    if (!config.zerotierNetworkId) {
      throw new Error('ZeroTier network ID is required.')
    }
    if (!config.zerotierApiToken) {
      throw new Error('ZeroTier API token is required.')
    }
  } else {
    if (!config.tailscaleAuthKey) {
      throw new Error('Tailscale auth key is required.')
    }
    if (!config.tailscaleApiToken) {
      throw new Error('Tailscale API token is required.')
    }
  }
  
  const networkConfig = networkConfiguration.networkConfig
  const configuredPhysicalServers = networkConfiguration.physicalServers
  
  
  // Validate required network configuration. The overlayCIDR + Cilium L2
  // LB IP pool only matter in ZeroTier mode. In Tailscale mode the
  // operator assigns IPs dynamically (see TAILSCALE_OPERATOR_MIGRATION.md).
  if (!networkConfig.cidr) {
    throw new Error('Network CIDR is required.')
  }

  if (!networkConfig.gateway) {
    throw new Error('Network gateway is required.')
  }

  if (overlayProvider === 'zerotier' && !networkConfig.overlayCIDR) {
    throw new Error('Overlay network CIDR is required.')
  }

  // Build inventory structure
  const inventory = {
    all: {
      vars: {
        // Global variables from user configuration
        domain_name: config.domainName,
        cluster_name: config.clusterName,
        admin_username: 'tkadmin',
        system_username: config.systemUsername,
        auth_realm_username: 'thinkube',
        ansible_python_interpreter: '/usr/bin/python3',
        ansible_become_pass: "{{ lookup('env', 'ANSIBLE_BECOME_PASSWORD') }}",
        home: "{{ lookup('env', 'HOME') }}",

        // Network configuration (user-provided values only)
        network_cidr: networkConfig.cidr,
        network_gateway: networkConfig.gateway,
        dns_servers: ["8.8.8.8", "8.8.4.4"],
        dns_search_domains: [],  // No custom DNS search domains to prevent wildcard matching

        // Network mode — always overlay
        network_mode: 'overlay',

        // Cilium load balancer IP range (k8s-snap built-in load balancer).
        // Only used in ZeroTier mode; in Tailscale mode the Tailscale
        // Operator assigns LB IPs dynamically and the playbook skips
        // `k8s enable load-balancer` entirely.
        ...(overlayProvider === 'zerotier' && {
          lb_ip_start_octet: networkConfig.lbStartOctet || "200",
          lb_ip_end_octet: networkConfig.lbEndOctet || "210",
        }),
        
        // Kubernetes configuration (will be configured later with k8s-snap)
        
        // Cloudflare configuration - token written directly to inventory
        cloudflare_api_token: sessionStorage.getItem('cloudflareToken') || '',
        
        // GitHub configuration
        github_org: config.githubOrg || sessionStorage.getItem('githubOrg') || '',
        github_token: sessionStorage.getItem('githubToken') || '',
        
        // Admin email for Let's Encrypt registration
        admin_email: config.adminEmail || 'admin@' + config.domainName
      },
      children: {
        // Architecture groups
        arch: {
          children: {
            x86_64: {
              hosts: {}
            },
            arm64: {
              hosts: {}
            }
          }
        },
        
        // Physical servers (baremetal)
        baremetal: {
          hosts: {},
          children: {
            headless: {
              hosts: {}
            },
            desktops: {
              hosts: {}
            },
            dgx: {
              hosts: {}
            }
          }
        },
        
        
        // Kubernetes groups
        k8s: {
          children: {
            k8s_control_plane: {
              hosts: {}
            },
            k8s_workers: {
              hosts: {}
            }
          }
        },

        // k8s_cluster group - includes all k8s nodes (control plane + workers)
        k8s_cluster: {
          children: {
            k8s_control_plane: {},
            k8s_workers: {}
          }
        },
        
        // Overlay network nodes - all nodes that need overlay networking (ZeroTier or Tailscale)
        overlay_nodes: {
          hosts: {}
        },
        
        // Management group - where Ansible runs from
        management: {
          hosts: {}
        },
        
        // GPU passthrough VMs
        
        // Baremetal node GPU configuration
        baremetal_gpus: {
          vars: {}
        }
      }
    }
  }
  
  // Overlay network configuration
  inventory.all.vars.overlay_provider = overlayProvider
  if (overlayProvider === 'zerotier') {
    inventory.all.vars.overlay_cidr = networkConfig.overlayCIDR
    inventory.all.vars.overlay_subnet_prefix = networkConfig.overlayCIDR.split('/')[0].split('.').slice(0, 3).join('.') + '.'
  }

  // Provider-specific variables
  if (overlayProvider === 'zerotier') {
    inventory.all.vars.zerotier_network_id = config.zerotierNetworkId
    inventory.all.vars.zerotier_api_token = config.zerotierApiToken
  } else {
    inventory.all.vars.tailscale_auth_key = config.tailscaleAuthKey
    inventory.all.vars.tailscale_api_token = config.tailscaleApiToken
    inventory.all.vars.tailscale_oauth_client_id = config.tailscaleOauthClientId
    inventory.all.vars.tailscale_oauth_client_secret = config.tailscaleOauthClientSecret
    inventory.all.vars.gateway_hostname = config.gatewayHostname
  }

  // Ingress IP configuration — only meaningful in ZeroTier mode (Cilium L2
  // LB picks IPs from the overlay subnet). In Tailscale mode the operator
  // assigns IPs and the dns-server / gateway-api playbooks discover them
  // from Service status.
  if (overlayProvider === 'zerotier') {
    inventory.all.vars.primary_ingress_ip_octet = networkConfig.primaryIngressOctet || "200"
    inventory.all.vars.dns_external_ip_octet = networkConfig.dnsExternalOctet
    inventory.all.vars.primary_ingress_ip = networkConfig.overlayCIDR.split('/')[0].split('.').slice(0, 3).join('.') + '.' + (networkConfig.primaryIngressOctet || "200")
  }

  // Container build architecture configuration — auto-derived from detected node architectures
  const savedBuildArch = sessionStorage.getItem('buildArchitecture')
  let buildArchitecture = savedBuildArch
  if (!buildArchitecture) {
    const archSet = new Set()
    discoveredServers.forEach(s => {
      if (s.architecture) {
        const arch = s.architecture.toLowerCase()
        if (arch === 'x86_64' || arch === 'amd64') archSet.add('amd64')
        else if (arch === 'aarch64' || arch === 'arm64') archSet.add('arm64')
      }
    })
    if (archSet.size === 0) buildArchitecture = 'amd64'
    else if (archSet.size === 1) buildArchitecture = [...archSet][0]
    else buildArchitecture = 'both'
  }
  const platformMap = {
    'amd64': 'linux/amd64',
    'arm64': 'linux/arm64',
    'both': 'linux/amd64,linux/arm64'
  }
  inventory.all.vars.container_build_platforms = platformMap[buildArchitecture]

  // Add baremetal servers from network configuration
  const discoveredServers = JSON.parse(sessionStorage.getItem('discoveredServers') || '[]')

  configuredPhysicalServers.forEach(server => {
    const hostname = server.hostname

    // Find this server in discovered servers (for architecture and local detection)
    const discoveredServer = discoveredServers.find(s =>
      s.hostname === hostname || s.host === hostname || s.ip === server.ip
    )

    const serverArch = discoveredServer?.architecture
    if (!serverArch) {
      throw new Error(`Architecture not detected for ${hostname} — run hardware discovery first`)
    }
    // Normalize architecture name
    const normalizedArch = serverArch.toLowerCase() === 'aarch64' ? 'arm64' :
                          serverArch.toLowerCase() === 'arm64' ? 'arm64' : 'x86_64'

    // ZeroTier: ssh to the overlay IP and pin overlay_ip per host so the
    // playbooks can advertise it. Tailscale: ssh over the LAN (we don't
    // know the tailnet IP until the node joins) and skip overlay_ip — the
    // tailnet IP is auto-assigned and discovered at runtime.
    const serverDef = {
      ansible_host:
        overlayProvider === 'zerotier' ? (server.overlayIP || server.ip) : server.ip,
      lan_ip: server.ip || server.localIP || '',
      arch: normalizedArch,
    }
    if (overlayProvider === 'zerotier') {
      serverDef.overlay_ip = server.overlayIP || server.ip
    }

    // Special handling for local connection
    // The server discovery process should have marked which server is local
    // ONLY set ansible_connection: local if we have explicit confirmation
    // that this server is the local machine (where the installer is running)
    if (discoveredServer?.is_local) {
      serverDef.ansible_connection = 'local'
    }
    // REMOVED: Do not assume first server is local - this causes issues
    // when the installer runs on a different machine
    
    // Determine if this host needs GPU passthrough configuration
    const assignedSlots = []
    
    // Since we no longer have VMs, all GPUs are for baremetal use
    // No GPU passthrough configuration needed
    
    const hasGPUPassthrough = assignedSlots.length > 0
    serverDef.configure_gpu_passthrough = hasGPUPassthrough
    
    // Add assigned PCI slots if any
    if (hasGPUPassthrough) {
      serverDef.assigned_pci_slots = assignedSlots
      console.log(`Host ${hostname} configured for GPU passthrough with slots: ${assignedSlots}`)
    }

    // Add GPU node configuration from GPU Driver Check screen
    const gpuNodes = config.gpuNodes || []
    const gpuNodeConfig = gpuNodes.find(node =>
      node.hostname === hostname || node.ip === server.ip
    )

    if (gpuNodeConfig) {
      serverDef.gpu_node_config = {
        gpu_detected: gpuNodeConfig.gpu_detected,
        gpu_name: gpuNodeConfig.gpu_name,
        gpu_enabled: gpuNodeConfig.gpu_enabled,
        driver_preinstalled: gpuNodeConfig.driver_preinstalled,
        driver_version: gpuNodeConfig.driver_version,
        needs_driver_install: gpuNodeConfig.needs_driver_install,
        reason: gpuNodeConfig.reason
      }
      console.log(`Host ${hostname} GPU config:`, serverDef.gpu_node_config)
    }

    // Add to inventory
    inventory.all.children.baremetal.hosts[hostname] = serverDef
    
    // Add to architecture group
    inventory.all.children.arch.children[serverDef.arch].hosts[hostname] = {}
    
    // Add to management group if it has local connection (is the installer host)
    if (serverDef.ansible_connection === 'local') {
      inventory.all.children.management.hosts[hostname] = {}
      // Assume the local host is a desktop (since we're running the installer GUI on it)
      inventory.all.children.baremetal.children.desktops.hosts[hostname] = {}
    } else {
      // Other servers are headless
      inventory.all.children.baremetal.children.headless.hosts[hostname] = {}
    }
    
    // All servers are always on the overlay network
    inventory.all.children.overlay_nodes.hosts[hostname] = {}
  })
  
  
  // Add Kubernetes nodes based on clusterNodes assignments
  // Add Kubernetes nodes - only baremetal nodes supported (no VMs/LXD)
  clusterNodes.forEach((node) => {
    // Skip any VM nodes since LXD is not available
    if (node.type === 'vm') {
      console.warn(`Skipping VM node ${node.hostname} - VM support removed (no LXD)`)
      return
    }

    // clusterNodes.hostname comes from serverHardware discovery and may be null.
    // Resolve the inventory key by matching against configuredPhysicalServers (which
    // use the ZeroTier/LAN IP as hostname, consistent with the baremetal section).
    const matchedServer = configuredPhysicalServers.find(s =>
      (node.hostname && s.hostname === node.hostname) || s.ip === node.ip
    )
    const inventoryHostname = matchedServer?.hostname || node.hostname

    if (!inventoryHostname) {
      console.warn(`Skipping k8s node with no resolvable hostname:`, node)
      return
    }

    if (node.role === 'control_plane') {
      inventory.all.children.k8s.children.k8s_control_plane.hosts[inventoryHostname] = {}
    } else if (node.role === 'worker') {
      inventory.all.children.k8s.children.k8s_workers.hosts[inventoryHostname] = {}
    }
  })
  
  
  // Configure GPU detection for GPU operator
  configuredPhysicalServers.forEach(server => {
    // Get hardware info from stored data
    const serverHardware = JSON.parse(sessionStorage.getItem('serverHardware') || '[]')
    const hwInfo = serverHardware.find(s => s.hostname === server.hostname)
    
    if (hwInfo && hwInfo.hardware && hwInfo.hardware.gpu_detected) {
      // Store GPU info for the inventory
      const gpuInfo = {
        gpu_detected: true,
        gpu_count: hwInfo.hardware.gpu_count || 0,
        gpu_model: hwInfo.hardware.gpu_model || 'Unknown GPU'
      }
      
      // Add to baremetal_gpus group if GPUs are detected
      if (gpuInfo.gpu_count > 0) {
        if (!inventory.all.children.baremetal_gpus.hosts) {
          inventory.all.children.baremetal_gpus.hosts = {}
        }
        inventory.all.children.baremetal_gpus.hosts[server.hostname] = {
          gpu_count: gpuInfo.gpu_count,
          gpu_model: gpuInfo.gpu_model
        }
      }
    }
  })
  
  // Check if we're running from an external controller
  // If no physical server was marked as local, add a controller entry
  const hasLocalServer = configuredPhysicalServers.some(server => {
    const discoveredServer = discoveredServers.find(s => 
      (s.hostname === server.hostname || s.host === server.hostname || s.ip === server.ip) && s.is_local
    )
    return discoveredServer?.is_local
  })
  
  if (!hasLocalServer && configuredPhysicalServers.length > 0) {
    // We're running from an external controller
    // Add controller entry to enable proper management and ZeroTier access
    // 🤖 Controller IP is now configured in UI to prevent conflicts
    const controllerIP = window.location.hostname || 'controller'
    
    // Add controller as a special host
    // Detect architecture from user agent or navigator platform
    let controllerArch = 'x86_64'  // Default to x86_64
    const platform = navigator.platform?.toLowerCase() || ''
    const userAgent = navigator.userAgent?.toLowerCase() || ''
    
    if (platform.includes('arm') || userAgent.includes('arm') || userAgent.includes('aarch64')) {
      controllerArch = 'arm64'
    }
    
    // Controller overlay IP. ZeroTier mode picks one out of the user-defined
    // overlay subnet. Tailscale mode auto-assigns the controller's tailnet IP
    // when the host joins the tailnet, so we don't pin overlay_ip up front.
    const controllerDef = {
      ansible_connection: 'local',
      ansible_host: '127.0.0.1',
      lan_ip: controllerIP !== 'localhost' ? controllerIP : '127.0.0.1',
      arch: controllerArch
    }
    if (overlayProvider === 'zerotier') {
      const overlayPrefix = networkConfig.overlayCIDR.split('/')[0].split('.').slice(0, 3).join('.')
      controllerDef.overlay_ip = networkConfig.controllerOverlayIP || `${overlayPrefix}.10`
    }
    
    // Add controller to inventory. The controller always joins the overlay
    // network too, regardless of whether it ends up being a k8s control plane,
    // so the user can reach cluster services from the installer host.
    inventory.all.children.management.hosts.controller = controllerDef
    inventory.all.children.overlay_nodes.hosts.controller = {}
    inventory.all.children.arch.children[controllerArch].hosts.controller = {}
    
    console.log('External controller detected, added to inventory:', controllerDef)
  }
  
  return inventory
}

/**
 * Convert inventory object to YAML format
 */
export function inventoryToYAML(inventory) {
  // Simple YAML serializer for inventory
  const yaml = []
  yaml.push('---')
  yaml.push('# Dynamically generated inventory by Thinkube Installer')
  yaml.push('')
  
  function indent(level) {
    return '  '.repeat(level)
  }
  
  function writeObject(obj, level = 0) {
    Object.entries(obj).forEach(([key, value]) => {
      if (value === null || value === undefined) return
      
      if (typeof value === 'object' && !Array.isArray(value)) {
        yaml.push(`${indent(level)}${key}:`)
        writeObject(value, level + 1)
      } else if (Array.isArray(value)) {
        yaml.push(`${indent(level)}${key}:`)
        value.forEach(item => {
          if (typeof item === 'object' && item !== null) {
            // Handle objects in arrays
            yaml.push(`${indent(level + 1)}-`)
            Object.entries(item).forEach(([itemKey, itemValue]) => {
              if (typeof itemValue === 'string') {
                yaml.push(`${indent(level + 2)}${itemKey}: "${itemValue}"`)
              } else if (typeof itemValue === 'boolean') {
                yaml.push(`${indent(level + 2)}${itemKey}: ${itemValue}`)
              } else {
                yaml.push(`${indent(level + 2)}${itemKey}: ${itemValue}`)
              }
            })
          } else if (typeof item === 'string' && item.match(/^\d+:\d+\.\d+$/)) {
            yaml.push(`${indent(level + 1)}- "${item}"`)
          } else if (typeof item === 'string') {
            yaml.push(`${indent(level + 1)}- "${item}"`)
          } else {
            yaml.push(`${indent(level + 1)}- ${item}`)
          }
        })
      } else if (typeof value === 'string' && value.includes('{{')) {
        // Quote Jinja2 variables for proper YAML parsing
        yaml.push(`${indent(level)}${key}: "${value}"`)
      } else if (typeof value === 'string') {
        yaml.push(`${indent(level)}${key}: "${value}"`)
      } else {
        yaml.push(`${indent(level)}${key}: ${value}`)
      }
    })
  }
  
  writeObject(inventory)
  return yaml.join('\n')
}