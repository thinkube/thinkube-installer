# Copyright 2025 Alejandro Martínez Corriá and the Thinkube contributors
# SPDX-License-Identifier: Apache-2.0

"""
API endpoints for Ansible environment setup
"""

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
import logging

from app.services.ansible_environment import ansible_environment

logger = logging.getLogger(__name__)

router = APIRouter()


class AnsibleStatusResponse(BaseModel):
    initialized: bool
    ansible_path: str | None
    thinkube_cloned: bool
    thinkube_path: str | None
    thinkube_branch: str
    message: str


@router.get("/ansible/status", response_model=AnsibleStatusResponse)
async def get_ansible_status():
    """Check if Ansible environment and thinkube repository are ready"""
    initialized = ansible_environment.is_initialized()
    thinkube_cloned = ansible_environment.is_thinkube_cloned()

    return AnsibleStatusResponse(
        initialized=initialized,
        ansible_path=str(ansible_environment.ansible_bin) if initialized else None,
        thinkube_cloned=thinkube_cloned,
        thinkube_path=str(ansible_environment.thinkube_clone_dir) if thinkube_cloned else None,
        thinkube_branch=ansible_environment.thinkube_branch,
        message="Ready" if (initialized and thinkube_cloned) else "Needs initialization"
    )


@router.websocket("/ansible/initialize")
async def initialize_ansible_websocket(websocket: WebSocket):
    """
    Initialize Ansible environment with real-time progress updates via WebSocket
    """
    await websocket.accept()

    try:
        logger.info("Client connected to Ansible initialization WebSocket")

        # Progress callback to send updates to client
        async def send_progress(message: str, progress: int):
            try:
                await websocket.send_json({
                    "type": "progress",
                    "message": message,
                    "progress": progress
                })
            except Exception as e:
                logger.error(f"Error sending progress update: {e}")

        # Initialize Ansible environment
        success = await ansible_environment.initialize(progress_callback=send_progress)

        # Send final status
        if success:
            await websocket.send_json({
                "type": "complete",
                "success": True,
                "message": "Ansible environment initialized successfully",
                "ansible_path": str(ansible_environment.ansible_bin)
            })
        else:
            await websocket.send_json({
                "type": "complete",
                "success": False,
                "message": "Failed to initialize Ansible environment"
            })

    except WebSocketDisconnect:
        logger.info("Client disconnected from Ansible initialization WebSocket")
    except Exception as e:
        logger.error(f"Error during Ansible initialization: {e}")
        try:
            await websocket.send_json({
                "type": "error",
                "message": str(e)
            })
        except:
            pass
    finally:
        try:
            await websocket.close()
        except:
            pass


@router.websocket("/ansible/clone-thinkube")
async def clone_thinkube_websocket(websocket: WebSocket):
    """
    Clone thinkube repository with real-time progress updates via WebSocket
    """
    await websocket.accept()

    try:
        logger.info("Client connected to thinkube clone WebSocket")

        # Progress callback to send updates to client
        async def send_progress(message: str, progress: int):
            try:
                await websocket.send_json({
                    "type": "progress",
                    "message": message,
                    "progress": progress
                })
            except Exception as e:
                logger.error(f"Error sending progress update: {e}")

        # Clone thinkube repository
        success = await ansible_environment.clone_thinkube(progress_callback=send_progress)

        # Send final status
        if success:
            await websocket.send_json({
                "type": "complete",
                "success": True,
                "message": "Thinkube repository cloned successfully",
                "thinkube_path": str(ansible_environment.thinkube_clone_dir),
                "branch": ansible_environment.thinkube_branch
            })
        else:
            await websocket.send_json({
                "type": "complete",
                "success": False,
                "message": "Failed to clone thinkube repository"
            })

    except WebSocketDisconnect:
        logger.info("Client disconnected from thinkube clone WebSocket")
    except Exception as e:
        logger.error(f"Error during thinkube clone: {e}")
        try:
            await websocket.send_json({
                "type": "error",
                "message": str(e)
            })
        except:
            pass
    finally:
        try:
            await websocket.close()
        except:
            pass


@router.post("/ansible/cleanup")
async def cleanup_ansible():
    """Clean up the temporary thinkube clone"""
    try:
        ansible_environment.cleanup_thinkube_clone()
        return {"success": True, "message": "Cleanup completed"}
    except Exception as e:
        logger.error(f"Error during cleanup: {e}")
        return {"success": False, "message": str(e)}
