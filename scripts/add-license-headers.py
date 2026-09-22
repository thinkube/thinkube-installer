#!/usr/bin/env python3
"""
Add license headers to the source files of a Thinkube repository.
Formats are defined in COPYRIGHT_HEADER.md

Copyright Alejandro Martínez Corriá and the Thinkube contributors
SPDX-License-Identifier: Apache-2.0
"""

import argparse
import re
import subprocess
import sys
from pathlib import Path
from typing import Dict, List, Optional

COPYRIGHT = 'Copyright Alejandro Martínez Corriá and the Thinkube contributors'

# The identifier a LICENSE file declares, by a phrase only that licence uses.
LICENCE_MARKERS = [
    ('Apache License', 'Apache-2.0'),
    ('MIT License', 'MIT'),
    ('Redistribution and use in source and binary forms', 'BSD-3-Clause'),
]


def comment_styles(spdx_id: str) -> dict:
    """The header lines for each comment style, for one licence."""
    spdx = f'SPDX-License-Identifier: {spdx_id}'
    return {
        'hash': [f'# {COPYRIGHT}', f'# {spdx}'],
        'block': ['/*', f' * {COPYRIGHT}', f' * {spdx}', ' */'],
        'xml': ['<!--', f'  {COPYRIGHT}', f'  {spdx}', '-->'],
    }


def licence_of(repo_root: Path) -> str:
    """The SPDX identifier of the repository's LICENSE file.

    The header points at that file, so the two must agree: a repository whose
    licence cannot be identified gets no headers.
    """
    text = (repo_root / 'LICENSE').read_text(encoding='utf-8')
    for marker, spdx_id in LICENCE_MARKERS:
        if marker in text:
            return spdx_id
    sys.exit(
        f"error: cannot tell which licence {repo_root / 'LICENSE'} is. "
        "Add its identifier to LICENCE_MARKERS."
    )

EXTENSIONS = {
    '.py': 'hash',
    '.yaml': 'hash',
    '.yml': 'hash',
    '.sh': 'hash',
    '.bash': 'hash',
    '.toml': 'hash',
    '.js': 'block',
    '.mjs': 'block',
    '.cjs': 'block',
    '.ts': 'block',
    '.jsx': 'block',
    '.tsx': 'block',
    '.vue': 'block',
    '.css': 'block',
    '.scss': 'block',
    '.rs': 'block',
    '.go': 'block',
    '.html': 'xml',
}

# Names without an extension, or with one that says nothing about the syntax.
NAMES = {
    'Dockerfile': 'hash',
    'Containerfile': 'hash',
}

# Template suffixes: the comment style comes from what the template renders,
# so foo.yaml.j2 is hash and foo.json.j2 is skipped like any JSON file.
TEMPLATE_SUFFIXES = {'.j2', '.jinja', '.jinja2', '.tmpl', '.template'}

# Directories holding generated output. Some repositories track their build
# output, and a header written there is overwritten by the next build.
SKIP_PATH_PARTS = {
    'dist', 'demo-dist', 'build', 'out', 'coverage', 'target', '.next',
    'node_modules', 'vendor', '__pycache__', 'venv', '.venv', 'venv-test',
    'htmlcov', '.pytest_cache',
}

SKIP_FILES = {
    'LICENSE', 'NOTICE', 'README.md', 'CHANGELOG.md', 'package-lock.json',
    'yarn.lock', 'Cargo.lock', 'poetry.lock', 'requirements.txt', 'VERSION',
}

COPYRIGHT_PATTERNS = [
    r'Copyright',
    r'SPDX-License-Identifier',
    r'Licensed under the Apache License',
]


