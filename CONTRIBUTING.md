# Contributing to Thinkube Installer

Thanks for considering a contribution. This document covers how to fork
the relevant Thinkube repositories, point the installer at your fork,
and test your changes end-to-end.

## Repository layout

Thinkube is split across several repositories. Most contributors only
touch one at a time:

| Repository | What it contains |
|---|---|
| [`thinkube-installer`](https://github.com/thinkube/thinkube-installer) | Desktop installer (Tauri + React + FastAPI) |
| [`thinkube`](https://github.com/thinkube/thinkube) | Ansible playbooks for cluster + platform |
| [`thinkube-metadata`](https://github.com/thinkube/thinkube-metadata) | Release manifests, channel pointers, mirror catalogues |
| [`thinkube-control`](https://github.com/thinkube/thinkube-control) | In-cluster admin UI (deployed by the installer) |

## Fork-and-test workflow

The installer reads three environment variables that let you point it
at your own forks without editing the installer source:

| Env var | What it overrides | Default |
|---|---|---|
| `THINKUBE_REPO_URL` | The thinkube playbooks repo the installer clones | `https://github.com/thinkube/thinkube.git` |
| `THINKUBE_BRANCH` | The branch of that repo to clone | `main` |
| `THINKUBE_METADATA_REPO` | The metadata repo (org/repo) the installer reads channels + release manifests from | `thinkube/thinkube-metadata` |

### Testing a fork of `thinkube` (playbook changes)

```bash
cd thinkube-installer/frontend
THINKUBE_REPO_URL=https://github.com/<your-username>/thinkube.git \
THINKUBE_BRANCH=my-feature-branch \
npm run tauri:dev
```

The installer will `git clone -b my-feature-branch
https://github.com/<you>/thinkube.git` into `/tmp/thinkube-installer-<uid>/`
on each run. It always re-clones — local edits to that path are
discarded; push your changes to the fork to pick them up.

### Testing a fork of `thinkube-metadata` (release manifests)

```bash
cd thinkube-installer/frontend
THINKUBE_METADATA_REPO=<your-username>/thinkube-metadata \
npm run tauri:dev
```

The installer will resolve channels (and manifests) from your fork's
`main` branch + tags. Useful when prototyping a new release line
without publishing to the upstream metadata repo.

### Testing both at once

```bash
THINKUBE_REPO_URL=https://github.com/<you>/thinkube.git \
THINKUBE_BRANCH=my-feature-branch \
THINKUBE_METADATA_REPO=<you>/thinkube-metadata \
npm run tauri:dev
```

### Other useful environment variables

See the root `README.md` for the full list. The ones most relevant
during development:

- `TK_TEST=1` — manual playbook control (no auto-advance between
  steps). Use during iteration so you can re-run a failing playbook
  without restarting the whole deploy queue.
- `TK_SHELL_CONFIG=1` — include the shell-aliases playbook in the
  deploy queue.
- `TK_PROFILER=1` — enable Ansible profiling.

## Multi-repo worktree workflow

If you're iterating on more than one repo at a time, [git
worktrees](https://git-scm.com/docs/git-worktree) let you keep `main`
and your feature branch checked out side-by-side without duplicating
the `.git` directory. The pattern Thinkube uses for the kubeadm
migration (see `KUBEADM_MIGRATION_PLAN.md` §9.2 for the full
walkthrough):

```bash
# From the existing checkout on main:
cd /path/to/thinkube
git fetch origin
git worktree add /path/to/thinkube-myfeature -b my-feature origin/main
```

Result: `/path/to/thinkube` stays on `main` (for reference / `git
log`); `/path/to/thinkube-myfeature` is your isolated feature
worktree. Same pattern for each repo.

## Per-PR scope

Each PR should focus on one concern. The integration branch for the
kubeadm migration (see `KUBEADM_MIGRATION_PLAN.md` §9.1) carries
sub-branches for each discrete change — that's the model to follow.
"No room for two PRs in one" is the rule of thumb: rebase or split
before opening if a change has grown.

## Commit messages

Look at recent `git log --oneline` for style. Brief subject (≤72
chars) describing what changed; body explains *why* if it isn't
obvious from the diff. Reference the migration plan section
(`KUBEADM_MIGRATION_PLAN.md §X.Y`) when the change implements a
documented decision.

## Filing issues

See the public issues at
[github.com/thinkube/thinkube/issues](https://github.com/thinkube/thinkube/issues).
Please search before filing — many recurring questions already have
threads.
