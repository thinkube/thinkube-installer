# Installer Flow Documentation

**Purpose:** Complete documentation of how the Thinkube installer flows through screens, manages credentials, and generates inventories.

**Last Updated:** 2025-10-24

---

## Table of Contents

1. [Screen Flow Overview](#screen-flow-overview)
2. [Credential Management](#credential-management)
3. [Inventory Generation](#inventory-generation)
4. [SSH Verification vs SSH Setup](#ssh-verification-vs-ssh-setup)
5. [Single-Server vs Multi-Server Scenarios](#single-server-vs-multi-server-scenarios)
6. [Known Issues](#known-issues)

---

## Screen Flow Overview

The installer follows this sequential flow:

```
1. Welcome
   └─> router: /
   └─> component: frontend/src/views/Welcome.vue
   └─> purpose: Introduction and start point

2. Requirements
   └─> router: /requirements
   └─> component: frontend/src/views/Requirements.vue
   └─> purpose: Check system requirements (Ansible, Python, etc.)

3. Sudo Password
   └─> router: /sudo-password
   └─> component: frontend/src/views/SudoPassword.vue
   └─> purpose: Collect and verify sudo password
   └─> stores: sessionStorage.sudoPassword, sessionStorage.systemUsername

4. Server Discovery
   └─> router: /server-discovery
   └─> component: frontend/src/views/ServerDiscovery.vue
   └─> purpose: Scan network (local or ZeroTier) for Ubuntu servers
   └─> stores: sessionStorage.discoveredServers, sessionStorage.networkCIDR

5. SSH Setup ⚠️ USES MINIMAL INVENTORY
   └─> router: /ssh-setup
   └─> component: frontend/src/views/SSHSetup.vue
   └─> purpose: Configure SSH keys between servers
   └─> inventory: minimalInventory.js (basic ansible_host + ansible_user only)
   └─> playbook: ansible/00_initial_setup/10_setup_ssh_keys.yaml

6. Hardware Detection (includes GPU driver detection)
   └─> router: /hardware-detection
   └─> component: frontend/src/views/HardwareDetection.vue
   └─> purpose: Detect CPUs, GPUs, memory, storage, and NVIDIA driver versions on each server
   └─> bash script: Collects hardware info via single SSH call per server
   └─> driver detection:
       - Detects NVIDIA driver version via nvidia-smi
       - Classifies driver status: compatible (>=580.x), old (<580.x), missing, none
       - Shows driver badges and summary on UI
   └─> user decisions (if old drivers detected):
       - "Stop Installation": Exit to manually upgrade drivers
       - "Continue Without GPU Nodes": Proceed, exclude servers with old drivers from GPU workloads
   └─> stores: sessionStorage.serverHardware (includes driver_status field)

7. Role Assignment
   └─> router: /role-assignment
   └─> component: frontend/src/views/RoleAssignment.vue
   └─> purpose: Assign roles (controller, worker, storage) to servers

8. Configuration
   └─> router: /configuration
   └─> component: frontend/src/views/Configuration.vue
   └─> purpose: Configure cluster name, domain, admin credentials
   └─> stores: localStorage.thinkube-config, ~/.env (tokens)

9. Network Configuration
   └─> router: /network-configuration
   └─> component: frontend/src/views/NetworkConfiguration.vue
   └─> purpose: Configure network mode, ZeroTier, MetalLB IP pool

10. Review
    └─> router: /review
    └─> component: frontend/src/views/Review.vue
    └─> purpose: Review all configuration before deployment

11. Deploy ⚠️ USES FULL INVENTORY
    └─> router: /deploy
    └─> component: frontend/src/views/Deploy.vue
    └─> purpose: Execute all deployment playbooks
    └─> inventory: inventoryGenerator.js (complete inventory with roles, network, tokens, GPU config)
    └─> stores: ~/.thinkube-installer/inventory.yaml (persisted to disk)

12. Complete
    └─> router: /complete
    └─> component: frontend/src/views/Complete.vue
    └─> purpose: Show completion status and next steps
```

---

## Credential Management

### Password Flow

```
┌─────────────────────────────────────────────────────────────┐
│ 1. SudoPassword Screen (step 3)                             │
│    - User enters password                                   │
│    - Backend verifies with: POST /api/verify-sudo          │
│    - Stores: sessionStorage.sudoPassword                    │
│    - Stores: sessionStorage.systemUsername                  │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ 2. Server Discovery (step 4)                                │
│    - Frontend passes password to backend                    │
│    - Backend: POST /api/discover-servers                    │
│      - username: sessionStorage.systemUsername              │
│      - password: sessionStorage.sudoPassword                │
│    - Backend calls verify_ssh_connectivity()                │
│      - For LOCAL IPs: Skips SSH, uses verify_local_server() │
│      - For REMOTE IPs: Uses sshpass to test SSH             │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ 3. SSH Setup Playbook (step 5)                              │
│    - Frontend passes password via PlaybookExecutorStream    │
│    - Component: frontend/src/components/PlaybookExecutorStream.vue:267-277
│    - Parameters sent:                                       │
│      environment:                                           │
│        ANSIBLE_BECOME_PASSWORD: sudoPassword                │
│        ANSIBLE_SSH_PASSWORD: sudoPassword                   │
│      extra_vars:                                            │
│        ansible_user: currentUser                            │
│        ansible_ssh_pass: sudoPassword                       │
│        ansible_become_pass: sudoPassword                    │
│    - Backend receives and sets environment variables        │
│    - Ansible uses ANSIBLE_SSH_PASSWORD for SSH auth         │
└─────────────────────────────────────────────────────────────┘
```

### Key Storage Locations

| What | Where | When Created | When Used |
|------|-------|--------------|-----------|
| `sessionStorage.sudoPassword` | Browser session | Step 3 (SudoPassword) | Steps 4, 5, 11 |
| `sessionStorage.systemUsername` | Browser session | Step 3 (SudoPassword) | Steps 4, 5, 11 |
| `sessionStorage.discoveredServers` | Browser session | Step 4 (ServerDiscovery) | Steps 5, 6, 7 |
| `sessionStorage.networkCIDR` | Browser session | Step 4 (ServerDiscovery) | Step 11 |
| `~/.thinkube-installer/inventory.yaml` | Disk | Step 11 (Deploy) | Step 11 playbooks |

---

## Inventory Generation

### Two Different Inventories

The installer uses **TWO DIFFERENT** inventory generators at different stages:

#### 1. Minimal Inventory (SSH Setup - Step 5)

**File:** `frontend/src/utils/minimalInventory.js`

**When Used:** SSH setup playbook execution (step 5)

**Purpose:** Minimal inventory with just baremetal hosts for SSH key setup

**Structure:**
```yaml
---
all:
  vars:
    ansible_become_pass: "{{ lookup('env', 'ANSIBLE_BECOME_PASSWORD') }}"
  children:
    baremetal:
      hosts:
        vilanova3:
          ansible_host: 192.168.191.50
          ansible_user: alexmc
```

**Code Location:** `frontend/src/components/PlaybookExecutorStream.vue:262-266`
```javascript
if (props.playbookName === 'setup-ssh-keys' || props.playbookName === 'test-ssh-connectivity') {
  const { generateMinimalInventory, minimalInventoryToYAML } = await import('../utils/minimalInventory.js')
  const minimalInventory = generateMinimalInventory()
  inventoryYAML = minimalInventoryToYAML(minimalInventory)
}
```

**Data Source:**
- `sessionStorage.discoveredServers` - from server discovery
- `sessionStorage.systemUsername` - from sudo password verification

**Key Features:**
- Only includes `ansible_host` and `ansible_user`
- No roles, no network config, no tokens
- Used ONLY for SSH setup tasks

#### 2. Full Inventory (Deployment - Step 11)

**File:** `frontend/src/utils/inventoryGenerator.js`

**When Used:** All deployment playbooks (step 11)

**Purpose:** Complete inventory with all roles, network configuration, tokens, and services

**Structure:**
```yaml
---
all:
  vars:
    cluster_name: thinkube
    cluster_domain: thinkube.local
    ansible_become_pass: "{{ lookup('env', 'ANSIBLE_BECOME_PASSWORD') }}"
  children:
    baremetal:
      hosts:
        vilanova3:
          ansible_host: 192.168.191.50  # or zerotierIP based on networkMode
          ansible_user: alexmc
          roles:
            - microk8s_controller
            - microk8s_worker
          # ... many more fields ...
```

**Code Location:** `frontend/src/components/PlaybookExecutorStream.vue:267-271`
```javascript
else {
  // Use full inventory for other playbooks
  const { generateDynamicInventory, inventoryToYAML } = await import('../utils/inventoryGenerator.js')
  const dynamicInventory = generateDynamicInventory()
  inventoryYAML = inventoryToYAML(dynamicInventory)
}
```

**Data Source:**
- All data from configuration screens (steps 4-10)
- Roles, hardware info, network config, tokens
- Saved to disk: `~/.thinkube-installer/inventory.yaml`

**Key Features:**
- Includes all host variables
- Includes all group variables
- Includes roles, hardware, network config
- Includes all tokens (ZeroTier, Cloudflare, GitHub)
- Persisted to disk for re-use

---

## SSH Verification vs SSH Setup

### Critical Distinction

There are **TWO DIFFERENT** SSH operations with **DIFFERENT BEHAVIORS**:

#### 1. SSH Verification (Server Discovery - Step 4)

**Purpose:** Verify that servers are reachable and Ubuntu

**Backend:** `backend/app/core/discovery.py:verify_ssh_connectivity()`

**Behavior:**
```python
# Check if this is the local machine
local_ips = await get_local_ip_addresses()
is_local = ip_address in local_ips

if is_local:
    # ⚠️ SKIPS SSH ENTIRELY FOR LOCAL IPS
    logger.info(f"Detected local server {ip_address}, using direct verification")
    return await verify_local_server()  # Runs hostname/lsb_release locally
else:
    # Uses sshpass for remote servers
    result = await asyncio.create_subprocess_exec(
        'sshpass', '-p', password,
        'ssh', '-o', 'ConnectTimeout=5',
        '-o', 'StrictHostKeyChecking=no',
        f'{username}@{ip_address}', 'echo "SSH OK"; lsb_release -d'
    )
```

**Key Point:** If the IP is detected as local (like ZeroTier IP on same machine), SSH is **NOT TESTED**. The backend runs commands locally instead.

#### 2. SSH Key Setup (SSH Setup - Step 5)

**Purpose:** Configure SSH keys between all servers for passwordless auth

**Backend:** Ansible playbook via `backend/app/api/playbook_stream.py`

**Behavior:**
```yaml
# From ansible/00_initial_setup/10_setup_ssh_keys.yaml:84-86
vars:
  ansible_ssh_pass: "{{ lookup('env', 'ANSIBLE_SSH_PASSWORD') }}"
  ansible_ssh_common_args: "-o PubkeyAuthentication=no -o PreferredAuthentications=password -o IdentityAgent=none -o IdentitiesOnly=yes"
```

**Key Point:** Ansible **ALWAYS USES SSH**, even for localhost. There's no "skip SSH for local" logic in Ansible.

---

## Single-Server vs Multi-Server Scenarios

### Multi-Server Setup (Normal Case)

```
┌──────────────┐         SSH over network         ┌──────────────┐
│ Controller   │ ──────────────────────────────> │ Worker 1     │
│ (installer)  │                                   │ (remote)     │
└──────────────┘                                   └──────────────┘
       │
       │         SSH over network
       └──────────────────────────────────> ┌──────────────┐
                                              │ Worker 2     │
                                              │ (remote)     │
                                              └──────────────┘
```

**Behavior:**
- Server discovery uses sshpass to verify each remote server
- Password is tested during discovery
- SSH setup configures keys for passwordless access
- All SSH connections are over network

### Single-Server Setup (Current Case)

```
┌──────────────────────────────────────┐
│ Controller + Worker (same machine)   │
│                                      │
│  ┌──────────┐    SSH to self        │
│  │ Installer│ ───────────────────┐  │
│  └──────────┘                    ↓  │
│       ↑                    ┌─────────┴──┐
│       │                    │ ZeroTier   │
│       │                    │ IP:        │
│       │                    │ 192.168.   │
│       │                    │ 191.50     │
│       └────────────────────┴────────────┘
└──────────────────────────────────────┘
```

**Behavior:**
- Server discovery detects `192.168.191.50` as LOCAL IP
- SSH verification is **SKIPPED** - uses `verify_local_server()` instead
- Password is **NEVER TESTED VIA SSH** during discovery
- SSH setup playbook tries to SSH to `192.168.191.50` via ZeroTier
- This is the **FIRST TIME** SSH password is actually tested
- May fail if:
  - SSH server config doesn't allow password auth
  - Old SSH keys exist in authorized_keys
  - SSH to localhost over ZeroTier has routing issues

---

## Known Issues

### Issue 1: SSH Password Not Tested in Single-Server Setup

**Location:** `backend/app/core/discovery.py:234-256`

**Problem:**
- In single-server setups, the ZeroTier IP (e.g., `192.168.191.50`) is detected as local
- `verify_ssh_connectivity()` calls `verify_local_server()` which skips SSH entirely
- The sudo password is verified, but SSH password authentication is never tested
- Later, SSH setup playbook tries to actually SSH and may fail with wrong password

**Impact:**
- User thinks SSH is verified because discovery succeeds
- SSH setup playbook fails with "Permission denied (publickey,password)"
- Error is confusing because password worked during sudo verification

**Current Workarounds:**
- Added SSH options to force password auth: `-o PubkeyAuthentication=no`
- Added task to remove old keys: `sed -i '/thinkube_cluster/d' ~/.ssh/authorized_keys`
- But these don't address root cause: password was never tested for SSH

**Proper Fix (TODO):**
- Option A: Don't skip SSH in single-server setup - always test actual SSH connection
- Option B: Use `ansible_connection: local` for single-server baremetal hosts
- Option C: In discovery, check if we're connecting to self AND force SSH test anyway

### Issue 2: Two Inventory Generators Can Diverge

**Problem:**
- `minimalInventory.js` and `inventoryGenerator.js` can have different logic
- If they diverge (e.g., different hostname handling), SSH setup might succeed but deployment might fail
- Or vice versa

**Impact:**
- Hard to debug when SSH setup works but deployment fails (or opposite)
- Developers might fix one inventory generator but forget the other

**Proper Fix (TODO):**
- Extract common inventory generation logic into shared module
- Both minimal and full should use same core logic with different var sets
- Or: Generate minimal inventory as subset of full inventory

### Issue 3: Chicken-and-Egg with Old SSH Keys

**Location:** `ansible/00_initial_setup/10_setup_ssh_keys.yaml:96-103`

**Problem:**
- Added task to remove old SSH keys from previous installations
- But this task uses `ansible.builtin.raw` which requires SSH connection
- If old keys block password auth, can't connect to remove the keys

**Current State:**
- Task exists but creates chicken-and-egg problem
- Manual removal required: `sed -i '/thinkube_cluster/d' ~/.ssh/authorized_keys`

**Proper Fix (TODO):**
- Option A: Run removal task with delegate_to localhost + direct file access if single-server
- Option B: Check for single-server and use local file operations
- Option C: Make SSH server accept both key AND password simultaneously

---

## Debugging Tips

### Check What Inventory Was Used

**For SSH Setup:**
```bash
# Inventory is written to /tmp/thinkube-installer/inventory/inventory.yaml
cat /tmp/thinkube-installer/inventory/inventory.yaml
```

**For Deployment:**
```bash
# Inventory is saved to permanent location
cat ~/.thinkube-installer/inventory.yaml
```

### Check SSH Connectivity Manually

**Test password auth to yourself:**
```bash
# Disable all keys, force password only
ssh -o PubkeyAuthentication=no \
    -o PreferredAuthentications=password \
    -o IdentityAgent=none \
    -o IdentitiesOnly=yes \
    alexmc@192.168.191.50 'echo OK'
```

**Check if IP is detected as local:**
```bash
# See what IPs are detected as local
curl http://localhost:8000/api/debug-local-ips
```

### Check SSH Server Logs

```bash
# See actual SSH authentication attempts
sudo journalctl -u ssh -n 50 --no-pager
```

### Trace Password Flow

```bash
# Backend logs show if password is being passed correctly
# Check for "ANSIBLE_SSH_PASSWORD" in environment
journalctl --user -f | grep -i password
```

---

## References

### Key Files

**Inventory Generation:**
- `frontend/src/utils/minimalInventory.js` - SSH setup inventory
- `frontend/src/utils/inventoryGenerator.js` - Deployment inventory

**Credential Flow:**
- `frontend/src/views/SudoPassword.vue:120-195` - Password collection and verification
- `frontend/src/views/ServerDiscovery.vue:275-353` - Server discovery with password
- `frontend/src/views/SSHSetup.vue:252-278` - SSH setup with password
- `frontend/src/components/PlaybookExecutorStream.vue:219-383` - Playbook execution with credentials

**Backend Discovery:**
- `backend/app/api/discovery.py:485-503` - Server discovery endpoint
- `backend/app/api/discovery.py:528-548` - SSH verification endpoint
- `backend/app/core/discovery.py:234-330` - SSH connectivity verification
- `backend/app/core/discovery.py:182-230` - Local server verification

**Backend Playbook Execution:**
- `backend/app/api/playbook_stream.py:26-383` - WebSocket playbook streaming
- `backend/app/api/playbook_stream.py:118-151` - Environment variable handling

**Ansible Playbooks:**
- `ansible/00_initial_setup/10_setup_ssh_keys.yaml` - SSH key setup playbook

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-10-24 | Initial documentation based on code research |

