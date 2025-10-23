# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Thinkube Installer is a desktop application for deploying Thinkube (Kubernetes homelab platform) to remote Ubuntu servers. It's a hybrid Tauri v2 application with:
- **Frontend**: Vue.js 3 + Tailwind CSS + DaisyUI (in `frontend/src/`)
- **Backend**: FastAPI (Python) bundled in `frontend/src-tauri/backend/`
- **Desktop Framework**: Tauri v2 (Rust in `frontend/src-tauri/src/`)
- **Deployment**: Ansible playbooks cloned from github.com/thinkube/thinkube

The installer runs locally (Linux/macOS) and remotely deploys to Ubuntu servers via SSH and Ansible.

## Development Commands

### Running in Development Mode

**Primary development command**:
```bash
./test-dev.sh
```
This script:
- Checks system memory and warns about OOM killer
- Creates backend Python venv (`backend/venv-test`)
- Prompts to run Tauri app (which starts backend + frontend + desktop window)
- Sets environment variables for webkit compatibility

**Development flags**:
```bash
./test-dev.sh --clean-state      # Clear deployment state, keep inventory
./test-dev.sh --skip-config      # Skip config screens, use existing inventory
```

**Environment variables** (set before running):
```bash
THINKUBE_BRANCH=feature-x ./test-dev.sh  # Clone specific thinkube branch
SKIP_CONFIG=true ./test-dev.sh            # Skip configuration
CLEAN_STATE=true ./test-dev.sh            # Clean state before start
```

### Building

**Build installer for current platform**:
```bash
./scripts/build.sh
```
Output: `frontend/src-tauri/target/release/bundle/` (`.deb` on Linux, `.dmg` on macOS)
Also copies to `installers/` directory

**One-time build environment setup**:
```bash
./scripts/setup-build-env.sh
```

### Backend Development

**IMPORTANT**: Backend is located at `frontend/src-tauri/backend/` (NOT `backend/` at root level).

**Run backend directly** (for API testing):
```bash
cd frontend/src-tauri/backend
python3 -m venv venv-test
source venv-test/bin/activate
pip install -r requirements.txt
python main.py --reload  # With hot reload
```

Backend runs on `http://localhost:8000` with API docs at `/docs`.

**Note**: `test-dev.sh` handles backend setup automatically at the correct path.

### Frontend Development

**Run frontend dev server only**:
```bash
cd frontend
npm run dev  # Vite on http://localhost:5173
```

**Build frontend only**:
```bash
cd frontend
npm run build  # Outputs to frontend/dist/
```

## Architecture

### Backend Structure

The backend (`frontend/src-tauri/backend/`) is modular FastAPI:

```
backend/
├── main.py                    # FastAPI app, routers, WebSocket endpoints
├── app/
│   ├── shared.py              # Global AppState singleton, broadcast_status()
│   ├── api/                   # FastAPI routers for each feature
│   │   ├── ansible_setup.py   # POST /api/ansible/initialize
│   │   ├── discovery.py       # Network discovery endpoints
│   │   ├── playbooks.py       # Playbook execution endpoints
│   │   ├── configuration.py   # Save/load inventory.yaml
│   │   └── ...
│   ├── services/
│   │   ├── ansible_environment.py  # AnsibleEnvironment class
│   │   └── ansible_executor.py     # AnsibleExecutor class
│   └── models/                # Pydantic models
```

**Key patterns**:
- `app_state` singleton in `shared.py` tracks installation status and WebSocket connections
- `broadcast_status()` pushes updates to all connected WebSocket clients
- `AnsibleEnvironment`: Manages Ansible venv at `~/.thinkube-installer/ansible-venv/` and clones thinkube repo to `/tmp/thinkube-installer-<uuid>/`
- `AnsibleExecutor`: Executes playbooks with standardized progress tracking

### Frontend Structure

Vue 3 app with router-based wizard flow:

