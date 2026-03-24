# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Thinkube Installer is a desktop application for deploying Thinkube (Kubernetes homelab platform) to remote Ubuntu servers. It is a hybrid Tauri v2 application with:
- **Frontend**: React 19 + TypeScript + Tailwind CSS 4 + Radix UI (in `frontend/src/`)
- **Backend**: FastAPI (Python) at `frontend/src-tauri/backend/`
- **Desktop Framework**: Tauri v2 (Rust in `frontend/src-tauri/src/`)
- **Deployment**: Ansible playbooks cloned from github.com/thinkube/thinkube
- **Design System**: `thinkube-style` (GitHub dependency) providing `TkThemeProvider`, `TkAppHeader`, `TkToaster`

## Development Commands

### Running in Development Mode

```bash
cd frontend && npm run tauri:dev
```

This starts Tauri in development mode, which:
- Starts the FastAPI backend from `frontend/src-tauri/backend/` with `venv-test`
- Starts Vite dev server on `http://localhost:5173`
- Opens the desktop window
- Backend runs on `http://localhost:8000` (API docs at `/docs`)

**Environment variables**:
```bash
THINKUBE_BRANCH=feature-x npm run tauri:dev  # Clone specific thinkube branch
TK_TEST=1 npm run tauri:dev                   # Enable test mode (manual playbook control)
TK_SHELL_CONFIG=1 npm run tauri:dev           # Include shell configuration
TK_PROFILER=1 npm run tauri:dev               # Enable Ansible profiling
```

### Frontend Only

```bash
cd frontend && npm run dev     # Vite dev server on http://localhost:5173
cd frontend && npm run build   # Build to frontend/dist/
cd frontend && npm run lint    # ESLint
```

### Backend Only

```bash
cd frontend/src-tauri/backend
python3 -m venv venv-test
source venv-test/bin/activate
pip install -r requirements.txt
python main.py --reload        # FastAPI with hot reload on http://localhost:8000
```

### Building

```bash
./scripts/setup-build-env.sh   # One-time build environment setup
./scripts/build.sh             # Build .deb (Linux) or .dmg (macOS) to installers/
```

### Testing Production Builds

Do NOT run the binary directly from `target/release/` - it requires the backend venv created by the post-install script.

```bash
sudo dpkg -i installers/thinkube-installer_0.1.0_arm64.deb  # Install
thinkube-installer                                           # Run
sudo dpkg -r thinkube-installer                              # Uninstall
```

## Architecture

### Backend (`frontend/src-tauri/backend/`)

**The backend is NOT at the project root** - it lives inside the Tauri directory for bundling.

Modular FastAPI application:

- `main.py` - App init, CORS, WebSocket endpoints (`/ws` and `/api/ws`), includes 12 routers
- `app/shared.py` - `AppState` singleton with `installation_status` dict and `broadcast_status()` for WebSocket push
- `app/api/` - FastAPI routers:
  - `ansible_setup.py` - POST `/api/ansible/initialize`
  - `discovery.py` - Network/server discovery
  - `playbook_stream.py` - WebSocket streaming of Ansible execution
  - `playbooks.py` - Playbook execution triggers
  - `configuration.py` - Save/load inventory and config
  - `gpu_detection.py` - GPU and NVIDIA driver detection
  - `zerotier.py`, `github.py`, `tokens.py`, `system.py`, `logs.py`
- `app/services/` - Business logic:
  - `ansible_environment.py` - `AnsibleEnvironment` singleton: manages venv at `~/.thinkube-installer/ansible-venv/`, clones thinkube repo to `/tmp/thinkube-installer/`
  - `ansible_executor.py` - Executes playbooks with progress tracking
  - `driver_installer.py` - GPU driver installation
- `app/core/discovery.py` - Network discovery and SSH connectivity verification

### Frontend (`frontend/src/`)

React 19 app with a multi-step wizard flow using React Router v7:

- `main.tsx` - Entry point, `BrowserRouter` with all routes, wrapped in `TkThemeProvider`
- `pages/` - 14 wizard screens: welcome, requirements, sudo-password, server-discovery, hardware-detection, gpu-driver-check, role-assignment, network-configuration, configuration, ssh-setup, review, deploy, installation, complete
- `components/PlaybookExecutorStream.tsx` - Core component for streaming Ansible playbook output via WebSocket
- `utils/inventoryGenerator.js` - Full inventory generation for deployment
- `utils/minimalInventory.js` - Minimal inventory for SSH setup only
- `utils/axios.ts` - Configured axios instance pointing to `http://localhost:8000` with `/api` prefix interceptor
- `lib/` - Utility functions (`utils.ts`, `ansible-log-utils.ts`)

**State management**: Zustand for client state. Session data (sudo password, discovered servers) stored in `sessionStorage`. Configuration persisted to `~/.env`.

