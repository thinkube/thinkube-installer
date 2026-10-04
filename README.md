# thinkube-installer

A desktop application that deploys Thinkube to Ubuntu servers. It runs on Linux or macOS and deploys to the servers over SSH with Ansible.

## What it does

- Walks the operator through one page per step (`frontend/src/pages/`): requirements, sudo password, SSH setup, server discovery, hardware detection, GPU driver check, role assignment, network and overlay network setup, configuration, review, deployment and completion.
- Sets up its own Ansible environment on first run, with no sudo (see [First-Run Setup](#first-run-setup)).
- Clones the [thinkube](https://github.com/thinkube/thinkube) playbook repository and runs its playbooks against the servers, one after another, with the output shown live.
- Offers Retry and Rollback when a playbook fails.

## How it reaches a user

This is the one Thinkube repository a person downloads and runs. It is built as a `.deb` for Linux and a `.dmg` for macOS. Everything else in Thinkube reaches the cluster through the playbooks it runs.

## Installation

**Linux (Ubuntu, Debian)**:
```bash
sudo dpkg -i thinkube-installer_0.1.0_amd64.deb
thinkube-installer
```

**macOS (Apple Silicon)**:
```bash
# Download .dmg, open and drag to Applications
open thinkube-installer.dmg
```

## First-Run Setup

The installer sets up its environment on first run:

1. **Ansible Environment**:
   - Creates a Python venv at `~/.thinkube-installer/ansible-venv/`
   - Installs Ansible 9.x + ansible-core 2.16.x
   - No sudo required

2. **Thinkube Repository**:
   - Clones github.com/thinkube/thinkube (shallow, one branch) to `/tmp/thinkube-installer-<uid>/`
   - Runs the playbooks from there
   - Removes any earlier clone first, so each run uses fresh code

## Deployment Workflow

1. The operator launches the installer
2. The operator configures the deployment (servers, roles, network, domain, tokens)
3. The installer:
   - Initializes the Ansible environment (if needed)
   - Clones the thinkube repository to `/tmp`
   - Runs the playbooks against the remote Ubuntu servers
   - Shows progress live

## Environment Variables

**Build and Deployment**:

- `THINKUBE_BRANCH`: Clone a specific branch or tag of thinkube for testing (default: `main`)
  ```bash
  THINKUBE_BRANCH=feature/my-test thinkube-installer
  ```

- `THINKUBE_REPO_URL`: Clone thinkube from another URL, such as a fork (default: `https://github.com/thinkube/thinkube.git`). See [CONTRIBUTING.md](CONTRIBUTING.md) for the fork-and-test workflow.

`scripts/build.sh --branch <name>` and `--repo-url <url>` build these defaults into the package, for launches from the desktop menu where shell variables are not set. A variable set in the shell wins over the built-in default.

**Runtime Behavior**:

- `TK_PROFILER=1`: Enable Ansible profiling and detailed logging
  - Enables the `profile_tasks` and `timer` callbacks
  - Shows execution time for each task
  - Writes the logs the installer's log view reads; without it, no logs are created
  ```bash
  TK_PROFILER=1 thinkube-installer
  ```

## Platform Support

| Platform | Package | Post-Install | First Launch |
|----------|---------|--------------|--------------|
| Linux (.deb) | ✅ | Backend venv created | Ready immediately |
| macOS (.dmg) | ✅ | Not supported | Creates backend venv (~30-60s) |
| Windows | ❌ | Not supported | Use Linux VM or native Linux/macOS |

**Note**: Windows users should run the installer in a Linux VM (VirtualBox) or use a native Linux/macOS machine.

## Troubleshooting

### White Screen on NVIDIA GPU Systems

On systems with NVIDIA GPUs (e.g., DGX Spark, RTX workstations) the window can stay white. This is a known WebKit/GTK issue with NVIDIA's DMA-BUF renderer.

The installer sets `WEBKIT_DISABLE_DMABUF_RENDERER=1` before the window opens (`frontend/src-tauri/src/main.rs`).

**Optional: for better performance**, install the NVIDIA GBM library:
```bash
sudo apt install libnvidia-egl-gbm1
```

This issue is tracked at: https://bugs.webkit.org/show_bug.cgi?id=254901

## Architecture

- **Frontend**: React 19 + TypeScript, built with Vite, styled with Tailwind CSS 4 and the thinkube-style components
- **Backend**: FastAPI (Python) - runs locally, executes Ansible playbooks
- **Desktop Framework**: Tauri v2 (Rust + WebView)
- **Deployment**: Ansible playbooks cloned from github.com/thinkube/thinkube
- **Platforms**: Linux (.deb), macOS (.dmg)

## Project Structure

```
thinkube-installer/
├── frontend/
│   ├── src/              # React app: one page per installer step in pages/
│   ├── src-tauri/        # Tauri Rust code
│   │   ├── src/
│   │   │   ├── main.rs   # Entry point
│   │   │   └── lib.rs    # Backend startup logic
│   │   ├── backend/      # FastAPI backend, started by Tauri
│   │   │   ├── app/
│   │   │   │   ├── api/          # FastAPI route handlers
│   │   │   │   └── services/
│   │   │   │       ├── ansible_environment.py  # Ansible venv + repo cloning
│   │   │   │       └── ansible_executor.py     # Playbook execution
│   │   │   ├── main.py
│   │   │   └── requirements.txt
│   │   ├── tauri.conf.json
│   │   └── deb-postinst.sh  # .deb post-install script
│   └── package.json
├── scripts/
│   ├── setup-build-env.sh   # Install build dependencies
│   └── build.sh             # Build installer for current platform
└── README.md
```

## Working on it

### Building

1. **Set up the build environment** (one time):
   ```bash
   ./scripts/setup-build-env.sh
   source $HOME/.cargo/env  # If Rust was just installed
   ```

2. **Build the installer**:
   ```bash
   ./scripts/build.sh
   ```

3. **Find the packages**:
   - Linux: `frontend/src-tauri/target/release/bundle/deb/`
   - macOS: `frontend/src-tauri/target/release/bundle/dmg/`

### Build Requirements

- **Node.js** 18+ (installed via nvm)
- **Rust + Cargo** (required for Tauri)
- **Python3** + pip + venv
- **Linux**: build-essential, libwebkit2gtk-4.1-dev, libssl-dev, etc.
- **macOS**: Xcode Command Line Tools

The setup script (`scripts/setup-build-env.sh`) installs all requirements.

### Manual Build Steps

```bash
# Install dependencies
npm install
cd frontend && npm install && cd ..

# Build
npm run build
```

Output: `frontend/src-tauri/target/release/bundle/`

### Development

```bash
cd frontend
npm run tauri:dev
```

This starts Tauri in development mode: the backend, the frontend and the desktop window. The backend test venv is created automatically.

**Development Mode**:
- Backend runs from `frontend/src-tauri/backend/` with `venv-test`
- Frontend runs on `http://localhost:5173` (Vite dev server)
- Tauri creates the desktop window

**Production Mode** (built packages):
- Backend bundled in Tauri resources with `.venv`
- Frontend compiled to static files
- Linux: backend venv created by the post-install script
- macOS: backend venv created on first launch

To test changes to thinkube or to the installer against a fork, see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Apache-2.0 - Same as the thinkube project
