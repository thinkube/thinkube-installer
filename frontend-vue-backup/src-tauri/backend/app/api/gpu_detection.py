# Copyright 2025 Alejandro Martínez Corriá and the Thinkube contributors
# SPDX-License-Identifier: Apache-2.0

"""
GPU detection and driver version checking API endpoints
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import asyncio
import asyncssh
import logging
import re

logger = logging.getLogger(__name__)

router = APIRouter(tags=["gpu"])


class GpuNodeStatus(BaseModel):
    """Status of GPU and driver on a single node"""
    hostname: str
    ip: str
    gpu_detected: bool
    gpu_name: Optional[str] = None
    gpu_count: int = 0
    driver_installed: bool
    driver_version: Optional[str] = None
    driver_status: str  # "compatible", "old", "missing", "unknown"
    min_required_version: str = "580.0"
    action_required: Optional[str] = None  # "install", "upgrade", null
    error: Optional[str] = None


class GpuDetectionRequest(BaseModel):
    """Request to detect GPUs and drivers on nodes"""
    nodes: List[Dict[str, Any]]  # List of nodes with hostname, ip, username, password


class GpuDetectionResponse(BaseModel):
    """Response with GPU/driver status for all nodes"""
    nodes: List[GpuNodeStatus]
    summary: Dict[str, int]  # ready, needs_install, needs_upgrade, excluded


async def detect_gpu_on_node(
    hostname: str,
    ip: str,
    username: str,
    password: str,
    ssh_key: Optional[str] = None
) -> GpuNodeStatus:
    """
    Detect GPU presence and driver version on a single node via SSH
    """
    min_version = "580.0"

    try:
        # Establish SSH connection
        connect_kwargs = {
            "host": ip,
            "username": username,
            "known_hosts": None,  # Accept any host key
        }

        # Use SSH key if available, otherwise password
        if ssh_key:
            connect_kwargs["client_keys"] = [ssh_key]
        else:
            connect_kwargs["password"] = password

        async with asyncssh.connect(**connect_kwargs) as conn:
            # Check for NVIDIA GPU
            result = await conn.run("lspci | grep -i nvidia", check=False)
            gpu_detected = result.returncode == 0

            if not gpu_detected:
                return GpuNodeStatus(
                    hostname=hostname,
                    ip=ip,
                    gpu_detected=False,
                    driver_installed=False,
                    driver_status="missing",
                    action_required=None
                )

            # Get GPU count and names
            gpu_output = result.stdout.strip()
            gpu_lines = [line for line in gpu_output.split('\n') if line.strip()]
            gpu_count = len(gpu_lines)

            # Extract GPU name from first line (usually most detailed)
            gpu_name = "Unknown NVIDIA GPU"
            if gpu_lines:
                # Extract GPU name from lspci output
                # Format: "01:00.0 VGA compatible controller: NVIDIA Corporation Device 2e12 (rev a1)"
                match = re.search(r'NVIDIA.*?(?:\[([^\]]+)\]|$)', gpu_lines[0])
                if match:
                    gpu_name = match.group(0).strip()
                else:
                    gpu_name = "NVIDIA GPU"

            # Check for NVIDIA driver
            result = await conn.run(
                "nvidia-smi --query-gpu=name,driver_version --format=csv,noheader",
                check=False
            )

            if result.returncode != 0:
                # nvidia-smi not available - driver not installed
                return GpuNodeStatus(
                    hostname=hostname,
                    ip=ip,
                    gpu_detected=True,
                    gpu_name=gpu_name,
                    gpu_count=gpu_count,
                    driver_installed=False,
                    driver_status="missing",
                    action_required="install"
                )

            # Parse nvidia-smi output
            smi_output = result.stdout.strip()
            lines = smi_output.split('\n')

            if lines:
                # Get first GPU info (format: "NVIDIA GB10, 580.95.05")
                first_line = lines[0].strip()
                parts = [p.strip() for p in first_line.split(',')]

                if len(parts) >= 2:
                    gpu_name = parts[0]
                    driver_version = parts[1]

                    # Compare versions
                    try:
                        current_major = int(driver_version.split('.')[0])
                        required_major = int(min_version.split('.')[0])

                        if current_major >= required_major:
                            driver_status = "compatible"
                            action_required = None
                        else:
                            driver_status = "old"
                            action_required = "upgrade"
                    except (ValueError, IndexError):
                        driver_status = "unknown"
                        action_required = None

                    return GpuNodeStatus(
                        hostname=hostname,
                        ip=ip,
                        gpu_detected=True,
                        gpu_name=gpu_name,
                        gpu_count=gpu_count,
                        driver_installed=True,
                        driver_version=driver_version,
                        driver_status=driver_status,
                        min_required_version=min_version,
                        action_required=action_required
                    )

            # Fallback if parsing fails
            return GpuNodeStatus(
                hostname=hostname,
                ip=ip,
                gpu_detected=True,
                gpu_name=gpu_name,
                gpu_count=gpu_count,
                driver_installed=True,
                driver_status="unknown",
                action_required=None,
                error="Could not parse driver version"
            )

    except asyncssh.Error as e:
        logger.error(f"SSH error detecting GPU on {hostname} ({ip}): {e}")
        return GpuNodeStatus(
            hostname=hostname,
            ip=ip,
            gpu_detected=False,
            driver_installed=False,
            driver_status="unknown",
            error=f"SSH connection failed: {str(e)}"
        )
    except Exception as e:
        logger.error(f"Error detecting GPU on {hostname} ({ip}): {e}")
        return GpuNodeStatus(
            hostname=hostname,
            ip=ip,
            gpu_detected=False,
            driver_installed=False,
            driver_status="unknown",
            error=str(e)
        )


@router.post("/api/gpu/detect-drivers")
async def detect_drivers(request: GpuDetectionRequest) -> GpuDetectionResponse:
    """
    Detect GPUs and driver versions on all nodes
    """
    try:
        # Detect GPUs on all nodes in parallel
        tasks = []
        for node in request.nodes:
            task = detect_gpu_on_node(
                hostname=node.get("hostname", "unknown"),
                ip=node["ip"],
                username=node["username"],
                password=node.get("password", ""),
                ssh_key=node.get("ssh_key")
            )
            tasks.append(task)

        results = await asyncio.gather(*tasks)

        # Calculate summary
        summary = {
            "ready": 0,          # Compatible drivers or no GPU
            "needs_install": 0,  # GPU present but no driver
            "needs_upgrade": 0,  # Driver too old
            "no_gpu": 0,         # No GPU detected
            "error": 0           # Error during detection
        }

        for result in results:
            if result.error:
                summary["error"] += 1
            elif not result.gpu_detected:
                summary["no_gpu"] += 1
            elif result.driver_status == "compatible":
                summary["ready"] += 1
            elif result.driver_status == "missing":
                summary["needs_install"] += 1
            elif result.driver_status == "old":
                summary["needs_upgrade"] += 1

        return GpuDetectionResponse(
            nodes=results,
            summary=summary
        )

    except Exception as e:
        logger.error(f"Error detecting drivers: {e}")
        raise HTTPException(status_code=500, detail=str(e))
