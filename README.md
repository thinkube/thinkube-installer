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
sudo dpkg -i thinkube-installer_1.0.0_amd64.deb
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
./test-dev.sh
```

This will:
- Check dependencies
- Create backend venv if needed
- Start Tauri in development mode (launches backend + frontend)

### Development Requirements

Same as build requirements, plus the backend test venv is created automatically.

### How It Works

**Development Mode**:
- Backend runs from `backend/` with `venv-test`
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
├── test-dev.sh              # Run in development mode
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

- `THINKUBE_BRANCH`: Clone specific branch/tag for testing (default: `main`)
  ```bash
  THINKUBE_BRANCH=feature/my-test ./test-dev.sh
  ```

- `SKIP_CONFIG`: Skip configuration screens, use existing inventory
- `CLEAN_STATE`: Clean deployment state but preserve inventory

## Platform Support

| Platform | Package | Post-Install | First Launch |
|----------|---------|--------------|--------------|
| Linux (.deb) | ✅ | Backend venv created | Ready immediately |
| macOS (.dmg) | ✅ | Not supported | Creates backend venv (~30-60s) |
| Windows | ❌ | Not supported | Use Linux VM or native Linux/macOS |

**Note**: Windows users should run the installer in a Linux VM (VirtualBox) or use a native Linux/macOS machine.

## License

Apache-2.0 - Same as the thinkube project
