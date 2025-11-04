# Copyright 2025 Alejandro Martínez Corriá and the Thinkube contributors
# SPDX-License-Identifier: Apache-2.0

"""
NVIDIA driver installation service
"""

import asyncio
import asyncssh
import logging
from typing import Optional, Callable
from pathlib import Path

logger = logging.getLogger(__name__)


class DriverInstaller:
    """Manages NVIDIA driver installation on remote nodes"""

    # NVIDIA driver version to install
    DRIVER_VERSION = "580.95.05"
    DRIVER_URL = f"https://us.download.nvidia.com/XFree86/Linux-x86_64/{DRIVER_VERSION}/NVIDIA-Linux-x86_64-{DRIVER_VERSION}.run"
    DRIVER_FILENAME = f"NVIDIA-Linux-x86_64-{DRIVER_VERSION}.run"

    def __init__(self):
        pass

    async def install_driver(
        self,
        hostname: str,
        ip: str,
        username: str,
        password: str,
        ssh_key: Optional[str] = None,
        progress_callback: Optional[Callable[[str, int], None]] = None
    ) -> bool:
        """
        Install NVIDIA driver on a remote node via SSH

        Args:
            hostname: Node hostname
            ip: Node IP address
            username: SSH username
            password: SSH password
            ssh_key: Optional SSH private key path
            progress_callback: Optional callback(message: str, progress: int)

        Returns:
            True if successful, False otherwise
        """
        try:
            logger.info(f"Installing NVIDIA driver {self.DRIVER_VERSION} on {hostname} ({ip})")

            if progress_callback:
                progress_callback(f"Connecting to {hostname}...", 5)

            # Establish SSH connection
            connect_kwargs = {
                "host": ip,
                "username": username,
                "known_hosts": None,
            }

            if ssh_key:
                connect_kwargs["client_keys"] = [ssh_key]
            else:
                connect_kwargs["password"] = password

            async with asyncssh.connect(**connect_kwargs) as conn:
                # Check if driver already installed
                result = await conn.run("nvidia-smi --version", check=False)
                if result.returncode == 0:
                    logger.info(f"NVIDIA driver already installed on {hostname}")
                    if progress_callback:
                        progress_callback(f"Driver already installed on {hostname}", 100)
                    return True

                # Download driver
                if progress_callback:
                    progress_callback(f"Downloading NVIDIA driver {self.DRIVER_VERSION}...", 10)

                logger.info(f"Downloading driver from {self.DRIVER_URL}")
                result = await conn.run(
                    f"wget -q --show-progress {self.DRIVER_URL} -O /tmp/{self.DRIVER_FILENAME}",
                    check=False
                )

                if result.returncode != 0:
                    error_msg = f"Failed to download driver: {result.stderr}"
                    logger.error(error_msg)
                    if progress_callback:
                        progress_callback(error_msg, 0)
                    return False

                if progress_callback:
                    progress_callback("Driver downloaded, installing...", 50)

                # Install driver
                logger.info(f"Installing driver on {hostname}")
                install_cmd = f"sudo sh /tmp/{self.DRIVER_FILENAME} --silent --dkms"

                # Create async process for installation (can take several minutes)
                result = await conn.run(install_cmd, check=False)

                if result.returncode != 0:
                    error_msg = f"Driver installation failed: {result.stderr}"
                    logger.error(error_msg)
                    if progress_callback:
                        progress_callback(error_msg, 0)

                    # Try to get more details from log
                    log_result = await conn.run(
                        "cat /var/log/nvidia-installer.log 2>/dev/null | tail -50",
                        check=False
                    )
                    if log_result.returncode == 0 and log_result.stdout:
                        logger.error(f"Installation log:\n{log_result.stdout}")

                    return False

                if progress_callback:
                    progress_callback("Verifying installation...", 90)

                # Verify installation
                result = await conn.run("nvidia-smi --version", check=False)
                if result.returncode != 0:
                    error_msg = "Driver installation verification failed"
                    logger.error(error_msg)
                    if progress_callback:
                        progress_callback(error_msg, 0)
                    return False

                version_output = result.stdout.strip()
                logger.info(f"Driver installed successfully on {hostname}: {version_output}")

                # Clean up downloaded file
                await conn.run(f"rm /tmp/{self.DRIVER_FILENAME}", check=False)

                if progress_callback:
                    progress_callback(f"Driver installed successfully on {hostname}!", 100)

                return True

        except asyncssh.Error as e:
            error_msg = f"SSH error installing driver on {hostname}: {e}"
            logger.error(error_msg)
            if progress_callback:
                progress_callback(error_msg, 0)
            return False
        except Exception as e:
            error_msg = f"Error installing driver on {hostname}: {e}"
            logger.error(error_msg)
            if progress_callback:
                progress_callback(error_msg, 0)
            return False


# Singleton instance
driver_installer = DriverInstaller()
