# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Thinkube Installer is a desktop application for deploying Thinkube (Kubernetes homelab platform) to remote Ubuntu servers. It's a hybrid Tauri v2 application with:
- **Frontend**: Vue.js 3 + Tailwind CSS + DaisyUI (in `frontend/src/`)
- **Backend**: FastAPI (Python) bundled in `frontend/src-tauri/backend/`
- **Desktop Framework**: Tauri v2 (Rust in `frontend/src-tauri/src/`)
- **Deployment**: Ansible playbooks cloned from github.com/thinkube/thinkube

The installer runs locally (Linux/macOS) and remotely deploys to Ubuntu servers via SSH and Ansible.

# ⚠️ CRITICAL PATH RULES ⚠️

**BEFORE ANY EDIT/WRITE/GIT OPERATION - CHECK THIS:**

## Allowed Paths for Edits

✅ **ALLOWED** - These are source of truth:
- `/home/alexmc/thinkube/` - Ansible playbooks repository
- `/home/alexmc/thinkube-installer/` - Installer application code

❌ **FORBIDDEN** - Changes will be lost:
- `/tmp/thinkube-installer/` - TEMPORARY CLONE, never edit here
- `/tmp/*` - Any temporary files, never edit

## Pre-Commit Verification Checklist

**Before ANY `git commit` or `git push` command:**

1. ✅ Run `pwd` - Am I in `~/thinkube/` or `~/thinkube-installer/`?
2. ❌ If in `/tmp/*` → **STOP IMMEDIATELY**, cd to correct directory
3. ✅ If in `~/thinkube/` or `~/thinkube-installer/` → Proceed

**Always use full paths in git commands:**
```bash
# CORRECT - Explicit directory change
cd ~/thinkube && git add ... && git commit -m "..." && git push

# WRONG - Uses current directory
git commit -m "..."  # Where am I? Unknown!
```

## Development Commands

### Running in Development Mode

**Development approach**:
```bash
cd frontend
npm run tauri:dev
```
This starts Tauri in development mode, which:
- Starts the FastAPI backend from `frontend/src-tauri/backend/`
- Starts Vite dev server for the frontend
- Opens the desktop window
- Uses `venv-test` for backend Python dependencies

**Runtime environment variables**:
```bash
THINKUBE_BRANCH=feature-x npm run tauri:dev  # Clone specific thinkube branch
TK_TEST=1 npm run tauri:dev                   # Enable test mode
TK_SHELL_CONFIG=1 npm run tauri:dev           # Include shell configuration
TK_PROFILER=1 npm run tauri:dev               # Enable Ansible profiling
```

### Configuration Persistence

The installer automatically saves all configuration values to `~/.env` for reuse in future runs. This avoids re-entering tokens and configuration repeatedly.

**How it works**:
1. Enter your configuration (tokens, domain, cluster name, etc.) in the Configuration screen
2. When you click "Continue", all values are saved to `~/.env`
3. On next run, the Configuration screen automatically loads values from `~/.env`
4. Edit any field and save again - `~/.env` is updated

**Saved values**:
- `CLOUDFLARE_TOKEN` - Cloudflare API token
- `GITHUB_TOKEN` - GitHub personal access token
- `GITHUB_ORG` - GitHub organization name
- `ZEROTIER_API_TOKEN` - ZeroTier API token
- `ZEROTIER_NETWORK_ID` - ZeroTier network ID
- `CLUSTER_NAME` - Kubernetes cluster name
- `DOMAIN_NAME` - Domain name for services

**File location**: `~/.env` (read/write with 600 permissions)

**Manual setup** (optional):
You can also manually create `~/.env` with your values:
```bash
# ~/.env
CLOUDFLARE_TOKEN=your_token_here
ZEROTIER_API_TOKEN=your_token_here
ZEROTIER_NETWORK_ID=your_network_id_here
GITHUB_TOKEN=ghp_your_token_here
GITHUB_ORG=your_org
CLUSTER_NAME=thinkube
DOMAIN_NAME=my-homelab.com
```

**Default values**:
- `clusterName`: `"thinkube"` (can be changed)
- `domainName`: `""` (empty - you must enter your domain)

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

**Note**: `npm run tauri:dev` handles backend setup automatically at the correct path.

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

**Deployment approach**:
- Installer always starts fresh - no state persistence across restarts
- Deployment progress tracked in memory only during active session
- Configuration saved to `~/.env` for reuse
- Backend stores inventory at `~/.thinkube-installer/inventory.yaml`

### Tauri Integration