```
frontend/src/
├── views/              # Wizard screens (Welcome, ServerDiscovery, Deploy, etc.)
├── components/         # Reusable components (PlaybookExecutorStream, InstallerHeader)
├── router/index.js     # Routes with deployment state guard
├── stores/             # Pinia stores (if present)
└── App.vue
```

**Deployment state persistence**:
- Frontend stores deployment progress in `localStorage` as `thinkube-deployment-state-v2`
- Router guard (`router/index.js:95-149`) redirects to `/deploy` if deployment is in progress
- Backend stores inventory at `~/.thinkube-installer/inventory.yaml` and state in `deployment-state.json`

### Tauri Integration

**Backend startup** (`frontend/src-tauri/src/lib.rs:18-160`):
- Development: Runs backend from `./backend` (relative to `frontend/src-tauri/`) with `venv-test`
- Production: Runs backend from bundled resources with `.venv`
- macOS: Creates venv on first launch (no post-install script support)
- Linux: Venv created by `deb-postinst.sh` during package installation

**Important**: In development mode, cargo runs from `frontend/src-tauri/` directory (due to `npm run dev` → `cd frontend && npm run tauri:dev`), so the backend path is just `./backend` relative to that location.

**Commands** (`lib.rs:10-15`):
- `get_config_flags()`: Returns `(SKIP_CONFIG, CLEAN_STATE)` env vars to frontend

### Ansible Deployment Flow

1. **Initialize Ansible environment** (`/api/ansible/initialize`):
   - Creates `~/.thinkube-installer/ansible-venv/` with Ansible 9.x
   - Clones `github.com/thinkube/thinkube` to `/tmp/thinkube-installer-<uuid>/`

2. **Configuration**:
   - Frontend collects server details, roles, network config, tokens
   - Saved to `~/.thinkube-installer/inventory.yaml`

3. **Deployment** (`/api/playbooks/execute`):
   - Backend executes playbooks from cloned thinkube repo
   - Progress streamed via WebSocket to frontend
   - Frontend displays real-time logs in `PlaybookExecutorStream.vue`

4. **Cleanup**:
   - Temporary thinkube repo in `/tmp` cleaned up after deployment

## Key Concepts

### Backend Path in Development vs Production

**Critical**: Backend location differs between dev and production:
- Dev: `frontend/src-tauri/backend/` with `venv-test`
- Prod: Bundled at `<resources>/backend/` with `.venv`

The Rust code (`lib.rs`) handles this with `#[cfg(debug_assertions)]`.

### WebSocket Communication

Backend broadcasts status via `/ws` and `/api/ws`:
```python
app_state.installation_status = {
    "phase": "running",
    "progress": 50,
    "current_task": "Installing k3s",
    "logs": [...],
    "errors": [...]
}
await broadcast_status(app_state.installation_status)
```

Frontend connects via WebSocket and updates UI reactively.

### Memory and OOM Considerations

The installer can be memory-intensive during builds. `test-dev.sh` checks available memory and warns if <2GB, with option to disable `systemd-oomd`.

## Testing

**No formal test suite exists yet**. Testing is done via:
1. Running `./test-dev.sh` and manually testing the wizard flow
2. Testing deployment to actual Ubuntu VMs/servers
3. Building packages and testing installation on clean systems

When adding tests in the future:
- Backend: Use `pytest` with FastAPI's `TestClient`
- Frontend: Use Vitest (Vite's test framework)

### Testing Production Builds

**IMPORTANT**: Do NOT run the binary directly from `target/release/thinkube-installer` - it will show a white screen because there's no backend venv.

**Correct way to test production builds**:

1. **Build the package**:
   ```bash
   ./scripts/build.sh
   ```

2. **Install the .deb package**:
   ```bash
   sudo dpkg -i installers/thinkube-installer_0.1.0_arm64.deb
   ```
   The post-install script will create the backend `.venv` and install dependencies.

3. **Run the installed app**:
   ```bash
   thinkube-installer  # From /usr/bin/thinkube-installer
   ```

4. **Check logs** if issues occur:
   ```bash
   # Backend logs (if started)
   journalctl --user -f | grep -i thinkube

   # Or check if backend process is running
   ps aux | grep "python3 main.py"
   ```

5. **Uninstall** when done testing:
   ```bash
   sudo dpkg -r thinkube-installer
   ```

**Why the white screen?**
The white screen occurs when:
- The backend isn't running (can't start due to errors)
- API calls to `/api/check-requirements` fail
- The frontend can't initialize without backend connectivity

