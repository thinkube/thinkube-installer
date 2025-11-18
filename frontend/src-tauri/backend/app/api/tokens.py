# Copyright 2025 Alejandro Martínez Corriá and the Thinkube contributors
# SPDX-License-Identifier: Apache-2.0

"""
Token management API endpoints for secure storage of sensitive tokens
"""
from fastapi import APIRouter, HTTPException
from pathlib import Path
import os
import stat
from typing import Dict, Optional

from ..models.server import TokenRequest, TokenResponse

router = APIRouter(prefix="/api", tags=["tokens"])

# Default location for secure token storage
TOKEN_FILE = Path.home() / ".env"

def ensure_secure_permissions(file_path: Path):
    """Ensure the file has secure permissions (600)"""
    if file_path.exists():
        # Set permissions to 600 (read/write for owner only)
        os.chmod(file_path, stat.S_IRUSR | stat.S_IWUSR)

def read_env_file() -> Dict[str, str]:
    """Read the .env file and return as dictionary"""
    env_vars = {}
    if TOKEN_FILE.exists():
        with open(TOKEN_FILE, 'r') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    env_vars[key.strip()] = value.strip()
    return env_vars

def write_env_file(env_vars: Dict[str, str]):
    """Write dictionary to .env file"""
    # Create backup if file exists
    if TOKEN_FILE.exists():
        backup_file = TOKEN_FILE.with_suffix('.env.bak')
        TOKEN_FILE.rename(backup_file)
    
    try:
        with open(TOKEN_FILE, 'w') as f:
            f.write("# Thinkube secure token storage\n")
            f.write("# This file contains sensitive tokens and should not be shared\n\n")
            for key, value in sorted(env_vars.items()):
                f.write(f"{key}={value}\n")
        
        # Set secure permissions
        ensure_secure_permissions(TOKEN_FILE)
        
        # Remove backup if successful
        backup_file = TOKEN_FILE.with_suffix('.env.bak')
        if backup_file.exists():
            backup_file.unlink()
            
    except Exception as e:
        # Restore backup on error
        backup_file = TOKEN_FILE.with_suffix('.env.bak')
        if backup_file.exists():
            backup_file.rename(TOKEN_FILE)
        raise e

@router.post("/store-cloudflare-token")
async def store_cloudflare_token(request: TokenRequest) -> TokenResponse:
    """Store Cloudflare API token securely in ~/.env file"""
    try:
        # Read existing env vars
        env_vars = read_env_file()
        
        # Update with new token
        env_vars['CLOUDFLARE_TOKEN'] = request.token
        
        # Write back to file
        write_env_file(env_vars)
        
        return TokenResponse(
            success=True,
            message="Cloudflare token stored securely in ~/.env"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to store token: {str(e)}")

@router.post("/store-github-token")
async def store_github_token(request: TokenRequest) -> TokenResponse:
    """Store GitHub API token securely in ~/.env file"""
    try:
        # Read existing env vars
        env_vars = read_env_file()
        
        # Update with new token
        env_vars['GITHUB_TOKEN'] = request.token
        
        # Write back to file
        write_env_file(env_vars)
        
        return TokenResponse(
            success=True,
            message="GitHub token stored securely in ~/.env"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to store token: {str(e)}")

@router.post("/store-zerotier-token")
async def store_zerotier_token(request: TokenRequest) -> TokenResponse:
    """Store ZeroTier API token securely in ~/.env file"""
    try:
        # Read existing env vars
        env_vars = read_env_file()
        
        # Update with new token
        env_vars['ZEROTIER_TOKEN'] = request.token
        
        # Write back to file
        write_env_file(env_vars)
        
        return TokenResponse(
            success=True,
            message="ZeroTier token stored securely in ~/.env"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to store token: {str(e)}")

@router.post("/save-configuration")
async def save_configuration(config: Dict) -> TokenResponse:
    """Save all configuration values to ~/.env file"""
    try:
        # Read existing env vars
        env_vars = read_env_file()

        # Update with all config values
        if config.get('cloudflareToken'):
            env_vars['CLOUDFLARE_TOKEN'] = config['cloudflareToken']
        if config.get('githubToken'):
            env_vars['GITHUB_TOKEN'] = config['githubToken']
        if config.get('hfToken'):
            env_vars['HF_TOKEN'] = config['hfToken']
        if config.get('zerotierApiToken'):
            env_vars['ZEROTIER_API_TOKEN'] = config['zerotierApiToken']
        if config.get('zerotierNetworkId'):
            env_vars['ZEROTIER_NETWORK_ID'] = config['zerotierNetworkId']
        if config.get('githubOrg'):
            env_vars['GITHUB_ORG'] = config['githubOrg']
        if config.get('clusterName'):
            env_vars['CLUSTER_NAME'] = config['clusterName']
        if config.get('domainName'):
            env_vars['DOMAIN_NAME'] = config['domainName']

        # Write back to file
        write_env_file(env_vars)

        return TokenResponse(
            success=True,
            message="Configuration saved to ~/.env"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save configuration: {str(e)}")


@router.get("/load-configuration")
async def load_configuration() -> Dict:
    """Load all configuration values from ~/.env file"""
    try:
        env_vars = read_env_file()

        # Map env vars to config fields
        config = {}
        if 'CLOUDFLARE_TOKEN' in env_vars:
            config['cloudflareToken'] = env_vars['CLOUDFLARE_TOKEN']
        if 'GITHUB_TOKEN' in env_vars:
            config['githubToken'] = env_vars['GITHUB_TOKEN']
        if 'HF_TOKEN' in env_vars:
            config['hfToken'] = env_vars['HF_TOKEN']
        if 'ZEROTIER_API_TOKEN' in env_vars:
            config['zerotierApiToken'] = env_vars['ZEROTIER_API_TOKEN']
        if 'ZEROTIER_NETWORK_ID' in env_vars:
            config['zerotierNetworkId'] = env_vars['ZEROTIER_NETWORK_ID']
        if 'GITHUB_ORG' in env_vars:
            config['githubOrg'] = env_vars['GITHUB_ORG']
        if 'CLUSTER_NAME' in env_vars:
            config['clusterName'] = env_vars['CLUSTER_NAME']
        if 'DOMAIN_NAME' in env_vars:
            config['domainName'] = env_vars['DOMAIN_NAME']

        return {
            "exists": len(config) > 0,
            "config": config
        }
    except Exception:
        return {
            "exists": False,
            "config": {}
        }


@router.get("/check-tokens")
async def check_tokens() -> Dict[str, bool]:
    """Check which tokens are present in ~/.env file"""
    try:
        env_vars = read_env_file()
        return {
            "cloudflare": "CLOUDFLARE_TOKEN" in env_vars,
            "github": "GITHUB_TOKEN" in env_vars,
            "zerotier": "ZEROTIER_TOKEN" in env_vars or "ZEROTIER_API_TOKEN" in env_vars
        }
    except Exception:
        return {
            "cloudflare": False,
            "github": False,
            "zerotier": False
        }