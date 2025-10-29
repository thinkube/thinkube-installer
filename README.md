# thinkube Installer

Desktop application for deploying Thinkube to Ubuntu servers. The installer runs on Linux or macOS and deploys Thinkube to remote Ubuntu servers via Ansible.

## Architecture

- **Frontend**: Vue.js 3 + Tailwind CSS + DaisyUI
- **Backend**: FastAPI (Python) - runs locally, executes Ansible playbooks
- **Desktop Framework**: Tauri v2 (Rust + WebView)
- **Deployment**: Ansible playbooks cloned from github.com/thinkube/thinkube
- **Platforms**: Linux (.deb), macOS (.dmg)

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

## Building

### Quick Start

1. **Setup build environment** (one-time):
   ```bash
   ./scripts/setup-build-env.sh
   source $HOME/.cargo/env  # If Rust was just installed
   ```

2. **Build installer**:
   ```bash
   ./scripts/build.sh
   ```

3. **Find packages**:
   - Linux: `frontend/src-tauri/target/release/bundle/deb/`
   - macOS: `frontend/src-tauri/target/release/bundle/dmg/`

### Build Requirements

- **Node.js** 18+ (installed via nvm)
- **Rust + Cargo** (required for Tauri)
- **Python3** + pip + venv
- **Linux**: build-essential, libwebkit2gtk-4.1-dev, libssl-dev, etc.
- **macOS**: Xcode Command Line Tools

The setup script (`scripts/setup-build-env.sh`) installs all requirements automatically.

### Manual Build Steps

If you prefer manual setup:

```bash
# Install dependencies
npm install
cd frontend && npm install && cd ..

# Build
npm run build
```

Output: `frontend/src-tauri/target/release/bundle/`

## Development

### Quick Start

```bash
cd frontend
npm run tauri:dev
```

This will:
- Start Tauri in development mode (launches backend + frontend + desktop window)
- Backend runs from `frontend/src-tauri/backend/` with `venv-test`
- Frontend runs via Vite dev server

### Development Requirements

Same as build requirements, plus the backend test venv is created automatically.

### How It Works

**Development Mode**:
- Backend runs from `frontend/src-tauri/backend/` with `venv-test`
- Frontend runs on `http://localhost:5173` (Vite dev server)
- Tauri creates desktop window

**Production Mode** (built packages):
- Backend bundled in Tauri resources with `.venv`
- Frontend compiled to static files
- Linux: Backend venv created by post-install script
- macOS: Backend venv created on first launch

## Project Structure

```
thinkube-installer/
├── frontend/
│   ├── src/              # Vue.js components and views
│   ├── src-tauri/        # Tauri Rust code
│   │   ├── src/
│   │   │   ├── main.rs   # Entry point
│   │   │   └── lib.rs    # Backend startup logic
│   │   ├── tauri.conf.json
│   │   └── deb-postinst.sh  # .deb post-install script
│   └── package.json
├── backend/
│   ├── app/
│   │   ├── api/          # FastAPI route handlers
│   │   └── services/
│   │       ├── ansible_environment.py  # Ansible venv + repo cloning
│   │       └── ansible_executor.py     # Playbook execution
│   ├── main.py
│   └── requirements.txt
├── scripts/
│   ├── setup-build-env.sh   # Install build dependencies
│   └── build.sh             # Build installer for current platform
└── README.md
```

## Features

### First-Run Setup

The installer automatically sets up its environment on first run:

1. **Ansible Environment**:
   - Creates Python venv at `~/.thinkube-installer/ansible-venv/`
   - Installs Ansible 9.x + ansible-core 2.16.x
   - No sudo required

2. **Thinkube Repository**:
   - Clones github.com/thinkube/thinkube to `/tmp/thinkube-installer-<random>/`
   - Uses playbooks from there
   - Cleaned up after deployment

### Deployment Workflow

1. User launches installer
2. Configure deployment (inventory, domain, tokens)
3. Installer:
   - Initializes Ansible environment (if needed)
   - Clones thinkube repository to /tmp
   - Executes playbooks to deploy to remote Ubuntu servers
   - Shows real-time progress
4. Cleanup temporary files

### Environment Variables

**Build and Deployment**:

- `THINKUBE_BRANCH`: Clone specific branch/tag for testing (default: `main`)
  ```bash
  THINKUBE_BRANCH=feature/my-test thinkube-installer
  ```

**Runtime Behavior**:

- `TK_TEST=1`: Enable test mode with manual playbook control
  - Disables automatic 3-second advance between playbooks
  - Requires manual button click to proceed to next playbook
  - Adds "Test (18)" button to run test playbook
  - Adds "Rollback (19)" button to run rollback playbook
  ```bash
  TK_TEST=1 thinkube-installer
  ```

- `TK_SHELL_CONFIG=1`: Include shell configuration playbook in deployment
  - Adds `ansible/misc/00_setup_shells.yml` to the deployment queue
  - Configures bash/zsh environments on target servers
  ```bash
  TK_SHELL_CONFIG=1 thinkube-installer
  ```

- `TK_PROFILER=1`: Enable Ansible profiling and detailed logging
  - Enables `profile_tasks` and `timer` callbacks
  - Shows execution time for each task
  - Useful for performance debugging
  ```bash
  TK_PROFILER=1 thinkube-installer
  ```

**Combined Usage**:
```bash
# Example: Test mode with profiling
TK_TEST=1 TK_PROFILER=1 thinkube-installer

# Example: Full deployment with shell config
TK_SHELL_CONFIG=1 thinkube-installer
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

If you experience a white screen on systems with NVIDIA GPUs (e.g., DGX Spark, RTX workstations), this is due to a known WebKit/GTK issue with NVIDIA's DMA-BUF renderer.

**The installer includes an automatic workaround** (as of version 0.1.0+) that sets `WEBKIT_DISABLE_DMABUF_RENDERER=1`.

**Optional: For better performance**, you can install the NVIDIA GBM library:
```bash
sudo apt install libnvidia-egl-gbm1
```

This issue is tracked at: https://bugs.webkit.org/show_bug.cgi?id=254901

## License

Apache-2.0 - Same as the thinkube project
