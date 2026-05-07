# macOS port — brief for the porting session

This file is a transient porting brief, written by the Linux-side Claude session that scoped this work. Delete it once a `.dmg` builds and the wizard runs end-to-end on macOS.

## Goal

Produce an alpha-quality `.dmg` of the Thinkube installer that builds and runs on macOS (Apple Silicon priority; Intel optional). The wizard already deploys to remote Ubuntu targets — those don't change. Only the **install host** is being expanded.

"Alpha-quality" here means: builds, opens, walks through the wizard, runs a real deploy to an Ubuntu target. **Not** required for the alpha: code signing, notarization, universal binaries, App Store fitness.

## What's already wired (don't redo)

A scoping pass on the Linux side found the bundling/build skeleton is mostly in place:

- `frontend/src-tauri/tauri.conf.json` — `targets: ["deb", "dmg"]`, `minimumSystemVersion: "11.0"`, `icon.icns` declared.
- `frontend/src-tauri/src/lib.rs` — `#[cfg(target_os = "macos")]` block around lines 81–113 creates `.venv` and runs `pip install -r requirements.txt` on first launch (since `.dmg` bundles can't run a postinst script the way `.deb` does).
- `scripts/build.sh` — Darwin branch (lines ~18–23), Xcode CLT check (~90–98), `.dmg` copy from `target/release/bundle/dmg/` (~150–165).
- `scripts/setup-build-env.sh` — Darwin branch (~15–20), Xcode CLT prompt (~121–131).

So the workflow is: `./scripts/setup-build-env.sh && ./scripts/build.sh`, then iterate on whatever fails.

## Known-likely-broken (don't pre-fix; expect to hit these)

The Linux scoping pass surfaced these as "almost certainly will break on macOS." Don't pre-fix — try the build and the wizard, hit them as they come up, fix in place, commit each fix.

1. **`scripts/build.sh` ~line 56** — Rust version check uses `sort -V -C`. BSD `sort` (default on macOS) doesn't accept those flags. Replace with bash version compare or skip to a different tool.

2. **`frontend/src-tauri/backend/app/api/system.py`** — host network/OS detection shells out to Linux-only commands:
   - `ip link show`, `ip addr show <iface>`, `ip route get 8.8.8.8` (around lines 29, 54, 95, 119)
   - `open('/etc/os-release')` (line 322)

   macOS equivalents: `ifconfig -l` / `ifconfig <iface>`, `route -n get default` (or `netstat -rn`), `sw_vers -productName` / `-productVersion`. Branch on `platform.system() == "Darwin"` per call site rather than abstracting — the implementations diverge enough that explicit if/else is clearer.

3. **Possibly host-side, please verify before assuming target-only**:
   - `frontend/src-tauri/backend/app/core/discovery.py` lines ~206–281 use `lsb_release`. Likely SSH-shipped to the Ubuntu target, but spot-check.
   - `frontend/src-tauri/backend/app/api/discovery.py` ~121–250 has an embedded hardware-probe bash. Confirm it runs over SSH on the target.
   - `frontend/src-tauri/backend/app/services/driver_installer.py` references `/tmp`, `sudo sh`, `/var/log/nvidia-installer.log`. These should be paths on the **target** (run via Ansible), not on the host. Verify.

   If any of those turn out to read host paths, fix them.

## Deliberately out of scope (don't touch)

- **`scripts/deploy.sh`** — Linux-only `.deb` build+install helper. macOS users open the `.dmg` and drag the app to `/Applications`. Don't add `brew` or Homebrew branches — leave it Linux-only and document the macOS path in the README instead.
- **Code signing / notarization** — alpha is unsigned. The user right-clicks → Open the first time to bypass Gatekeeper. Add a one-line note in `README.md`.
- **Anything in `ansible/` or the deploy targets** — those stay Ubuntu. Don't change Ansible playbooks for macOS.
- **The frontend wizard's "Ubuntu" copy** — refers to deploy targets, which IS still Ubuntu. Don't reword.

## Workflow

- Work on a branch: `git checkout -b mac-port` (or whatever you prefer). Don't push fixes straight to `main` — the user wants to review in a single PR before merge.
- Commit each fix as its own logical commit with an accurate message (no invented framings — see `~/.claude/.../memory/feedback_accurate_commit_messages.md` if you have memory access; otherwise: stick to observed facts, no generalizing from one observation).
- After each commit, push the branch (so the Linux-side and the user can see progress).
- When you hit something architectural (e.g. a backend rewrite is needed, an Ansible flow has to change, an upstream Tauri bug) — stop and surface it rather than pushing through.

## Verification ladder

Each step gates the next. Don't move on until the previous one works:

1. **Build** — `./scripts/setup-build-env.sh && ./scripts/build.sh` produces `installers/*.dmg`.
2. **Install + open** — drag `.dmg` to `/Applications`, right-click → Open. Window appears (might be white briefly while the venv bootstraps on first launch — check Console.app for backend stderr if it stays white).
3. **Welcome → Sudo password → Server discovery** — the network CIDR auto-fill should be sensible. This is where `system.py`'s `ip` calls will fail without #2 above.
4. **Discovery scan** — at least one Ubuntu target gets discovered.
5. **Walk the rest of the wizard** through to deploy queue. The downstream screens talk to **targets** over SSH; should "just work" if discovery did.
6. **Run a real deploy** to a test Ubuntu target. Confirm `~/.thinkube-installer/ansible-venv/` is created on the Mac, the thinkube repo gets cloned, and Ansible runs against the target.

## Context references

- `CLAUDE.md` at repo root — project overview, dev/build/run commands, architecture.
- The Linux-side session that wrote this brief is in `/home/thinkube/.claude/projects/-home-thinkube-thinkube-installer/` if cross-referencing memory entries is useful.

When the wizard runs end-to-end on a Mac and a deploy succeeds, delete this file in the same PR.