**Backend startup** (`frontend/src-tauri/src/lib.rs:18-160`):
- Development: Runs backend from `./backend` (relative to `frontend/src-tauri/`) with `venv-test`
- Production: Runs backend from bundled resources with `.venv`
- macOS: Creates venv on first launch (no post-install script support)
- Linux: Venv created by `deb-postinst.sh` during package installation

**Important**: In development mode, cargo runs from `frontend/src-tauri/` directory (due to `npm run dev` → `cd frontend && npm run tauri:dev`), so the backend path is just `./backend` relative to that location.

**Commands** (`lib.rs:10-15`):
- `get_config_flags()`: Returns `(TK_TEST, TK_SHELL_CONFIG)` runtime flags to frontend

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

The installer can be memory-intensive during builds.

## Testing

**No formal test suite exists yet**. Testing is done via:
1. Running `npm run tauri:dev` and manually testing the wizard flow
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

## Modifying Ansible Playbooks (Thinkube Deployment)

**CRITICAL WORKFLOW**: The installer uses playbooks from the separate `thinkube` repository. Here's the correct workflow:

### File Locations
- **Installer repo**: `~/thinkube-installer/` (this repo - installer code only)
- **Thinkube repo**: `~/thinkube/` (deployment playbooks, cloned from github.com/thinkube/thinkube)
- **Temporary clone**: `/tmp/thinkube-installer/` (backend clones thinkube here during deployment)

### Workflow for Modifying Playbooks

**NEVER edit files in `/tmp/thinkube-installer/`** - changes will be lost!

**Correct workflow:**

1. **Edit playbooks in `~/thinkube/`**:
   ```bash
   cd ~/thinkube
   # Edit ansible/40_thinkube/core/infrastructure/gpu_operator/10_deploy.yaml
   ```

2. **Commit and push to thinkube repo**:
   ```bash
   cd ~/thinkube
   git add ansible/40_thinkube/core/infrastructure/gpu_operator/10_deploy.yaml
   git commit -m "Fix GPU operator configuration"
   git push
   ```

3. **Pull changes into temporary clone** (if installer is already running):
   ```bash
   cd /tmp/thinkube-installer
   git pull
   ```

4. **Retry in installer UI** - click "Retry" button for the failed playbook

**Why this workflow:**
- The installer's backend clones `github.com/thinkube/thinkube` to `/tmp/` when deployment starts
- Changes to playbooks must be in the thinkube repo and pushed to GitHub
- During active deployment, manually pull into `/tmp/` to test changes immediately
- Don't edit `/tmp/` directly - changes won't persist

### Example: Fixing GPU Operator Playbook

```bash
# 1. Edit in ~/thinkube
cd ~/thinkube
# Make changes to ansible/40_thinkube/core/infrastructure/gpu_operator/10_deploy.yaml

# 2. Commit and push
git add ansible/40_thinkube/core/infrastructure/gpu_operator/10_deploy.yaml
git commit -m "Add driver.enabled=false for pre-installed drivers"
git push

# 3. Pull into running deployment
cd /tmp/thinkube-installer
git pull

# 4. Click "Retry" in installer UI
```

### Common Mistakes - LEARN FROM THESE

#### ❌ MISTAKE #1: Editing in /tmp/thinkube-installer

**What happened:**
```bash
cd /tmp/thinkube-installer
# Edit ansible/40_thinkube/core/seaweedfs/10_deploy.yaml
git commit -m "Fix SeaweedFS"
git push
```

**Why wrong:** `/tmp/thinkube-installer/` is a temporary clone. Changes pushed from here bypass the source of truth workflow.

**Correct approach:**
```bash
cd ~/thinkube  # Edit source of truth
# Edit ansible/40_thinkube/core/seaweedfs/10_deploy.yaml
git commit -m "Fix SeaweedFS"
git push
cd /tmp/thinkube-installer && git pull  # Update temp clone if needed
```

#### ❌ MISTAKE #2: Running git commands without checking pwd

**What happened:**
```bash
# Currently in /tmp/thinkube-installer, but don't realize it
git commit -m "Fix something"
# Just committed in wrong directory!
```

**Why wrong:** Git operates on current directory. If you're in `/tmp/`, you're editing the wrong repo.

**Correct approach:**
```bash
pwd  # Check where I am
# Output: /tmp/thinkube-installer
# STOP! Wrong directory!
cd ~/thinkube  # Go to correct directory
pwd  # Verify
# Output: /home/alexmc/thinkube
# NOW safe to commit
git commit -m "Fix something"
```

#### ❌ MISTAKE #3: Not pulling into /tmp after pushing from ~/thinkube