def tracked_files(repo_root: Path) -> List[Path]:
    """Every file git tracks in this repository.

    Git is the only source of the file list: a filesystem walk reaches
    virtual environments, caches and other checkouts, whose files belong to
    someone else.
    """
    result = subprocess.run(
        ['git', '-C', str(repo_root), 'ls-files', '-z'],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        sys.exit(
            f"error: git ls-files failed in {repo_root}: "
            f"{result.stderr.strip()}"
        )
    return [repo_root / name for name in result.stdout.split('\0') if name]


def has_copyright(content: str) -> bool:
    """Whether the first 20 lines already carry a notice."""
    for line in content.split('\n')[:20]:
        for pattern in COPYRIGHT_PATTERNS:
            if re.search(pattern, line, re.IGNORECASE):
                return True
    return False


def get_comment_style(filepath: Path) -> Optional[str]:
    """The comment style for a file, or None when it takes no header."""
    if filepath.name in SKIP_FILES:
        return None

    name = filepath.name
    # Peel template suffixes: the rendered format decides the syntax.
    while True:
        suffix = Path(name).suffix
        if suffix in TEMPLATE_SUFFIXES:
            name = name[: -len(suffix)]
            continue
        break

    peeled = Path(name)
    if peeled.name in NAMES:
        return NAMES[peeled.name]
    if peeled.name.startswith('Dockerfile.') or peeled.name.startswith('Containerfile.'):
        return 'hash'
    return EXTENSIONS.get(peeled.suffix.lower())


def add_header(filepath: Path, style: str, headers: dict, dry_run: bool) -> str:
    """Add the header. Returns 'added', 'present', 'binary' or 'unreadable'."""
    try:
        content = filepath.read_text(encoding='utf-8')
    except UnicodeDecodeError:
        return 'binary'
    except OSError as exc:
        print(f"  error reading {filepath}: {exc}")
        return 'unreadable'

    if has_copyright(content):
        return 'present'

    header_lines = headers[style]
    lines = content.split('\n')

    # A shebang, and an XML or a YAML document marker, must stay on line 1.
    keep_first = bool(lines) and (
        lines[0].startswith('#!') or lines[0].startswith('<?xml')
    )

    if keep_first:
        new_lines = [lines[0], ''] + header_lines + [''] + lines[1:]
    else:
        new_lines = header_lines + [''] + lines

    if not dry_run:
        filepath.write_text('\n'.join(new_lines), encoding='utf-8')
    return 'added'


def main() -> None:
    parser = argparse.ArgumentParser(
        description='Add license headers to the tracked source files of a repository'
    )
    parser.add_argument('path', nargs='?', default='.',
                        help='repository to process (default: current directory)')
    parser.add_argument('--dry-run', action='store_true',
                        help='list what would change, write nothing')
    parser.add_argument('--verbose', action='store_true',
                        help='name every file')
    args = parser.parse_args()

    root = Path(args.path).resolve()
    if not root.exists():
        sys.exit(f"error: {root} does not exist")

    result = subprocess.run(
        ['git', '-C', str(root), 'rev-parse', '--show-toplevel'],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        sys.exit(f"error: {root} is not inside a git repository")
    repo_root = Path(result.stdout.strip())

    if not (repo_root / 'LICENSE').exists():
        sys.exit(
            f"error: no LICENSE file in {repo_root}. Add the licence text "
            "before writing SPDX headers that point at it."
        )

    spdx_id = licence_of(repo_root)
    headers = comment_styles(spdx_id)
    print(f"licence: {spdx_id}")

    stats: Dict[str, int] = {'added': 0, 'present': 0, 'binary': 0,
                             'unreadable': 0, 'no style': 0, 'generated': 0}

    for filepath in tracked_files(repo_root):
        if not filepath.is_file() or filepath.is_symlink():
            continue
        if SKIP_PATH_PARTS & set(filepath.relative_to(repo_root).parts[:-1]):
            stats['generated'] += 1
            continue
        style = get_comment_style(filepath)
        if style is None:
            stats['no style'] += 1
            continue
        outcome = add_header(filepath, style, headers, args.dry_run)
        stats[outcome] += 1
        if args.verbose and outcome == 'added':
            print(f"  {filepath.relative_to(repo_root)}")

    print(f"\nrepository: {repo_root}")
    print(f"  headers {'to add' if args.dry_run else 'added'}: {stats['added']}")
    print(f"  already carried one:   {stats['present']}")
    print(f"  no comment style:      {stats['no style']}")
    print(f"  generated output:      {stats['generated']}")
    if stats['binary']:
        print(f"  not text:              {stats['binary']}")
    if stats['unreadable']:
        print(f"  unreadable:            {stats['unreadable']}")
    if args.dry_run:
        print("\ndry run: nothing was written")

    sys.exit(1 if stats['unreadable'] else 0)


if __name__ == '__main__':
    main()
