# Copyright 2025 Alejandro Martínez Corriá and the Thinkube contributors
# SPDX-License-Identifier: Apache-2.0

"""
Pydantic models for server-related data structures
"""

from pydantic import BaseModel
from typing import Optional


class HardwareInfo(BaseModel):
    cpu_cores: int
    cpu_model: str
    memory_gb: float
    disk_gb: float
    gpu_detected: bool = False
    gpu_model: Optional[str] = None
    gpu_count: int = 0
    architecture: str  # x86_64 or arm64


class NetworkDiscoveryRequest(BaseModel):
    network_cidr: str = "192.168.1.0/24"
    timeout: int = 10


class SSHVerificationRequest(BaseModel):
    ip_address: str
    username: str = "thinkube"


class TokenRequest(BaseModel):
    token: str


class TokenResponse(BaseModel):
    success: bool
    message: str