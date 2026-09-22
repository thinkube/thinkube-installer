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
SPDX = 'SPDX-License-Identifier: Apache-2.0'

# Comment styles. A file type is here only when a comment at the top of the
# file is valid for every file of that type.
HEADERS = {
    'hash': [f'# {COPYRIGHT}', f'# {SPDX}'],
    'block': ['/*', f' * {COPYRIGHT}', f' * {SPDX}', ' */'],
    'xml': ['<!--', f'  {COPYRIGHT}', f'  {SPDX}', '-->'],
}

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


def add_header(filepath: Path, style: str, dry_run: bool) -> str:
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

    header_lines = HEADERS[style]
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

    stats: Dict[str, int] = {'added': 0, 'present': 0, 'binary': 0,
                             'unreadable': 0, 'no style': 0}

    for filepath in tracked_files(repo_root):
        if not filepath.is_file() or filepath.is_symlink():
            continue
        style = get_comment_style(filepath)
        if style is None:
            stats['no style'] += 1
            continue
        outcome = add_header(filepath, style, args.dry_run)
        stats[outcome] += 1
        if args.verbose and outcome == 'added':
            print(f"  {filepath.relative_to(repo_root)}")

    print(f"\nrepository: {repo_root}")
    print(f"  headers {'to add' if args.dry_run else 'added'}: {stats['added']}")
    print(f"  already carried one:   {stats['present']}")
    print(f"  no comment style:      {stats['no style']}")
    if stats['binary']:
        print(f"  not text:              {stats['binary']}")
    if stats['unreadable']:
        print(f"  unreadable:            {stats['unreadable']}")
    if args.dry_run:
        print("\ndry run: nothing was written")

    sys.exit(1 if stats['unreadable'] else 0)


if __name__ == '__main__':
    main()