**UI components**: Radix UI primitives (no shadcn/ui `components/ui/` directory). Icons from `lucide-react`.

### Tauri Integration (`frontend/src-tauri/src/lib.rs`)

- Development: Backend at `./backend` (relative to `frontend/src-tauri/`), uses `venv-test`
- Production: Backend from bundled resources, uses `.venv`
- macOS: Creates venv on first launch
- Linux: Venv created by `deb-postinst.sh` during package installation
- `get_config_flags()` Tauri command exposes `TK_TEST` and `TK_SHELL_CONFIG` to frontend

### Two Inventory Systems

The installer uses **two different** inventory generators at different stages:
1. **Minimal** (`minimalInventory.js`): Used only for SSH key setup. Contains just `ansible_host` + `ansible_user`.
2. **Full** (`inventoryGenerator.js`): Used for all deployment playbooks. Contains roles, network config, tokens, hardware info.

`PlaybookExecutorStream.tsx` selects which to use based on `playbookName`.

### WebSocket Communication

Backend broadcasts installation status via WebSocket:
```python
app_state.installation_status = {"phase": "running", "progress": 50, "current_task": "...", "logs": [...], "errors": [...]}
await broadcast_status(app_state.installation_status)
```

### Ansible Deployment Flow

1. Initialize environment (`/api/ansible/initialize`): Creates `~/.thinkube-installer/ansible-venv/` + clones thinkube repo
2. Configuration: Frontend collects server details, saved to `~/.thinkube-installer/inventory.yaml`
3. Deployment (`/api/playbooks/execute`): Executes playbooks with real-time WebSocket streaming
4. Cleanup: Temporary clone in `/tmp/thinkube-installer/` removed

## Testing

No formal test suite exists yet. Testing is done via:
1. Running `npm run tauri:dev` and manually testing the wizard flow
2. Testing deployment to actual Ubuntu VMs/servers
3. Building packages and testing installation on clean systems

When adding tests in the future:
- Backend: Use `pytest` with FastAPI's `TestClient`
- Frontend: Use Vitest (Vite's test framework)

## Debugging Production Builds

**White screen** on launch means the backend isn't running. Common causes:
1. **No venv**: Post-install script didn't run or failed (check `journalctl` during install)
2. **Port 8000 in use**: Another backend instance running (kill with `pkill -f "python3 main.py"`)
3. **Python errors**: Manual check: `cd /usr/lib/thinkube-installer/backend && .venv/bin/python3 main.py`

**Check logs**:
```bash
journalctl --user -f | grep -i thinkube
ps aux | grep "python3 main.py"
```

## Key Gotchas

1. **Backend path**: Located at `frontend/src-tauri/backend/`, NOT `backend/` at root. The root `package.json` has a stale `backend:dev` script pointing to the wrong path.

2. **Root vs frontend package.json**: The root `package.json` still references Vue.js/Pinia dependencies (legacy). The actual frontend dependencies are in `frontend/package.json` (React).

3. **Two venv names**: Development uses `venv-test`, production uses `.venv`. Cargo runs from `frontend/src-tauri/` in development.

4. **Tauri v2 requires Rust 1.82+**: The build script checks and upgrades if needed.

5. **NVIDIA GPU white screen**: On systems with NVIDIA GPUs, `WEBKIT_DISABLE_DMABUF_RENDERER=1` is needed. The installer sets this automatically.

6. **Inventory persistence**: Config saved to `~/.env` (tokens, cluster settings). Full inventory at `~/.thinkube-installer/inventory.yaml`.

7. **No deployment resume**: Installer always starts fresh. If deployment fails, must restart from configuration.

8. **Single-server SSH issue**: In single-server setups, the ZeroTier IP is detected as local and SSH verification is skipped during discovery. SSH is only actually tested during the SSH setup playbook (step 5).

9. **Node.js version**: Development tested with Node 22.16.0 via nvm. Install from `~/.nvm/` or `~/.local/share/nvm/`.

10. **Product name uses dash**: The `productName` in `tauri.conf.json` is `thinkube-installer` (with dash) to avoid path issues. The window title uses "Thinkube Installer" for display only.

## Adding a New API Endpoint

1. Create router in `frontend/src-tauri/backend/app/api/new_feature.py`
2. Import and include router in `frontend/src-tauri/backend/main.py`

## Adding a New Wizard Screen

1. Create React component in `frontend/src/pages/new-screen.tsx`
2. Add route in `frontend/src/main.tsx`
3. Add navigation to adjacent screens

## Modifying Ansible Playbooks

Playbooks are in the separate `thinkube` repository (github.com/thinkube/thinkube):
- Edit in `~/thinkube/` (source of truth)
- Commit and push to GitHub
- Pull into `/tmp/thinkube-installer/` if installer is already running
- Never edit files directly in `/tmp/thinkube-installer/`