**What happened:**
```bash
cd ~/thinkube
# Edit and commit changes
git push
# Click "Retry" in installer UI
# Installer still uses old code from /tmp/thinkube-installer!
```

**Why wrong:** The installer runs from `/tmp/thinkube-installer/`, which doesn't automatically update.

**Correct approach:**
```bash
cd ~/thinkube
# Edit and commit changes
git push
cd /tmp/thinkube-installer && git pull  # Update temp clone
# NOW click "Retry" in installer UI
```

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

5. **Node.js version**: Development tested with Node 22.16.0 via nvm. Install from `~/.nvm/` or `~/.local/share/nvm/`.

6. **WebKit environment variables**: Set `WEBKIT_DISABLE_COMPOSITING_MODE=1` and `GDK_BACKEND=x11` for compatibility if running into graphics issues.

7. **Inventory persistence**: Configuration saved to `~/.env` for reuse. Inventory stored at `~/.thinkube-installer/inventory.yaml`.

8. **No deployment resume**: Installer always starts fresh. If deployment fails, user must restart from configuration.

9. **Product name uses dash**: The `productName` in `tauri.conf.json` is `thinkube-installer` (with dash) to avoid path issues. The window title uses "Thinkube Installer" (with space and capitalization) for display purposes only.

## Claude Code Plugins

**IMPORTANT**: This project uses Claude Code plugins for automated migration and refactoring tasks.

### What are Claude Code Plugins?

Plugins extend Claude Code with custom slash commands, skills (autonomous capabilities), agents, and hooks. They are defined in `.claude-plugin/` directories.

### Plugin Locations

**User-level plugins** (shared across all projects):
```
~/.claude/plugins/
```

**Project-level plugins** (specific to this repository):
```
.claude/plugins/
```

### Available Plugins

**microk8s-migration plugin** (at `~/.claude/plugins/microk8s-migration/`):
- **Purpose**: Migrate Ansible playbooks from MicroK8s to Canonical k8s-snap
- **Location**: User-level plugin (available across all Thinkube projects)
- **Commands**:
  - `/migrate-all` - Fix k8s-snap issues in remaining playbooks
  - `/migrate-file` - Migrate a single playbook file
  - `/verify-migration` - Verify migration was successful
- **Skills**:
  - `migrate-playbook` - Autonomous skill for transforming playbooks

**Key patterns the plugin fixes**:
1. `become: true` → `become: false` (k8s-snap uses user kubectl, not root)
2. Hardcoded paths `k8s kubectl` → `{{ kubectl_bin }}`
3. Hardcoded `kubeconfig: "/etc/kubernetes/admin.conf"` → inventory variable
4. Complex Jinja2 filters in `until:` → `kubectl wait --for=condition=Ready`
5. PostgreSQL `PGDATA` for ext4 storage compatibility

### How to Use Plugins

**List available commands**:
```bash
# Slash commands from plugins appear in /help
```

**Invoke plugin commands**:
```
/migrate-all
```

**Check if plugin is loaded**:
```bash
ls -la ~/.claude/plugins/microk8s-migration/
```

### When to Use the Migration Plugin

Use `/migrate-all` when:
- Fixing systematic kubectl/kubeconfig issues across multiple playbooks
- Migrating remaining playbooks after manual fixes
- Applying consistent patterns (become, hardcoded paths, filters)

**DO NOT** use when:
- Working on single-file issues (use manual Edit instead)
- Plugin is not loaded (check `~/.claude/plugins/` first)

### Plugin Structure

```
~/.claude/plugins/microk8s-migration/
├── .claude-plugin/
│   └── plugin.json          # Plugin metadata
├── commands/                # Slash commands
│   ├── migrate-all.md
│   ├── migrate-file.md
│   └── verify-migration.md
└── skills/                  # Autonomous skills
    └── migrate-playbook.md
```

### Debugging Plugin Issues

If `/migrate-all` shows "Unknown slash command":
1. **Check plugin exists**: `ls ~/.claude/plugins/microk8s-migration/`
2. **Verify plugin.json**: `cat ~/.claude/plugins/microk8s-migration/.claude-plugin/plugin.json`
3. **Restart Claude Code**: Plugin changes require restart
4. **Check command files exist**: `ls ~/.claude/plugins/microk8s-migration/commands/`

### Creating New Plugins

See Claude Code documentation: https://docs.claude.com/en/docs/claude-code/plugins

**Do NOT forget**:
- Plugins are in `~/.claude/plugins/` (user-level) or `.claude/plugins/` (project-level)
- Commands are markdown files in `commands/` subdirectory
- Skills are markdown files in `skills/` subdirectory
- Always check `~/.claude/plugins/` first when asked about plugins
