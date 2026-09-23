# Copyright Alejandro Martínez Corriá and the Thinkube contributors
# SPDX-License-Identifier: Apache-2.0

"""
API routes for server discovery
"""

from fastapi import APIRouter, HTTPException
from typing import Dict, Any
import logging
import os
import asyncio
import ipaddress
import json
import shlex
from datetime import datetime
from pathlib import Path

from ..core.discovery import discover_ubuntu_servers, verify_ssh_connectivity
from ..utils.network import get_local_ip_addresses
from ..models.server import NetworkDiscoveryRequest, SSHVerificationRequest
from .gpu_names import all_pre_volta, gpu_name, is_gpu

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["discovery"])


# The disk layout needs sudo. The password goes to sudo on its own line,
# never into the command text. The inner script stops at the first failing
# command, so a failure reaches the caller with its own message.
LVM_SCRIPT = r"""set -euo pipefail
INNER=$(cat <<'EOF'
set -euo pipefail
root_dev=$(findmnt -no SOURCE /)
case "$root_dev" in
  /dev/mapper/*)
    vg=$(lvs --noheadings -o vg_name "$root_dev" | tr -d ' ')
    free=$(vgs --noheadings --nosuffix --units g -o vg_free "$vg" | tr -d ' ' | cut -d. -f1)
    lv=$(lvs --noheadings -o lv_path "$root_dev" | tr -d ' ')
    echo "lvm $free $lv" ;;
  *) echo "not-lvm" ;;
esac
EOF
)
printf '%s\n' "$SUDO_PASSWORD" | sudo -S -p '' bash -c "$INNER"
"""

# Each section starts with a marker line; every command must succeed.
HARDWARE_SCRIPT = r"""set -euo pipefail
echo "@@nproc"; nproc
echo "@@arch"; uname -m
echo "@@meminfo"; grep '^MemTotal:' /proc/meminfo
echo "@@disk"; df -B1 --output=size / | tail -1
echo "@@lspci"; lspci -nn
echo "@@driver"; if command -v nvidia-smi >/dev/null; then nvidia-smi --query-gpu=driver_version --format=csv,noheader | head -1; fi
echo "@@route"; ip -o route get 1.1.1.1
echo "@@addr"; ip -o -4 addr show
"""


