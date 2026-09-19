# Copyright 2025 Alejandro Martínez Corriá and the Thinkube contributors
# SPDX-License-Identifier: Apache-2.0

"""
The Thinkube fonts on the computer that runs the installer.

Thinkube IDE and Thinkube Notebooks use Poppins for text and NotoSansM Nerd
Font for code. Pages that Thinkube serves load these fonts themselves, but
some panels in the IDE (the Claude panel) can only use fonts installed on the
viewer's computer. The installer runs on the computer the person works from,
so it installs them for the current user, which needs no administrator rights.
Licenses: backend/fonts/*-OFL.txt.
"""

import logging
import platform
import shutil
import subprocess
from pathlib import Path

logger = logging.getLogger(__name__)

FONTS_DIR = Path(__file__).resolve().parents[2] / "fonts"
FONT_FILES = [
    "Poppins-Regular.ttf",
    "Poppins-Medium.ttf",
    "Poppins-SemiBold.ttf",
    "Poppins-Bold.ttf",
    "NotoSansMNerdFont-Regular.ttf",
    "NotoSansMNerdFont-Bold.ttf",
]


def user_font_dir() -> Path:
    """The per-user font folder the operating system reads."""
    system = platform.system()
    if system == "Linux":
        return Path.home() / ".local" / "share" / "fonts" / "thinkube"
    if system == "Darwin":
        return Path.home() / "Library" / "Fonts"
    raise RuntimeError(f"Installing the Thinkube fonts is not supported on {system}")


def install_fonts() -> Path:
    """Copies the Thinkube fonts into the user's font folder.

    Copies only files that are missing or differ, so a second run changes
    nothing. On Linux, fontconfig's cache is refreshed so running programs see
    the fonts. Raises when a bundled font is missing or a step fails.
    """
    missing = [name for name in FONT_FILES if not (FONTS_DIR / name).is_file()]
    if missing:
        raise RuntimeError(f"Thinkube fonts missing from the installer bundle ({FONTS_DIR}): {', '.join(missing)}")

    target = user_font_dir()
    target.mkdir(parents=True, exist_ok=True)
    copied = []
    for name in FONT_FILES:
        source = FONTS_DIR / name
        destination = target / name
        if destination.is_file() and destination.read_bytes() == source.read_bytes():
            continue
        shutil.copyfile(source, destination)
        copied.append(name)

    if copied and platform.system() == "Linux":
        fc_cache = shutil.which("fc-cache")
        if fc_cache is None:
            raise RuntimeError("fc-cache not found: install the fontconfig package so the Thinkube fonts can be registered")
        subprocess.run([fc_cache, "-f", str(target)], check=True, capture_output=True)

    logger.info(
        "Thinkube fonts in %s: %s",
        target,
        f"installed {', '.join(copied)}" if copied else "already installed",
    )
    return target
