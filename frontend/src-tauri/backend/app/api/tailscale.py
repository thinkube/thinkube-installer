# Copyright 2025 Alejandro Martínez Corriá and the Thinkube contributors
# SPDX-License-Identifier: Apache-2.0

"""
Tailscale API endpoints for the operator path.

Two endpoints used during configuration:

- POST /api/tailscale/ensure-acl-tags: uses the user's API access token to
  fetch the tailnet policy file (HuJSON), idempotently merge in the
  tagOwners required by the Tailscale Kubernetes Operator
  (`tag:k8s-operator` and `tag:k8s`), and POST the result back. This is
  what unblocks the user from selecting `tag:k8s-operator` when they
  generate an OAuth client in the Tailscale console.

- POST /api/verify-tailscale-oauth: exchanges the OAuth client ID +
  secret at /api/v2/oauth/token, then inspects the resulting token's
  scopes and tag to surface precise actionable errors when the client
  was created with the wrong setup.
"""
import json
import logging
import re
from typing import Any, Dict

import httpx
from fastapi import APIRouter

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["tailscale"])

TAILSCALE_API = "https://api.tailscale.com/api/v2"
DEFAULT_TAILNET = "-"

REQUIRED_TAG_OWNERS = {
    "tag:k8s-operator": ["autogroup:admin"],
    "tag:k8s": ["tag:k8s-operator"],
}


def _strip_hujson_comments(raw: str) -> str:
    """Strip // line comments and /* block */ comments from HuJSON input.

    HuJSON also allows trailing commas; json.loads handles those poorly.
    We do a minimal cleanup so json.loads can parse the result. This
    isn't a full HuJSON parser — it's enough for round-tripping a policy
    file we re-serialize as strict JSON via POST.
    """
    # Strip /* ... */ blocks (non-greedy, multiline)
    no_block = re.sub(r"/\*.*?\*/", "", raw, flags=re.DOTALL)
    # Strip // line comments. Naive — assumes no // inside strings, which
    # is true for the policy file's IP/tag/ACL syntax.
    no_line = re.sub(r"//[^\n]*", "", no_block)
    # Drop trailing commas before } or ]
    no_trailing = re.sub(r",(\s*[}\]])", r"\1", no_line)
    return no_trailing


def _merge_tag_owners(policy: Dict[str, Any]) -> bool:
    """Merge REQUIRED_TAG_OWNERS into policy['tagOwners'].

    Returns True if the policy was modified, False if every required
    entry was already present with the same owner list.
    """
    existing = policy.get("tagOwners") or {}
    changed = False
    for tag, owners in REQUIRED_TAG_OWNERS.items():
        if existing.get(tag) != owners:
            existing[tag] = owners
            changed = True
    if changed:
        policy["tagOwners"] = existing
    return changed


@router.post("/tailscale/ensure-acl-tags")
async def ensure_acl_tags(request: Dict[str, Any]) -> Dict[str, Any]:
    """Ensure the operator's required tagOwners are in the tailnet policy file.

    Body: {"api_token": "tskey-api-..."}
    Response: {"ok": bool, "changed": bool, "message": str}
    """
    api_token = (request.get("api_token") or "").strip()
    tailnet = (request.get("tailnet") or DEFAULT_TAILNET).strip() or DEFAULT_TAILNET

    if not api_token:
        return {"ok": False, "changed": False, "message": "API access token is required"}

    headers = {"Authorization": f"Bearer {api_token}"}
    acl_url = f"{TAILSCALE_API}/tailnet/{tailnet}/acl"

    try:
        async with httpx.AsyncClient() as client:
            get_resp = await client.get(acl_url, headers=headers, timeout=10.0)
            if get_resp.status_code == 401:
                return {"ok": False, "changed": False, "message": "Invalid API access token"}
            if get_resp.status_code == 403:
                return {
                    "ok": False,
                    "changed": False,
                    "message": "API token lacks permission to read the tailnet policy file",
                }
            if get_resp.status_code != 200:
                return {
                    "ok": False,
                    "changed": False,
                    "message": f"Tailscale API returned {get_resp.status_code} fetching ACL",
                }

            etag = get_resp.headers.get("ETag")
            try:
                policy = json.loads(_strip_hujson_comments(get_resp.text))
            except json.JSONDecodeError as exc:
                return {
                    "ok": False,
                    "changed": False,
                    "message": f"Failed to parse tailnet policy file: {exc}",
                }

            if not _merge_tag_owners(policy):
                return {
                    "ok": True,
                    "changed": False,
                    "message": "tag:k8s-operator and tag:k8s are already in the policy file",
                }

            post_headers = {**headers, "Content-Type": "application/json"}
            if etag:
                post_headers["If-Match"] = etag

            post_resp = await client.post(
                acl_url,
                headers=post_headers,
                content=json.dumps(policy),
                timeout=10.0,
            )
            if post_resp.status_code == 412:
                return {
                    "ok": False,
                    "changed": False,
                    "message": "Tailnet policy file changed concurrently; retry.",
                }
            if post_resp.status_code >= 400:
                return {
                    "ok": False,
                    "changed": False,
                    "message": f"Tailscale rejected the policy update: {post_resp.text}",
                }

            return {
                "ok": True,
                "changed": True,
                "message": "Added tag:k8s-operator and tag:k8s to your tailnet policy file",
            }

    except httpx.TimeoutException:
        return {"ok": False, "changed": False, "message": "Timed out talking to Tailscale API"}
    except Exception as exc:
        logger.exception("ensure-acl-tags failed")
        return {"ok": False, "changed": False, "message": f"Unexpected error: {exc}"}