async def _run_on_node(script, ip_address, username, password, is_local, env=None):
    """Run a bash script on the node and return its output; a failure raises with the script's own error."""
    if is_local:
        cmd = ["bash", "-s"]
    elif password:
        cmd = [
            "sshpass", "-p", password,
            "ssh", "-o", "ConnectTimeout=10",
            "-o", "StrictHostKeyChecking=no",
            "-o", "UserKnownHostsFile=/dev/null",
            "-o", "PreferredAuthentications=password",
            "-o", "PubkeyAuthentication=no",
            f"{username}@{ip_address}",
            "bash -s",
        ]
    else:
        cmd = [
            "ssh", "-o", "ConnectTimeout=10",
            "-o", "StrictHostKeyChecking=no",
            "-o", "UserKnownHostsFile=/dev/null",
            "-o", "BatchMode=yes",
            f"{username}@{ip_address}",
            "bash -s",
        ]
    if env:
        exports = "".join(f"export {name}={shlex.quote(value)}\n" for name, value in env.items())
        script = exports + script
    process = await asyncio.create_subprocess_exec(
        *cmd,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await asyncio.wait_for(process.communicate(input=script.encode()), timeout=60)
    if process.returncode != 0:
        raise RuntimeError(
            f"Command on {ip_address} failed (exit {process.returncode}): "
            f"{stderr.decode(errors='replace').strip()}"
        )
    return stdout.decode(errors="replace")


async def detect_lvm_status(ip_address: str, username: str, password: str, is_local: bool) -> dict:
    """Whether the node's root LV can be grown into free space in its volume group.

    Mirrors thinkube-control's add-node detect_lvm_status.
    """
    if not password:
        raise RuntimeError(
            f"Reading the disk layout of {ip_address} needs sudo, and no SSH password was given. "
            "Enter the password on the SSH credentials page."
        )
    output = (await _run_on_node(
        LVM_SCRIPT, ip_address, username, password, is_local, env={"SUDO_PASSWORD": password}
    )).split()
    if output == ["not-lvm"]:
        return {"lvm_expandable": False, "lvm_free_gb": 0, "lvm_lv_path": ""}
    if len(output) == 3 and output[0] == "lvm" and output[1].isdigit():
        free_gb = int(output[1])
        return {"lvm_expandable": free_gb > 10, "lvm_free_gb": free_gb, "lvm_lv_path": output[2]}
    raise RuntimeError(f"Unexpected disk layout output from {ip_address}: {' '.join(output)}")


def _sections(output):
    """Split the hardware script's output into its marked sections."""
    sections = {}
    current = None
    for line in output.splitlines():
        if line.startswith("@@"):
            current = line[2:]
            sections[current] = []
        elif current is not None:
            sections[current].append(line)
    missing = [name for name in ("nproc", "arch", "meminfo", "disk", "lspci", "driver", "route", "addr") if name not in sections]
    if missing:
        raise RuntimeError(f"Hardware output has no {', '.join(missing)} section")
    return sections


def _network(route_lines, addr_lines):
    """The interface, address, network and gateway the node uses to reach the internet."""
    route = route_lines[0].split()
    fields = {key: route[route.index(key) + 1] for key in ("via", "dev", "src") if key in route}
    missing = [key for key in ("via", "dev", "src") if key not in fields]
    if missing:
        raise RuntimeError(
            f"The route to the internet ({route_lines[0].strip()}) names no {', '.join(missing)}; "
            "the node needs a default route through a gateway on its local network."
        )
    for line in addr_lines:
        parts = line.split()
        if parts[1] == fields["dev"] and parts[3].split("/")[0] == fields["src"]:
            return {
                "interface": fields["dev"],
                "ip_address": fields["src"],
                "cidr": str(ipaddress.IPv4Network(parts[3], strict=False)),
                "gateway": fields["via"],
            }
    raise RuntimeError(f"No IPv4 address {fields['src']} on interface {fields['dev']}")


async def get_real_hardware_info(ip_address: str, username: str, password: str):
    """The node's hardware and network, read over SSH (or locally for this machine)."""
    local_ips = await get_local_ip_addresses()
    is_local = ip_address in local_ips

    logger.info(f"Collecting hardware info for {ip_address}")
    sections = _sections(await _run_on_node(HARDWARE_SCRIPT, ip_address, username, password, is_local))

    mem_kb = int(sections["meminfo"][0].split()[1])
    hardware_info = {
        "cpu_cores": int(sections["nproc"][0]),
        "memory_gb": round(mem_kb / (1024**2), 1),
        "disk_gb": round(int(sections["disk"][0]) / (1024**3), 1),
        "architecture": sections["arch"][0].strip(),
        "gpu_detected": False,
        "gpu_model": None,
        "gpu_count": 0,
    }
    hardware_info.update(await detect_lvm_status(ip_address, username, password, is_local))

    gpu_lines = [line for line in sections["lspci"] if is_gpu(line)]
    nvidia_gpus = [gpu_name(line) for line in gpu_lines]
    driver_version = sections["driver"][0].strip() if sections["driver"] else ""
    hardware_info["nvidia_driver_installed"] = bool(driver_version)
    hardware_info["nvidia_driver_version"] = driver_version

    if nvidia_gpus:
        hardware_info["gpu_detected"] = True
        hardware_info["gpu_count"] = len(nvidia_gpus)
        if len(nvidia_gpus) == 1:
            hardware_info["gpu_model"] = nvidia_gpus[0]
        elif len(set(nvidia_gpus)) == 1:
            hardware_info["gpu_model"] = f"{len(nvidia_gpus)}x {nvidia_gpus[0]}"
        else:
            hardware_info["gpu_model"] = f"{len(nvidia_gpus)} NVIDIA GPUs: {', '.join(nvidia_gpus)}"

        if all_pre_volta(gpu_lines):
            # Older than Volta: no driver makes it usable.
            hardware_info["driver_status"] = "unsupported_gpu"
        elif not driver_version:
            hardware_info["driver_status"] = "missing"
        else:
            major = driver_version.split(".")[0]
            if not major.isdigit():
                raise RuntimeError(f"nvidia-smi on {ip_address} reported an unreadable driver version: {driver_version}")
            hardware_info["driver_status"] = "compatible" if int(major) >= 580 else "old"
    else:
        hardware_info["driver_status"] = "none"

    network_info = _network(sections["route"], sections["addr"])
    logger.info(f"Hardware detection completed for {ip_address}: {hardware_info}, network {network_info}")
    return {"hardware": hardware_info, "network": network_info}


@router.post("/discover-servers")
async def discover_servers(request: Dict[str, Any]):
    """Discover Ubuntu servers on the network"""
    network_cidr = request.get("network_cidr", "192.168.1.0/24")
    username = request.get("username")
    password = request.get("password")
    
    # Real network discovery
    try:
        result = await discover_ubuntu_servers(network_cidr, username, password)
        return result
    except Exception as e:
        logger.error(f"Network discovery error: {e}")
        return {
            "error": f"Network discovery failed: {str(e)}",
            "servers": [],
            "total_scanned": 0,
            "scan_time": 0
        }


@router.post("/verify-server-ssh")
async def verify_server_ssh(server: Dict[str, Any]):
    """Verify SSH connectivity to a server"""
    ip_address = server.get("ip_address")
    password = server.get("password")
    
    # Get current system username as default
    import pwd
    current_username = pwd.getpwuid(os.getuid()).pw_name
    username = server.get("username", current_username)
    
    if not ip_address:
        return {
            "connected": False,
            "message": "IP address is required",
            "os_info": None,
            "hostname": None
        }
    
    return await verify_ssh_connectivity(ip_address, username, password)


@router.post("/verify-ssh")
async def verify_ssh(request: Dict[str, Any]):
    """Verify SSH connectivity - frontend compatibility endpoint"""
    # Extract parameters from frontend request format
    server_ip = request.get("server")
    password = request.get("password")
    
    # Get current system username as default if not provided
    import pwd
    current_username = pwd.getpwuid(os.getuid()).pw_name
    username = request.get("username", current_username)
    
    if not server_ip:
        return {
            "connected": False,
            "message": "Server IP is required",
            "os_info": None,
            "hostname": None
        }
    
    return await verify_ssh_connectivity(server_ip, username, password)


@router.get("/debug-local-ips")
async def debug_local_ips():
    """Debug endpoint to check local IP detection"""
    local_ips = await get_local_ip_addresses()
    return {
        "local_ips": list(local_ips),
        "count": len(local_ips)
    }


@router.post("/setup-ssh-keys")
async def setup_ssh_keys(request: Dict[str, Any]):
    """Set up SSH keys between servers using Ansible playbook"""
    from ..services.ansible_executor import ansible_executor
    
    servers = request.get("servers", [])
    username = request.get("username", "thinkube")
    password = request.get("password")
    
    # Define playbook path
    playbook_path = "ansible/00_initial_setup/10_setup_ssh_keys.yaml"
    
    # Set up environment variables for Ansible
    environment = {}
    if password:
        environment["ANSIBLE_SUDO_PASS"] = password
    
    # Execute the playbook using the reusable service
    result = await ansible_executor.execute_playbook(
        playbook_path=playbook_path,
        environment=environment,
        timeout=180  # 3 minutes for SSH setup
    )
    
    # Return standardized response
    return ansible_executor.format_result_for_api(result)


@router.post("/debug-ssh-check")
async def debug_ssh_check(request: Dict[str, Any]):
    """Debug endpoint to test SSH verification logic"""
    ip_address = request.get("ip_address")
    local_ips = await get_local_ip_addresses()
    
    return {
        "ip_to_check": ip_address,
        "local_ips": list(local_ips),
        "is_local": ip_address in local_ips,
        "ip_type": type(ip_address).__name__,
        "comparison_details": {
            str(ip): {"matches": ip == ip_address, "type": type(ip).__name__} 
            for ip in local_ips
        }
    }


@router.post("/detect-hardware")
async def detect_hardware(server: Dict[str, Any]):
    """Detect hardware configuration of a server via SSH"""
    missing = [key for key in ("server", "username") if not server.get(key)]
    if missing:
        raise HTTPException(status_code=400, detail=f"Hardware detection needs {', '.join(missing)}")
    ip_address = server["server"]
    try:
        return await get_real_hardware_info(ip_address, server["username"], server.get("password"))
    except Exception as e:
        logger.error(f"Failed to detect hardware for {ip_address}: {e}")
        raise HTTPException(status_code=500, detail=f"Hardware detection failed on {ip_address}: {e}")


@router.post("/discover-zerotier-nodes")
async def discover_zerotier_nodes(request: Dict[str, Any]):
    """Discover nodes in a ZeroTier network"""
    network_id = request.get("network_id")
    api_token = request.get("api_token")
    
    if not network_id or not api_token:
        return {"error": "Network ID and API token are required", "nodes": []}
    
    try:
        import aiohttp
        headers = {"Authorization": f"Bearer {api_token}"}
        
        async with aiohttp.ClientSession() as session:
            # Get network members
            async with session.get(
                f"https://api.zerotier.com/api/v1/network/{network_id}/member",
                headers=headers
            ) as response:
                if response.status != 200:
                    error_text = await response.text()
                    logger.error(f"ZeroTier API error: {response.status} - {error_text}")
                    return {"error": f"ZeroTier API error: {response.status}", "nodes": []}
                
                members = await response.json()
                
                nodes = []
                for member in members:
                    # Only include authorized and online members
                    if member.get("config", {}).get("authorized") and member.get("online"):
                        ip_assignments = member.get("config", {}).get("ipAssignments", [])
                        if ip_assignments:
                            nodes.append({
                                "hostname": member.get("name", f"node-{member['nodeId'][:8]}"),
                                "zerotier_ip": ip_assignments[0],
                                "node_id": member["nodeId"],
                                "online": True,
                                "description": member.get("description", ""),
                                "last_seen": member.get("lastSeen", 0)
                            })
                
                return {
                    "nodes": nodes,
                    "total": len(nodes),
                    "network_id": network_id
                }
                
    except Exception as e:
        logger.error(f"Failed to discover ZeroTier nodes: {e}")
        return {"error": f"Discovery failed: {str(e)}", "nodes": []}


@router.post("/verify-zerotier-ssh")
async def verify_zerotier_ssh(request: Dict[str, Any]):
    """Verify SSH connectivity over ZeroTier network"""
    zerotier_ip = request.get("zerotier_ip")
    username = request.get("username")
    password = request.get("password")
    
    if not zerotier_ip:
        return {
            "connected": False,
            "message": "ZeroTier IP is required",
            "os_info": None,
            "hostname": None
        }
    
    # Use the existing verify_ssh_connectivity function
    return await verify_ssh_connectivity(zerotier_ip, username, password)


@router.post("/verify-cloudflare")
async def verify_cloudflare(request: Dict[str, Any]):
    """Verify Cloudflare API token and domain access"""
    try:
        token = request.get('token', '')
        domain = request.get('domain', '')
        
        if not token:
            return {"valid": False, "message": "No API token provided"}
        
        if not domain:
            return {"valid": False, "message": "No domain provided"}
        
        # Call Cloudflare API to list zones
        import aiohttp
        headers = {
            'Authorization': f'Bearer {token}',
            'Content-Type': 'application/json'
        }
        
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f'https://api.cloudflare.com/client/v4/zones?name={domain}',
                headers=headers
            ) as response:
                data = await response.json()
                
                if response.status == 200 and data.get('success'):
                    zones = data.get('result', [])
                    if zones:
                        # Found the domain
                        zone = zones[0]
                        return {
                            "valid": True, 
                            "message": f"Token has access to {zone['name']}",
                            "zone_id": zone['id']
                        }
                    else:
                        return {"valid": False, "message": f"Domain '{domain}' not found in Cloudflare account"}
                elif response.status == 403:
                    return {"valid": False, "message": "Invalid token or insufficient permissions"}
                elif response.status == 401:
                    return {"valid": False, "message": "Invalid Cloudflare API token"}
                else:
                    return {"valid": False, "message": f"Cloudflare API error: {data.get('errors', [{}])[0].get('message', 'Unknown error')}"}
                    
    except Exception as e:
        logger.error(f"Failed to verify Cloudflare token: {e}")
        return {"valid": False, "message": f"Verification error: {str(e)}"}


