# Copyright 2025 Alejandro Martínez Corriá and the Thinkube contributors
# SPDX-License-Identifier: Apache-2.0

"""
Reusable Ansible playbook execution service
"""

import asyncio
import logging
import os
from pathlib import Path
from typing import Dict, Any, Optional, Callable
from dataclasses import dataclass
from enum import Enum

from app.services.ansible_environment import ansible_environment

logger = logging.getLogger(__name__)


class PlaybookStatus(Enum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    ERROR = "error"
    CANCELLED = "cancelled"


@dataclass
class PlaybookResult:
    """Result of a playbook execution"""
    status: PlaybookStatus
    message: str
    details: Optional[str] = None
    stdout: Optional[str] = None
    stderr: Optional[str] = None
    return_code: Optional[int] = None
    duration: Optional[float] = None


@dataclass
class PlaybookProgress:
    """Progress update for a running playbook"""
    status: PlaybookStatus
    message: str
    progress_percent: Optional[int] = None
    current_task: Optional[str] = None
    details: Optional[str] = None


class AnsibleExecutor:
    """Service for executing Ansible playbooks with consistent patterns"""

    def __init__(self):
        # thinkube_root will be obtained from ansible_environment
        pass
        
    async def execute_playbook(
        self,
        playbook_path: str | Path,
        extra_vars: Optional[Dict[str, Any]] = None,
        environment: Optional[Dict[str, str]] = None,
        progress_callback: Optional[Callable[[PlaybookProgress], None]] = None,
        timeout: Optional[int] = 300  # 5 minutes default
    ) -> PlaybookResult:
        """
        Execute an Ansible playbook with standardized error handling and progress tracking
        
        Args:
            playbook_path: Path to the playbook file
            extra_vars: Additional variables to pass to the playbook
            environment: Environment variables for the execution
            progress_callback: Optional callback for progress updates
            timeout: Execution timeout in seconds
            
        Returns:
            PlaybookResult with execution details
        """
        import time
        start_time = time.time()
        
        try:
            # Check if Ansible environment is initialized
            if not ansible_environment.is_initialized():
                return PlaybookResult(
                    status=PlaybookStatus.ERROR,
                    message="Ansible environment not initialized",
                    details="Please initialize the Ansible environment first"
                )

            # Check if thinkube repository is cloned
            if not ansible_environment.is_thinkube_cloned():
                return PlaybookResult(
                    status=PlaybookStatus.ERROR,
                    message="Thinkube repository not cloned",
                    details="Please clone the thinkube repository first"
                )

            # Get thinkube root from ansible_environment
            thinkube_root = ansible_environment.get_thinkube_path()

            # Validate playbook exists
            playbook_path = Path(playbook_path)
            if not playbook_path.is_absolute():
                playbook_path = thinkube_root / playbook_path

            if not playbook_path.exists():
                return PlaybookResult(
                    status=PlaybookStatus.ERROR,
                    message="Playbook not found",
                    details=f"Could not find playbook at {playbook_path}"
                )

            # Build command using bundled ansible-playbook
            ansible_playbook = ansible_environment.get_ansible_playbook_command()
            cmd = [ansible_playbook, str(playbook_path)]
            
            # Add extra vars if provided
            if extra_vars:
                for key, value in extra_vars.items():
                    cmd.extend(["--extra-vars", f"{key}={value}"])
                    
            # Set up environment with bundled Ansible
            env = ansible_environment.get_ansible_env()
            if environment:
                env.update(environment)
                
            logger.info(f"Executing Ansible playbook: {playbook_path}")
            logger.debug(f"Command: {' '.join(cmd)}")
            
            # Send initial progress update
            if progress_callback:
                progress_callback(PlaybookProgress(
                    status=PlaybookStatus.RUNNING,
                    message="Starting playbook execution",
                    progress_percent=0,
                    current_task="Initializing"
                ))
                
            # Execute the playbook
            try:
                process = await asyncio.wait_for(
                    asyncio.create_subprocess_exec(
                        *cmd,
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.PIPE,
                        env=env,
                        cwd=str(thinkube_root)
                    ),
                    timeout=10  # Timeout for process creation
                )
                
                # Wait for completion with timeout
                stdout, stderr = await asyncio.wait_for(
                    process.communicate(),
                    timeout=timeout
                )
                
                execution_time = time.time() - start_time
                stdout_str = stdout.decode() if stdout else ""
                stderr_str = stderr.decode() if stderr else ""
                
                # Send completion progress update
                if progress_callback:
                    progress_callback(PlaybookProgress(
                        status=PlaybookStatus.SUCCESS if process.returncode == 0 else PlaybookStatus.ERROR,
                        message="Playbook execution completed",
                        progress_percent=100
                    ))
                
                if process.returncode == 0:
                    logger.info(f"Playbook {playbook_path.name} completed successfully in {execution_time:.2f}s")
                    return PlaybookResult(
                        status=PlaybookStatus.SUCCESS,
                        message="Playbook executed successfully",
                        details="All tasks completed without errors",
                        stdout=stdout_str,
                        stderr=stderr_str,
                        return_code=process.returncode,
                        duration=execution_time
                    )
                else:
                    logger.error(f"Playbook {playbook_path.name} failed with return code {process.returncode}")
                    return PlaybookResult(
                        status=PlaybookStatus.ERROR,
                        message="Playbook execution failed",
                        details=stderr_str or "Unknown error occurred",
                        stdout=stdout_str,
                        stderr=stderr_str,
                        return_code=process.returncode,
                        duration=execution_time
                    )
                    
            except asyncio.TimeoutError:
                logger.error(f"Playbook {playbook_path.name} timed out after {timeout}s")
                # Try to terminate the process
                try:
                    process.terminate()
                    await asyncio.wait_for(process.wait(), timeout=5)
                except:
                    process.kill()
                    
                if progress_callback:
                    progress_callback(PlaybookProgress(
                        status=PlaybookStatus.ERROR,
                        message="Playbook execution timed out",
                        progress_percent=None
                    ))
                    
                return PlaybookResult(
                    status=PlaybookStatus.ERROR,
                    message="Playbook execution timed out",
                    details=f"Execution exceeded {timeout} seconds",
                    duration=time.time() - start_time
                )
                
        except Exception as e:
            logger.error(f"Unexpected error executing playbook {playbook_path}: {e}")
            
            if progress_callback:
                progress_callback(PlaybookProgress(
                    status=PlaybookStatus.ERROR,
                    message="Unexpected error occurred",
                    details=str(e)
                ))
                
            return PlaybookResult(
                status=PlaybookStatus.ERROR,
                message="Unexpected error during playbook execution",
                details=str(e),
                duration=time.time() - start_time
            )
    
    def format_result_for_api(self, result: PlaybookResult) -> Dict[str, Any]:
        """Format a PlaybookResult for API response"""
        return {
            "status": result.status.value,
            "message": result.message,
            "details": result.details,
            "return_code": result.return_code,
            "duration": result.duration,
            "stdout": result.stdout if result.status == PlaybookStatus.ERROR else None,
            "stderr": result.stderr if result.status == PlaybookStatus.ERROR else None
        }


# Singleton instance
ansible_executor = AnsibleExecutor()