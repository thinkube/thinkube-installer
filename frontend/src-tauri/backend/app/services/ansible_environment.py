# Copyright 2025 Alejandro Martínez Corriá and the Thinkube contributors
# SPDX-License-Identifier: Apache-2.0

"""
Ansible environment management - ensures Ansible is installed and available
"""

import asyncio
import logging
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Optional, Callable

logger = logging.getLogger(__name__)


class AnsibleEnvironment:
    """Manages the bundled Ansible environment for the installer"""

    def __init__(self):
        self.installer_dir = Path.home() / ".thinkube-installer"
        self.venv_dir = self.installer_dir / "ansible-venv"
        self.ansible_bin = self.venv_dir / "bin" / "ansible-playbook"
        self.pip_bin = self.venv_dir / "bin" / "pip"

        # Thinkube repository settings
        self.thinkube_repo_url = "https://github.com/thinkube/thinkube.git"
        self.thinkube_branch = os.environ.get("THINKUBE_BRANCH", "main")
        self.thinkube_clone_dir = None  # Will be set during initialization

    def is_initialized(self) -> bool:
        """Check if Ansible environment is already set up"""
        return self.ansible_bin.exists() and self.ansible_bin.is_file()

    def is_thinkube_cloned(self) -> bool:
        """Check if thinkube repository is cloned"""
        return self.thinkube_clone_dir is not None and self.thinkube_clone_dir.exists()

    def get_thinkube_path(self) -> Path:
        """Get the path to the cloned thinkube repository"""
        if not self.is_thinkube_cloned():
            raise RuntimeError("Thinkube repository not cloned yet")
        return self.thinkube_clone_dir

    async def initialize(
        self,
        progress_callback: Optional[Callable[[str, int], None]] = None
    ) -> bool:
        """
        Initialize the Ansible environment (first-run setup)

        Args:
            progress_callback: Optional callback(message: str, progress: int) for UI updates

        Returns:
            True if successful, False otherwise
        """
        try:
            logger.info("Initializing Ansible environment...")

            if self.is_initialized():
                logger.info("Ansible environment already initialized")
                if progress_callback:
                    progress_callback("Ansible environment ready", 100)
                return True

            # Create installer directory
            if progress_callback:
                progress_callback("Creating Ansible environment directory...", 10)

            self.installer_dir.mkdir(parents=True, exist_ok=True)
            logger.info(f"Created installer directory: {self.installer_dir}")

            # Create virtual environment
            if progress_callback:
                progress_callback("Creating Python virtual environment...", 20)

            logger.info(f"Creating venv at {self.venv_dir}")
            process = await asyncio.create_subprocess_exec(
                sys.executable, "-m", "venv", str(self.venv_dir),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            stdout, stderr = await process.communicate()

            if process.returncode != 0:
                error_msg = stderr.decode() if stderr else "Unknown error"
                logger.error(f"Failed to create venv: {error_msg}")
                if progress_callback:
                    progress_callback(f"Error creating venv: {error_msg}", 0)
                return False

            logger.info("Virtual environment created successfully")

            # Upgrade pip
            if progress_callback:
                progress_callback("Upgrading pip...", 30)

            logger.info("Upgrading pip")
            process = await asyncio.create_subprocess_exec(
                str(self.pip_bin), "install", "--upgrade", "pip",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            await process.communicate()

            # Install Ansible and dependencies
            if progress_callback:
                progress_callback("Installing Ansible (this may take a few minutes)...", 40)

            logger.info("Installing Ansible")

            # Install specific versions for stability
            packages = [
                "ansible-core>=2.16,<2.17",
                "ansible>=9.0,<10.0",
                "jinja2>=3.1.0",
                "pyyaml>=6.0"
            ]

            for i, package in enumerate(packages):
                progress = 40 + (i * 15)
                pkg_name = package.split(">=")[0]
                if progress_callback:
                    progress_callback(f"Installing {pkg_name}...", progress)

                logger.info(f"Installing {package}")
                process = await asyncio.create_subprocess_exec(
                    str(self.pip_bin), "install", package,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                stdout, stderr = await process.communicate()

                if process.returncode != 0:
                    error_msg = stderr.decode() if stderr else "Unknown error"
                    logger.error(f"Failed to install {package}: {error_msg}")
                    if progress_callback:
                        progress_callback(f"Error installing {pkg_name}", 0)
                    return False

            # Verify installation
            if progress_callback:
                progress_callback("Verifying Ansible installation...", 95)

            if not self.ansible_bin.exists():
                logger.error(f"ansible-playbook not found at {self.ansible_bin}")
                if progress_callback:
                    progress_callback("Ansible installation verification failed", 0)
                return False

            # Test ansible-playbook --version
            process = await asyncio.create_subprocess_exec(
                str(self.ansible_bin), "--version",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            stdout, stderr = await process.communicate()

            if process.returncode != 0:
                logger.error("ansible-playbook --version failed")
                if progress_callback:
                    progress_callback("Ansible verification failed", 0)
                return False

            version_output = stdout.decode()
            logger.info(f"Ansible installed successfully: {version_output.split()[0]}")

            if progress_callback:
                progress_callback("Ansible environment ready!", 100)

            return True

        except Exception as e:
            logger.error(f"Failed to initialize Ansible environment: {e}")
            if progress_callback:
                progress_callback(f"Error: {str(e)}", 0)
            return False

    async def clone_thinkube(
        self,
        progress_callback: Optional[Callable[[str, int], None]] = None
    ) -> bool:
        """
        Clone the thinkube repository to /tmp

        Args:
            progress_callback: Optional callback(message: str, progress: int) for UI updates

        Returns:
            True if successful, False otherwise
        """
        try:
            logger.info("Cloning thinkube repository...")

            # Always get fresh code - delete existing clone if present
            if self.is_thinkube_cloned():
                logger.info("Removing existing clone to get latest code...")
                if progress_callback:
                    progress_callback("Removing old clone...", 5)
                self.cleanup_thinkube_clone()

            # Create temporary directory for the clone
            if progress_callback:
                progress_callback("Creating temporary directory...", 10)

            # Use fixed directory name for easier testing and debugging
            # When playbook fails, you can edit /tmp/thinkube-installer/ and retry
            temp_base = Path(tempfile.gettempdir())
            self.thinkube_clone_dir = temp_base / "thinkube-installer"

            # Remove existing clone if it exists
            if self.thinkube_clone_dir.exists():
                logger.info(f"Removing existing clone at {self.thinkube_clone_dir}")
                if progress_callback:
                    progress_callback("Removing old clone...", 15)
                shutil.rmtree(self.thinkube_clone_dir)
                logger.info(f"Removed old clone")

            logger.info(f"Cloning to {self.thinkube_clone_dir}")

            # Clone the repository
            if progress_callback:
                progress_callback(f"Cloning thinkube repository (branch: {self.thinkube_branch})...", 20)

            logger.info(f"Running: git clone -b {self.thinkube_branch} {self.thinkube_repo_url}")

            process = await asyncio.create_subprocess_exec(
                "git", "clone",
                "-b", self.thinkube_branch,
                "--depth", "1",  # Shallow clone for faster download
                self.thinkube_repo_url,
                str(self.thinkube_clone_dir),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )

            stdout, stderr = await process.communicate()

            if process.returncode != 0:
                error_msg = stderr.decode() if stderr else "Unknown error"
                logger.error(f"Failed to clone thinkube repository: {error_msg}")
                if progress_callback:
                    progress_callback(f"Error cloning repository: {error_msg}", 0)
                self.thinkube_clone_dir = None
                return False

            logger.info(f"Successfully cloned thinkube to {self.thinkube_clone_dir}")

            # Verify ansible directory exists
            ansible_dir = self.thinkube_clone_dir / "ansible"
            if not ansible_dir.exists():
                logger.error(f"Ansible directory not found in cloned repository: {ansible_dir}")
                if progress_callback:
                    progress_callback("Error: ansible directory not found in repository", 0)
                self.cleanup_thinkube_clone()
                return False

            if progress_callback:
                progress_callback("Thinkube repository cloned successfully!", 100)

            return True

        except Exception as e:
            logger.error(f"Failed to clone thinkube repository: {e}")
            if progress_callback:
                progress_callback(f"Error: {str(e)}", 0)
            self.thinkube_clone_dir = None
            return False

    def cleanup_thinkube_clone(self):
        """Clean up the temporary thinkube clone"""
        if self.thinkube_clone_dir and self.thinkube_clone_dir.exists():
            try:
                import shutil
                logger.info(f"Cleaning up thinkube clone at {self.thinkube_clone_dir}")
                shutil.rmtree(self.thinkube_clone_dir)
                self.thinkube_clone_dir = None
                logger.info("Cleanup complete")
            except Exception as e:
                logger.error(f"Failed to cleanup thinkube clone: {e}")

    def get_ansible_env(self) -> dict:
        """Get environment variables for running Ansible commands"""
        env = os.environ.copy()

        # Add venv bin to PATH
        venv_bin = str(self.venv_dir / "bin")
        if "PATH" in env:
            env["PATH"] = f"{venv_bin}:{env['PATH']}"
        else:
            env["PATH"] = venv_bin

        # Set ANSIBLE_HOME to avoid conflicts
        env["ANSIBLE_HOME"] = str(self.installer_dir)

        return env

    def get_ansible_playbook_command(self) -> str:
        """Get the full path to ansible-playbook executable"""
        return str(self.ansible_bin)


# Singleton instance
ansible_environment = AnsibleEnvironment()
