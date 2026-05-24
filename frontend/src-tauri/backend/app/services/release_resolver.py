# Copyright 2025 Alejandro Martínez Corriá and the Thinkube contributors
# SPDX-License-Identifier: Apache-2.0

"""
Release resolver.

Reads the channels file in thinkube-metadata, picks the version a channel
points at, fetches the immutable release manifest at the corresponding
git tag, and returns it as a parsed dict.

URL shape:
  channels   → raw.githubusercontent.com/<METADATA_REPO>/main/channels.json
  manifest   → raw.githubusercontent.com/<METADATA_REPO>/<tag>/releases/<version>.yaml

Resolution is one-shot — no background polling. The installer calls this
when the user is about to start an install. snap-style overnight surprises
(canonical/k8s-snap#2529) cannot happen by construction.

Env var:
  THINKUBE_METADATA_REPO   default: thinkube/thinkube-metadata
                           override for fork testing
                           (see CONTRIBUTING.md)
"""

from __future__ import annotations

import logging
import os
from typing import Any

import httpx
import yaml

logger = logging.getLogger(__name__)

DEFAULT_METADATA_REPO = "thinkube/thinkube-metadata"
RAW_BASE = "https://raw.githubusercontent.com"
FETCH_TIMEOUT_SECONDS = 30


class ChannelEmpty(Exception):
    """Raised when the requested channel exists but resolves to null
    (e.g. the channel hasn't been promoted yet)."""


class ChannelNotFound(Exception):
    """Raised when the requested channel name isn't present in channels.json."""


class ManifestFetchError(Exception):
    """Raised when the manifest URL cannot be retrieved."""


def _metadata_repo() -> str:
    """Resolve the metadata repo identifier (org/repo)."""
    return os.environ.get("THINKUBE_METADATA_REPO", DEFAULT_METADATA_REPO)


def _channels_url(repo: str) -> str:
    return f"{RAW_BASE}/{repo}/main/channels.json"


def _manifest_url(repo: str, tag: str, version: str) -> str:
    # `version` already starts with `v` per the manifest filename convention
    # (e.g. v1.35.5+thinkube.0.1.0.yaml). The `+` is filesystem-safe but
    # must be URL-encoded for HTTP.
    safe = version.replace("+", "%2B")
    return f"{RAW_BASE}/{repo}/{tag}/releases/{safe}.yaml"


async def resolve_channel(channel: str = "stable") -> dict[str, Any]:
    """
    Resolve `channel` to a fully parsed release manifest.

    Raises ChannelNotFound, ChannelEmpty, or ManifestFetchError on the
    failure modes their names describe. The caller surfaces these to the
    UI; the installer is fail-loud about manifest resolution because every
    pinned version downstream depends on it.
    """
    repo = _metadata_repo()
    channels_url = _channels_url(repo)
    logger.info("Resolving channel %r from %s", channel, channels_url)

    async with httpx.AsyncClient(timeout=FETCH_TIMEOUT_SECONDS) as client:
        try:
            r = await client.get(channels_url)
            r.raise_for_status()
        except httpx.HTTPError as e:
            raise ManifestFetchError(f"Could not fetch channels.json from {channels_url}: {e}") from e

        channels_doc = r.json()
        channels = channels_doc.get("channels", {})
        if channel not in channels:
            raise ChannelNotFound(
                f"Channel {channel!r} not present in {channels_url}. "
                f"Available: {sorted(channels)}"
            )

        entry = channels[channel]
        if entry is None:
            raise ChannelEmpty(
                f"Channel {channel!r} exists but is null. "
                f"It has not been promoted to a released version yet."
            )

        version = entry["version"]
        metadata_tag = entry.get("metadata_tag", version)
        manifest_url = _manifest_url(repo, metadata_tag, version)
        logger.info("Channel %r → %s, fetching manifest from %s", channel, version, manifest_url)

        try:
            m = await client.get(manifest_url)
            m.raise_for_status()
        except httpx.HTTPError as e:
            raise ManifestFetchError(f"Could not fetch manifest from {manifest_url}: {e}") from e

        try:
            manifest = yaml.safe_load(m.text)
        except yaml.YAMLError as e:
            raise ManifestFetchError(f"Manifest at {manifest_url} is not valid YAML: {e}") from e

    return manifest
