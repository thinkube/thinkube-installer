#!/usr/bin/env python3

# Copyright Alejandro Martínez Corriá and the Thinkube contributors
# SPDX-License-Identifier: Apache-2.0

"""
thinkube Installer Backend
FastAPI server for handling configuration and Ansible playbook execution

Refactored modular version
"""

import os
import sys
import logging
from pathlib import Path
from typing import List

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
import uvicorn

# Import our modular components
from app.api.discovery import router as discovery_router
from app.api.system import router as system_router
from app.api.playbook_stream import router as playbook_stream_router
from app.api.zerotier import router as zerotier_router
from app.api.tailscale import router as tailscale_router
from app.api.tokens import router as tokens_router
from app.api.github import router as github_router
from app.api.huggingface import router as huggingface_router
from app.api.configuration import router as configuration_router
from app.api.ansible_setup import router as ansible_setup_router
from app.api.logs import router as logs_router

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Import shared state
from app.shared import app_state, broadcast_status

# Initialize FastAPI app
app = FastAPI(
    title="thinkube Installer Backend",
    description="Backend API for thinkube installer",
    version="1.0.0"
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routers
app.include_router(ansible_setup_router)
app.include_router(discovery_router)
app.include_router(system_router)
app.include_router(playbook_stream_router)
app.include_router(zerotier_router)
app.include_router(tailscale_router)
app.include_router(tokens_router)
app.include_router(github_router)
app.include_router(huggingface_router)
app.include_router(configuration_router)
app.include_router(logs_router)


@app.get("/")
async def root():
    """Health check endpoint"""
    return {"status": "healthy", "service": "thinkube-installer-backend"}


@app.get("/api/health")
async def api_health():
    """API health check endpoint"""
    return {"status": "healthy", "service": "thinkube-installer-backend"}


@app.get("/api/current-user")
async def get_current_user():
    """Get the current system user"""
    try:
        import pwd
        user_info = pwd.getpwuid(os.getuid())
        return {
            "username": user_info.pw_name,
            "uid": user_info.pw_uid,
            "home": user_info.pw_dir
        }
    except:
        return {
            "username": os.environ.get('USER', 'unknown'),
            "uid": os.getuid(),
            "home": os.path.expanduser("~")
        }


async def serve_status_socket(websocket: WebSocket, label: str):
    """Send the current installation status, then hold the connection open
    so broadcast_status can push updates. The client sends nothing; the
    receive loop only waits for the disconnect message, which arrives when
    the client closes or when the server shuts down, and ends the handler."""
    await websocket.accept()
    app_state.active_connections.append(websocket)
    logger.info(f"{label} client connected. Total connections: {len(app_state.active_connections)}")

    try:
        logger.info(f"Sending initial status to new WebSocket client: {app_state.installation_status}")
        await websocket.send_json(app_state.installation_status)

        while True:
            message = await websocket.receive()
            if message["type"] == "websocket.disconnect":
                break
    except WebSocketDisconnect:
        pass
    finally:
        # broadcast_status removes a connection whose send failed, so the
        # socket may already be gone from the list.
        if websocket in app_state.active_connections:
            app_state.active_connections.remove(websocket)
        logger.info(f"{label} client disconnected. Total connections: {len(app_state.active_connections)}")


# WebSocket for real-time updates
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await serve_status_socket(websocket, "WebSocket")

# Also keep the /api/ws endpoint for compatibility
@app.websocket("/api/ws")
async def api_websocket_endpoint(websocket: WebSocket):
    await serve_status_socket(websocket, "API WebSocket")


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="thinkube Installer Backend")
    parser.add_argument("--host", default="0.0.0.0", help="Host to bind to")
    parser.add_argument("--port", type=int, default=8000, help="Port to bind to")
    parser.add_argument("--reload", action="store_true", help="Enable auto-reload")
    
    args = parser.parse_args()
    
    uvicorn.run(
        "main:app" if args.reload else app,
        host=args.host,
        port=args.port,
        reload=args.reload
    )