**Common production backend issues**:
1. **No venv**: Post-install script didn't run or failed (check `journalctl` during install)
2. **Port 8000 in use**: Another backend instance running (kill with `pkill -f "python3 main.py"`)
3. **Python syntax errors**: Check with manual backend start: `cd /usr/lib/thinkube-installer/backend && .venv/bin/python3 main.py`

The backend venv is created by:
- **Linux**: Post-install script (`deb-postinst.sh`) during `dpkg -i`
- **macOS**: Rust code (`lib.rs`) on first launch (no post-install script support)

## Common Tasks

### Adding a New API Endpoint

1. Create router in `frontend/src-tauri/backend/app/api/new_feature.py`:
```python
from fastapi import APIRouter
router = APIRouter()

@router.get("/api/new-endpoint")
async def new_endpoint():
    return {"data": "value"}
```

2. Import and include router in `backend/main.py`:
```python
from app.api.new_feature import router as new_feature_router
app.include_router(new_feature_router)
```

### Adding a New Wizard Screen

1. Create Vue component in `frontend/src/views/NewScreen.vue`
2. Add route in `frontend/src/router/index.js`:
```javascript
import NewScreen from '../views/NewScreen.vue'

const routes = [
  // ...
  { path: '/new-screen', name: 'new-screen', component: NewScreen }
]
```
3. Add navigation buttons in appropriate views to link to new screen

### Modifying Ansible Environment Setup

Edit `frontend/src-tauri/backend/app/services/ansible_environment.py`:
- `initialize()`: Setup venv and clone repo
- `get_thinkube_path()`: Returns path to cloned thinkube repo
- Adjust `THINKUBE_BRANCH` env var to test different branches

## Important Files

- `frontend/src-tauri/tauri.conf.json`: Tauri config (window size, bundle settings, resources)
- `frontend/src-tauri/Cargo.toml`: Rust dependencies
- `frontend/package.json` and root `package.json`: Node.js dependencies and scripts
- `frontend/src-tauri/backend/requirements.txt`: Python dependencies
- `frontend/src-tauri/deb-postinst.sh`: Post-install script for .deb packages (creates venv)

## Gotchas

1. **Backend moved into Tauri**: The backend is NOT at project root `backend/`, it's at `frontend/src-tauri/backend/`. This was done to simplify bundling.

2. **Cargo working directory**: When modifying backend paths in `lib.rs`, remember that cargo runs from `frontend/src-tauri/` in development (not from project root). The backend is at `./backend` relative to that.

3. **Two venv names**: Development uses `venv-test`, production uses `.venv`. Don't confuse them.

4. **Tauri v2 requires Rust 1.82+**: The build script checks and upgrades if needed.

5. **Node.js version**: Development tested with Node 22.16.0 via nvm. `test-dev.sh` looks for it in `~/.nvm/` or `~/.local/share/nvm/`.

6. **WebKit environment variables**: `test-dev.sh` sets `WEBKIT_DISABLE_COMPOSITING_MODE=1` and `GDK_BACKEND=x11` for compatibility.

7. **Inventory persistence**: The `--skip-config` mode relies on `~/.thinkube-installer/inventory.yaml` existing. Use with `--clean-state` to reset deployment progress but keep configuration.

8. **Router guard redirects**: If you modify deployment state structure, update the router guard in `frontend/src/router/index.js` to handle it correctly.

9. **Product name uses dash**: The `productName` in `tauri.conf.json` is `thinkube-installer` (with dash) to avoid path issues. The window title uses "Thinkube Installer" (with space and capitalization) for display purposes only.