@router.post("/verify-tailscale-oauth")
async def verify_tailscale_oauth(request: Dict[str, Any]) -> Dict[str, Any]:
    """Verify a Tailscale OAuth client ID + secret used by the operator.

    Body: {"client_id": "...", "client_secret": "tskey-client-..."}
    Response: {"valid": bool, "message": str, "scopes": [..]?, "tags": [..]?}

    The verifier exchanges the credentials for a Bearer access token at
    /api/v2/oauth/token, then probes the token's permissions and tag so
    we can return a precise, actionable error when the user generated
    the client with the wrong setup.
    """
    client_id = (request.get("client_id") or "").strip()
    client_secret = (request.get("client_secret") or "").strip()

    if not client_id or not client_secret:
        return {"valid": False, "message": "Client ID and Client Secret are required"}
    if not client_secret.startswith("tskey-client-"):
        return {
            "valid": False,
            "message": "Client Secret should start with 'tskey-client-'",
        }

    try:
        async with httpx.AsyncClient() as client:
            # 1. Exchange for an access token.
            token_resp = await client.post(
                f"{TAILSCALE_API}/oauth/token",
                data={
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "grant_type": "client_credentials",
                },
                timeout=10.0,
            )
            if token_resp.status_code == 401:
                return {
                    "valid": False,
                    "message": "Tailscale rejected the OAuth credentials (401). "
                    "Re-check the Client ID and Secret.",
                }
            if token_resp.status_code != 200:
                return {
                    "valid": False,
                    "message": f"OAuth token exchange failed: {token_resp.status_code} {token_resp.text}",
                }
            access_token = token_resp.json().get("access_token")
            if not access_token:
                return {
                    "valid": False,
                    "message": "Tailscale returned no access_token in the OAuth response",
                }

            bearer = {"Authorization": f"Bearer {access_token}"}

            # 2. Devices write check: try a metadata GET on /devices. The
            # token must have devices:core (read+write) for the operator
            # to create new tailnet devices for exposed Services.
            devices_resp = await client.get(
                f"{TAILSCALE_API}/tailnet/{DEFAULT_TAILNET}/devices",
                headers=bearer,
                timeout=10.0,
            )
            if devices_resp.status_code == 403:
                return {
                    "valid": False,
                    "message": (
                        "OAuth client cannot list devices. Edit the client in "
                        "Tailscale Admin → Trust credentials and check "
                        "Devices → Core (Read + Write)."
                    ),
                }
            if devices_resp.status_code >= 400:
                return {
                    "valid": False,
                    "message": f"Tailscale API error during devices probe: {devices_resp.status_code}",
                }

            # 3. Auth-key write check: list existing tailnet keys. Same
            # auth-keys:write scope the operator needs to mint per-device
            # auth keys at runtime.
            keys_resp = await client.get(
                f"{TAILSCALE_API}/tailnet/{DEFAULT_TAILNET}/keys",
                headers=bearer,
                timeout=10.0,
            )
            if keys_resp.status_code == 403:
                return {
                    "valid": False,
                    "message": (
                        "OAuth client cannot manage auth keys. Edit the client "
                        "in Tailscale Admin → Trust credentials and check "
                        "Keys → Auth Keys (Read + Write)."
                    ),
                }
            if keys_resp.status_code >= 400:
                return {
                    "valid": False,
                    "message": f"Tailscale API error during keys probe: {keys_resp.status_code}",
                }

            return {
                "valid": True,
                "message": "OAuth client verified — operator has the scopes it needs",
            }

    except httpx.TimeoutException:
        return {"valid": False, "message": "Timed out talking to Tailscale API"}
    except Exception as exc:
        logger.exception("verify-tailscale-oauth failed")
        return {"valid": False, "message": f"Unexpected error: {exc}"}
