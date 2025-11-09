#!/usr/bin/env python3

# Copyright 2025 Alejandro Martínez Corriá and the Thinkube contributors
# SPDX-License-Identifier: Apache-2.0

"""
Logs API Router
Handles log file management and download functionality
"""

import logging
import zipfile
from pathlib import Path
from typing import List
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/logs", tags=["logs"])


@router.get("/download")
async def download_logs():
    """
    Download all installation logs as a zip file
    Includes profiler logs and any failure logs
    """
    try:
        log_dir = Path.home() / ".thinkube-installer" / "logs"

        if not log_dir.exists():
            raise HTTPException(
                status_code=404,
                detail="No logs found. Logs are only created when TK_PROFILER=1 is set."
            )

        # Get all log files
        log_files = list(log_dir.glob("*.log"))

        if not log_files:
            raise HTTPException(
                status_code=404,
                detail="No log files found in log directory"
            )

        # Create zip file in temp directory
        zip_path = Path("/tmp/thinkube_installation_logs.zip")

        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for log_file in log_files:
                # Add file to zip with just the filename (not full path)
                zipf.write(log_file, log_file.name)
                logger.info(f"Added {log_file.name} to zip")

        logger.info(f"Created log archive with {len(log_files)} files at {zip_path}")

        return FileResponse(
            zip_path,
            media_type="application/zip",
            filename="thinkube_installation_logs.zip"
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating log archive: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to create log archive: {str(e)}"
        )


@router.get("/list")
async def list_logs():
    """
    List all available log files
    """
    try:
        log_dir = Path.home() / ".thinkube-installer" / "logs"

        if not log_dir.exists():
            return {
                "log_dir": str(log_dir),
                "exists": False,
                "logs": [],
                "message": "Logs are only created when TK_PROFILER=1 is set"
            }

        log_files = []
        for log_file in sorted(log_dir.glob("*.log"), reverse=True):
            log_files.append({
                "filename": log_file.name,
                "size": log_file.stat().st_size,
                "modified": log_file.stat().st_mtime,
                "path": str(log_file)
            })

        return {
            "log_dir": str(log_dir),
            "exists": True,
            "count": len(log_files),
            "logs": log_files
        }

    except Exception as e:
        logger.error(f"Error listing logs: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to list logs: {str(e)}"
        )


@router.get("/failures")
async def list_failure_logs():
    """
    List all failure log files
    """
    try:
        log_dir = Path.home() / ".thinkube-installer" / "logs"
        failures_dir = log_dir / "failures"

        if not failures_dir.exists():
            return {
                "failures_dir": str(failures_dir),
                "exists": False,
                "failures": [],
                "message": "No failure logs found"
            }

        failure_logs = []
        for log_file in sorted(failures_dir.glob("*.log"), reverse=True):
            failure_logs.append({
                "filename": log_file.name,
                "size": log_file.stat().st_size,
                "modified": log_file.stat().st_mtime,
                "path": str(log_file)
            })

        return {
            "failures_dir": str(failures_dir),
            "exists": True,
            "count": len(failure_logs),
            "failures": failure_logs
        }

    except Exception as e:
        logger.error(f"Error listing failure logs: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to list failure logs: {str(e)}"
        )
