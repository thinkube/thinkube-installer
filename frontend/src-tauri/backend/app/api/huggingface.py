# Copyright 2025 Alejandro Martínez Corriá and the Thinkube contributors
# SPDX-License-Identifier: Apache-2.0

"""
HuggingFace API endpoints for token verification
"""
from fastapi import APIRouter, HTTPException
from typing import Dict
import httpx

router = APIRouter(prefix="/api", tags=["huggingface"])


@router.post("/verify-huggingface")
async def verify_huggingface_token(data: Dict[str, str]):
    """Verify a HuggingFace access token by calling whoami-v2."""
    token = (data.get("token") or "").strip()

    if not token:
        raise HTTPException(status_code=400, detail="HuggingFace token is required")

    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                "https://huggingface.co/api/whoami-v2",
                headers={"Authorization": f"Bearer {token}"},
                timeout=10.0,
            )

            if response.status_code == 200:
                user_data = response.json()
                username = user_data.get("name") or user_data.get("fullname") or "Unknown"
                return {
                    "valid": True,
                    "username": username,
                    "message": f"Token verified for user: {username}",
                }
            if response.status_code == 401:
                return {"valid": False, "message": "Invalid or expired HuggingFace token"}
            return {"valid": False, "message": f"HuggingFace API error: {response.status_code}"}

    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="HuggingFace API request timed out")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to verify token: {str(e)}")
