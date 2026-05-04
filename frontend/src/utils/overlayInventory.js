/*
 * Copyright 2025 Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Inventory builder for the overlay-install stage (install-zerotier /
 * install-tailscale). The full network configuration step runs *after*
 * overlay setup, so this helper deliberately reads only what's available at
 * this point in the wizard — discovered servers, the overlay provider, the
 * stored credentials, and (for ZeroTier) any IPs already allocated on the
 * overlay-setup page itself.
 *
 * The controller (the host running the installer) is always added to the
 * overlay_nodes group, regardless of whether it's also a cluster node, so
 * that it joins the overlay alongside the cluster.
 */

export function generateOverlayInventory() {
  const discoveredServers = JSON.parse(sessionStorage.getItem('discoveredServers') || '[]')
  if (!discoveredServers.length) {
    throw new Error('No servers discovered. Please complete server discovery first.')
  }

  const provider = sessionStorage.getItem('overlayProvider')
  if (!provider) {
    throw new Error(
      'Overlay provider not selected — go back to the overlay credentials screen.',
    )
  }
  const ansibleUser = sessionStorage.getItem('systemUsername') || 'ubuntu'
  const config = JSON.parse(localStorage.getItem('thinkube-config') || '{}')
  const ipAllocations = JSON.parse(sessionStorage.getItem('overlayIpAllocations') || '{}')

  if (provider === 'zerotier') {
    if (!config.zerotierNetworkId) throw new Error('ZeroTier network ID is required.')
    if (!config.zerotierApiToken) throw new Error('ZeroTier API token is required.')
  } else {
    if (!config.tailscaleAuthKey) throw new Error('Tailscale auth key is required.')
    if (!config.tailscaleApiToken) throw new Error('Tailscale API token is required.')
  }

  const allVars = {
    ansible_user: ansibleUser,
    ansible_become_pass: "{{ lookup('env', 'ANSIBLE_BECOME_PASSWORD') }}",
    ansible_python_interpreter: '/usr/bin/python3',
    overlay_provider: provider,
  }
  if (provider === 'zerotier') {
    allVars.zerotier_network_id = config.zerotierNetworkId
    allVars.zerotier_api_token = config.zerotierApiToken
  } else {
    allVars.tailscale_auth_key = config.tailscaleAuthKey
    allVars.tailscale_api_token = config.tailscaleApiToken
  }

  const overlayHosts = {}

  for (const server of discoveredServers) {
    const hostname = server.hostname || server.host || server.name
    if (!hostname) continue
    const lanIp = server.ip_address || server.ip
    const host = {
      ansible_host: lanIp,
      ansible_user: ansibleUser,
      lan_ip: lanIp,
    }
    const allocated = ipAllocations[hostname]
    if (allocated) host.overlay_ip = allocated
    overlayHosts[hostname] = host
  }

  // The controller (the host running the installer) joins the overlay too.
  // If a discovered server reports as local we use it directly; otherwise we
  // synthesise a controller entry that runs over a local connection.
  const localServer = discoveredServers.find((s) => s.is_local)
  if (!localServer) {
    const controllerHost = {
      ansible_connection: 'local',
      ansible_host: '127.0.0.1',
      ansible_user: ansibleUser,
    }
    if (ipAllocations.controller) controllerHost.overlay_ip = ipAllocations.controller
    overlayHosts.controller = controllerHost
  }

  return {
    all: {
      vars: allVars,
      children: {
        overlay_nodes: { hosts: overlayHosts },
      },
    },
  }
}

export function overlayInventoryToYAML(inventory) {
  let yaml = '---\n'
  yaml += 'all:\n'

  const vars = inventory.all.vars || {}
  if (Object.keys(vars).length) {
    yaml += '  vars:\n'
    for (const [key, value] of Object.entries(vars)) {
      yaml += `    ${key}: ${formatYamlScalar(value)}\n`
    }
  }

  yaml += '  children:\n'
  yaml += '    overlay_nodes:\n'
  yaml += '      hosts:\n'
  const hosts = inventory.all.children.overlay_nodes.hosts
  for (const [hostname, hostVars] of Object.entries(hosts)) {
    yaml += `        ${hostname}:\n`
    for (const [k, v] of Object.entries(hostVars)) {
      yaml += `          ${k}: ${formatYamlScalar(v)}\n`
    }
  }
  return yaml
}

function formatYamlScalar(value) {
  if (typeof value !== 'string') return String(value)
  if (value.includes('{{') || /[:#&*?{}\[\],%@`]/.test(value) || value.trim() !== value) {
    return JSON.stringify(value)
  }
  return value
}
