# Kubeadm Migration Plan

Migrate Thinkube's Kubernetes layer from Canonical k8s-snap to upstream
kubeadm. Target release: **0.1.0**. Replaces snap-based delivery with
apt-installed kubeadm + containerd, owned end-to-end by Thinkube.

This plan is fact-checked against the current source tree. File paths
are absolute against the local working copies under `/home/thinkube/`.
Line numbers reference the state of `main` at the moment this plan was
written.

## 1. Goal and non-goals

### Goal

Replace k8s-snap with kubeadm as the cluster bootstrap mechanism, so
that Thinkube becomes an opinionated Kubernetes distribution for the
AI/ML homelab + workstation niche, owning its full vertical stack
(containerd, Kubernetes, CNI, CSI, ingress, addons), with predictable
version pinning and no per-architecture surprises.

### Non-goals

- Multi-cluster management (Thinkube remains single-cluster per install).
- In-place upgrade from a deployed k8s-snap install. Alpha-0 contract is
  destroy-and-rebuild between Thinkube minors; an upgrade playbook lands
  in a later milestone (see section 11).
- Changing the CSI driver. We keep **OpenEBS Rawfile CSI**
  (`rawfile.csi.openebs.io`) — currently bundled by k8s-snap, will be
  installed standalone under kubeadm — to keep the `k8s-hostpath`
  StorageClass alias and all downstream consumers untouched.
- Removing Docker from the host. On DGX Spark, Docker stays so NVIDIA
  NIM and educational workflows keep working; kubeadm's containerd
  runs on a separate socket/dataroot from Docker's containerd.
- Removing JuiceFS-over-SeaweedFS for RWX. That story is unchanged.

## 2. Anchoring decisions (settled)

- **Docker coexistence — Option A**: keep Docker installed on DGX Spark
  using its own containerd at `/run/docker/containerd/containerd.sock`
  with dataroot `/var/lib/docker/`. Install `containerd.io` separately
  for kubelet at the standard socket `/run/containerd/containerd.sock`
  with dataroot `/var/lib/containerd/`. Two daemons, two sockets, two
  data directories, zero conflict. Docker does not read
  `/etc/containerd/config.toml`.

- **CSI — keep OpenEBS Rawfile CSI**: install the upstream
  `openebs-rawfile-localpv` chart explicitly. Pin StorageClass name
  `csi-rawfile-default` so the existing `k8s-hostpath` alias keeps
  resolving. No downstream consumer of `k8s-hostpath` needs to change.

These two decisions deliberately minimise migration blast radius. Both
can be revisited post-0.1.0 without breaking the migration's contract.

## 3. Architectural diff (k8s-snap → kubeadm)

### What disappears (pure deletion)

| Current file:line | Disappears because |
|---|---|
| `ansible/40_thinkube/core/infrastructure/k8s/10_install_k8s.yaml:392-423` (create `00-k8s-runc.toml`) | We own `/etc/containerd/config.toml` directly. No broken import path (canonical/k8s-snap#1991) to work around. |
| `ansible/40_thinkube/core/infrastructure/k8s/20_join_workers.yaml:631-655` (same `00-k8s-runc.toml` on workers) | Same reason. |
| `ansible/40_thinkube/core/infrastructure/k8s/10_install_k8s.yaml:333` and `20_join_workers.yaml:597` (`containerd-base-dir: /var/lib/k8s-containerd`) | Standard `/var/lib/containerd/` for kubelet; Docker untouched on its own dataroot. |
| `ansible/40_thinkube/core/infrastructure/k8s/10_install_k8s.yaml:511-560` (patch rawfile-csi DaemonSet hostPath/mountPath) | OpenEBS chart installs with the standard `/var/lib/kubelet` paths. No DaemonSet patching needed. |
| `ansible/40_thinkube/core/infrastructure/k8s/20_join_workers.yaml:657-689` (`--root-dir` worker patch) | k8s-snap-specific bug where control-plane and worker kubelets defaulted to different root-dirs. kubeadm defaults consistently to `/var/lib/kubelet`. |
| `ansible/40_thinkube/core/infrastructure/k8s/10_install_k8s.yaml:324-328` (`snap refresh --hold k8s`) | Replaced by `apt-mark hold kubeadm kubelet kubectl containerd.io`. |
| `ansible/40_thinkube/core/infrastructure/gpu_operator/10_deploy.yaml:438-441` (`snap restart k8s.containerd`) | Replaced by `systemctl restart containerd`. |
| `ansible/40_thinkube/core/infrastructure/dns-server/10_deploy.yaml:197` (`/snap/k8s/current/bin/ctr --address /var/lib/k8s-containerd/...`) | Replaced by `/usr/bin/ctr` from the `containerd.io` package at the standard socket. |
| `ansible/40_thinkube/core/infrastructure/k8s/10_install_k8s.yaml:367-373` (`k8s status --wait-ready` polling) | Replaced by `kubectl wait` / `kubectl get nodes` against the kubeadm-managed cluster. |
| `ansible/40_thinkube/core/infrastructure/k8s/11_configure_kubelet_args.yaml` (entire file) | Kubelet args move into the `KubeletConfiguration` document embedded in `kubeadm-config.yaml`. Done once at init/join time. No second playbook required. |
| `inventory/group_vars/k8s.yml` — `k8s_snap_revisions` per-arch lookup table (currently inline in playbooks at `10_install_k8s.yaml:40-42` and `20_join_workers.yaml:34-36`) | Single arch-agnostic K8s version. apt resolves the arch-correct binary. |

### What changes shape (semantics preserved, mechanism rewritten)

| Current behaviour | New behaviour under kubeadm |
|---|---|
| `10_install_k8s.yaml:459-479` post-install patch of `cilium-config` ConfigMap to exclude ZeroTier (`devices: "k8s0 en+ eth+ wl+ bond+"`) plus DaemonSet rollout restart | `--set devices=...` (or `values.yaml`) passed at `helm install cilium`. No live ConfigMap patch, no restart dance. |
| `10_install_k8s.yaml:330-352` bootstrap config (`containerd-base-dir`, `cluster-config.network/dns/local-storage/gateway`, `extra-node-kubelet-args`) | Kubeadm `InitConfiguration` + `ClusterConfiguration` + `KubeletConfiguration` in a single `kubeadm-config.yaml`. Same values, native API. |
| `gpu_operator/10_deploy.yaml:372-380` toolkit env passes `/var/lib/k8s-containerd/k8s-containerd/...` paths | Same env keys, paths replaced with standard `/etc/containerd/config.toml`, `/run/containerd/containerd.sock`, `/etc/containerd/conf.d/`, `/var/lib/containerd/`. |
| `gateway-api/10_deploy.yaml:101` probes k8s-snap for `gateway: enabled` in `k8s status --output-format yaml` and skips its own Gateway CRD install when present | Drop the probe. Always install Gateway API CRDs explicitly, bumped from `v1.2.1` (current playbook) to **`v1.5.1`** (required by Envoy Gateway 1.8 per the release manifest). Phase 3 PR updates the URL accordingly. |
| `19_rollback_control.yaml` / `29_rollback_workers.yaml` (snap remove, CSI mount cleanup, ufw reset) | `kubeadm reset` + `apt purge` (kubeadm, kubelet, kubectl, containerd.io) + dataroot wipe + same ufw reset. |

### What stays unchanged

These are independent of the cluster bootstrap mechanism and need no
edits during the migration:

- UFW firewall rules (lines 169-305 of `10_install_k8s.yaml`)
- `k8s0` dummy interface for stable API server IP (lines 105-164)
- NVIDIA driver install logic (gpu_operator `10_deploy.yaml:33-189`)
- NVIDIA host driver validation marker
  (`/run/nvidia/validations/host-driver-ready`)
- DGX Spark Docker daemon NVIDIA runtime config (gpu_operator
  `10_deploy.yaml:39-60`)
- GPU detection / pre-Volta exclusion logic
- `gpu.deploy.*=false` opt-out labelling
- GPU operator namespace without quota policy
- Cilium-on-new-node self-heal block (`20_join_workers.yaml:708-758`) —
  depends on Cilium internals, not k8s-snap
- All application playbooks (postgresql, harbor, gitea, juicefs,
  jupyterhub, …) — they already use `{{ kubectl_bin }}` and `{{
  helm_bin }}` pointing at vanilla upstream binaries (see section 6.3)

### What gets newly installed

1. **`containerd.io`** from Docker's apt repository
   (`download.docker.com/linux/ubuntu`). Reason: Ubuntu's `containerd`
   package lags upstream by months; the Docker-provided `containerd.io`
   matches what kubeadm expects. Config:
   `/etc/containerd/config.toml` with `SystemdCgroup = true` on **both**
   `io.containerd.cri.v1.runtime` (active in containerd 2.x) and
   `io.containerd.grpc.v1.cri` (legacy, defensive). Standard `imports
   = ["/etc/containerd/conf.d/*.toml"]`.
2. **`kubeadm`, `kubelet`, `kubectl`** from
   `pkgs.k8s.io/core:/stable:/v1.<MINOR>/deb/`. Pinned via `apt-mark
   hold` after install. Same version string installs on amd64 and arm64.
3. **`kubeadm init`** with `kubeadm-config.yaml` containing
   `InitConfiguration` + `ClusterConfiguration` +
   `KubeletConfiguration`, binding to `k8s_stable_ip:6443`.
4. **`kubeadm join`** for workers using the bootstrap token + CA hash
   produced at init.
5. **Cilium** via helm (chart from `helm.cilium.io`), with values for
   `kubeProxyReplacement`, `devices`, `k8sServiceHost`, `k8sServicePort`,
   `wireguard.enabled=false`.
6. **OpenEBS Rawfile CSI** via helm (chart `openebs-rawfile-localpv` from
   `openebs.github.io/rawfile-localpv`), with the StorageClass renamed
   to `csi-rawfile-default` to match the existing alias.
7. **Gateway API CRDs** — already installed by `gateway-api/10_deploy.yaml`
   at line 190; just becomes unconditional.

### What is already kubeadm-clean (no work needed)

- `{{ kubectl_bin }}` (769 references) and `{{ helm_bin }}` (121
  references) already point at upstream binaries downloaded to
  `~/.local/bin/`:
  - `10_install_k8s.yaml:587-594`: `get_url` from
    `https://dl.k8s.io/release/v{{ k8s_version }}/bin/linux/{{ system_arch }}/kubectl`
  - `10_install_k8s.yaml:596-617`: runs `get-helm-3.sh`
- `inventory/group_vars/k8s.yml:84-88` defines `kubeconfig: ~/.kube/config`
  and `kubectl_bin: ~/.local/bin/kubectl`, `helm_bin: ~/.local/bin/helm`
- All `00_install.yaml` wrappers and downstream deploy playbooks use these
  variables; **no migration work on the application layer**.

### Residual `k8s kubectl` / `k8s helm` work

- 58 `k8s kubectl` occurrences. ~50 are inside the five k8s-snap install/test/
  rollback playbooks that get rewritten wholesale; ~6 are in two helper
  roles (`ansible/roles/container_deployment/deployment/tasks/main.yaml`
  and `ansible/roles/waiting_for_image/tasks/main.yaml`) — trivial
  `s/k8s kubectl/{{ kubectl_bin }}/g`; 2 are in
  `*_to_be_deleted.yaml` files (`ansible/40_thinkube/core/keycloak/test_credentials_to_be_deleted.yaml`,
  `ansible/40_thinkube/core/infrastructure/fix_tkc_dns_to_be_deleted.yaml`) — delete.
- 1 `k8s helm` — one-line fix.

## 4. Preserved behaviours (workaround → outcome map)

The migration removes the *mechanism* of each k8s-snap workaround but
must preserve the *outcome* it produced. Acceptance criteria in section
8 verify each row.

| What was fixed via k8s-snap workaround | kubeadm guarantees the same outcome via |
|---|---|
| `00-k8s-runc.toml` ordering hack so runc survives `99-nvidia.toml` (canonical/k8s-snap#1991) | Standard containerd import semantics: `/etc/containerd/config.toml` defines runc; `/etc/containerd/conf.d/99-nvidia.toml` adds the nvidia runtime alongside without replacing runc. |
| `SystemdCgroup = true` for the active CRI plugin (canonical/k8s-snap#2529) | `/etc/containerd/config.toml` sets `SystemdCgroup = true` on both `io.containerd.cri.v1.runtime` AND `io.containerd.grpc.v1.cri`. kubeadm sets kubelet `--cgroup-driver=systemd`. Cannot drift because Thinkube owns both sides. |
| `containerd-base-dir /var/lib/k8s-containerd` for Docker coexistence | Two containerd daemons on different sockets, different data dirs. Docker on `/run/docker/containerd/containerd.sock` + `/var/lib/docker/`; kubelet on `/run/containerd/containerd.sock` + `/var/lib/containerd/`. |
| `snap revert + hold` to escape broken upgrades (#2529) | `apt-mark hold kubeadm kubelet kubectl containerd.io`. Version bumps require explicit `apt-mark unhold && apt install kubeadm=<pinned>`. |
| Per-arch revision lookup (`k8s_snap_revisions: {amd64: 5046, arm64: 5049}`) | Single arch-agnostic version: `kubeadm=1.<MINOR>.<PATCH>-1.1` resolves to the right binary on amd64 OR arm64 via apt. |
| `--root-dir=/var/snap/k8s/common/var/lib/kubelet` worker patch | Standard `/var/lib/kubelet` on both control plane and workers — set by kubeadm by default. |
| `csi-rawfile-default` StorageClass with `k8s-hostpath` alias | Same StorageClass name and alias preserved; OpenEBS Rawfile chart installed explicitly. |
| Cilium ZeroTier device exclusion | Same outcome, configured as helm values at install time instead of post-install ConfigMap patch. |

## 5. Versioning and channel scheme

### 5.1 Version string

Shape: `v<K8S_MAJOR>.<K8S_MINOR>.<K8S_PATCH>+thinkube.<TK_MAJOR>.<TK_MINOR>.<TK_PATCH>`

Examples:

```
v1.35.5+thinkube.0.1.0    # Thinkube 0.1.0 on Kubernetes 1.35.5
v1.35.5+thinkube.0.1.1    # Thinkube patch release, same K8s
v1.35.6+thinkube.0.1.1    # K8s CVE patch — Thinkube unchanged
v1.35.6+thinkube.0.1.2    # Thinkube patch on top of the K8s patch
v1.36.1+thinkube.0.2.0    # K8s minor bump + Thinkube minor release
```

Rules:

- Each component bumps **only when it actually changed**. K8s-only
  rebuilds don't move the Thinkube counter; Thinkube-only fixes don't
  move the K8s version.
- The full string is the unique artifact identifier. Two artifacts that
  install differently always differ in some part of the string.
- Pre-releases use `-rc.N` between the K8s version and the `+thinkube`
  suffix: `v1.35.5-rc.1+thinkube.0.2.0`.

### 5.2 thinkube-metadata schema additions

Existing repo (`github.com/thinkube/thinkube-metadata`, default branch
`main`) already contains:

- `mirror_images.json` (1.2.0) — container images mirrored to Harbor
- `models.json`, `optional_components.json`, `repositories.json`

Two new artifacts:

#### `releases/v<VERSION>.yaml`

One file per Thinkube release. Pinned dependencies, single source of
truth read by the installer, by playbooks, and by the channel publisher.

```yaml
# thinkube-metadata/releases/v1.35.5+thinkube.0.1.0.yaml
# Truncated — full file lives at thinkube-metadata/releases/v1.35.5+thinkube.0.1.0.yaml
version: v1.35.5+thinkube.0.1.0
kubernetes:
  minor: "1.35"           # apt repo: pkgs.k8s.io/core:/stable:/v1.35/deb/
  patch: "1.35.5"         # apt resolves as "kubeadm=1.35.5-1.1"
  apt_revision: "1.1"
  eol: "2027-02-28"
containerd:
  package: containerd.io
  apt_version: "2.2.4-1"  # latest 2.x; NRI plugin support for future Buildah work
  apt_source: "https://download.docker.com/linux/ubuntu"
cilium:
  helm_repo: "https://helm.cilium.io"
  chart: cilium
  version: "1.19.4"       # battle-tested with K8s 1.35 via k8s-snap and RKE2
openebs_rawfile:
  helm_repo: "https://openebs.github.io/rawfile-localpv"
  chart: rawfile-localpv
  version: "0.13.1"       # avoids v0.14.0's breaking config changes
envoy_gateway:
  helm_repo: "https://docs.envoyproxy.io/release/v1.3.0"
  chart: gateway-helm
  version: "v1.8.0"       # supports K8s 1.32-1.35
gateway_api_crds:
  version: "v1.5.1"       # required by Envoy Gateway 1.8 (was v1.2.1 under k8s-snap)
  url: "https://github.com/kubernetes-sigs/gateway-api/releases/download/v1.5.1/experimental-install.yaml"
gpu_operator:
  helm_repo: "https://helm.ngc.nvidia.com/nvidia"
  chart: gpu-operator
  version: "v26.3.1"      # patch bump from v26.3.0; v26.3 line validated on DGX Spark
binaries:
  kubectl:
    url: "https://dl.k8s.io/release/v1.35.5/bin/linux/{arch}/kubectl"
    arches: [amd64, arm64]
  helm:
    version: "v3.16.4"
    url: "https://get.helm.sh/helm-v3.16.4-linux-{arch}.tar.gz"
    arches: [amd64, arm64]
notes_url: "https://github.com/thinkube/thinkube/releases/tag/v1.35.5%2Bthinkube.0.1.0"
```

The `{arch}` placeholder is resolved by the consumer (installer or
playbook) to `amd64` / `arm64`. URLs are sha256-pinned per arch where
applicable; helm charts are version-pinned (chart hashes are not
universally published).

#### `channels.json`

A single file mapping channel names to versions. Mutable pointer file.
Served as a raw GitHub asset.

```json
{
  "schema_version": 1,
  "updated": "2026-05-24T00:00:00Z",
  "channels": {
    "stable":     null,
    "latest":     null,
    "testing":    "v1.35.5+thinkube.0.1.0",
    "v0.1":       null,
    "k8s-1.35":   null
  }
}
```

The actual `channels.json` shipped with this migration has only the
`testing` channel populated until the release is validated on real
hardware. `stable`, `latest`, `v0.1`, and `k8s-1.35` are promoted by
later edits to `channels.json` on `main`.

Initial channels for 0.1.0:

- `stable` — currently-recommended GA. Once stabilised.
- `latest` — newest GA, even if not yet promoted to stable.
- `testing` — RC builds (`null` when no RC is in flight).
- `v<TK_MINOR>` (`v0.1`, `v0.2`, …) — newest patch in that Thinkube
  minor.
- `k8s-<K8S_MINOR>` (`k8s-1.35`, `k8s-1.36`, …) — newest version
  bundling that K8s minor.

The two-axis pinning (`v0.<n>` vs `k8s-1.<n>`) lets users on a regulated
network track K8s CVE patches without re-validating Thinkube features.

### 5.3 Channel server hosting

Resolution-time only. **No background polling, no auto-refresh**. The
installer reads the channel exactly when the user runs an install or
upgrade command. snap's auto-refresh nightmare (#2529 broke clusters at
5am) cannot happen by construction.

**Hosting: raw.githubusercontent.com directly from `thinkube-metadata`.**
No new domain, no GitHub Pages, no CNAME. Follows the existing pattern
already used for `mirror_images.json`
(`ansible/40_thinkube/core/harbor-images/13_mirror_public_images.yaml:39`)
and `repositories.json`
(`ansible/40_thinkube/core/code-server/15_configure_environment.yaml:500`).

Two URL classes:

**Mutable pointer** (always fetched from `main`):

```
https://raw.githubusercontent.com/thinkube/thinkube-metadata/main/channels.json
```

Mutability is the feature here — the file at `main` is supposed to
move whenever a channel is promoted.

**Immutable release manifests** (pinned to a git tag, not `main`):

```
https://raw.githubusercontent.com/thinkube/thinkube-metadata/<TAG>/releases/<VERSION>.yaml
```

Each Thinkube release tags the corresponding `thinkube-metadata` commit
(tag name matches: e.g. `v1.35.5+thinkube.0.1.0`). The release manifest
is fetched via that tag, so even if `main` were force-pushed, an already-
published release continues to resolve to the exact bytes it shipped
with.

`channels.json` carries the tag inline so the installer never has to
guess:

```json
{
  "schema_version": 1,
  "updated": "2026-06-15T14:00:00Z",
  "channels": {
    "stable":   null,
    "latest":   null,
    "testing":  { "version": "v1.35.5+thinkube.0.1.0", "metadata_tag": "v1.35.5+thinkube.0.1.0" },
    "v0.1":     null,
    "k8s-1.35": null
  }
}
```

`metadata_tag` defaults to equal `version` but is kept distinct in the
schema so a manifest hot-fix (e.g. corrected sha256) can be re-tagged
without re-versioning the underlying Thinkube release.

Cutting a release becomes:

1. Add `releases/v<NEW>.yaml` on a branch in `thinkube-metadata`
2. Open PR, review, merge to `main`
3. Tag `main` as `v<NEW>` and push the tag
4. Edit `channels.json` on `main` to point the desired channels at
   `v<NEW>` (with `metadata_tag: v<NEW>`)

The tag is what makes the manifest URL immutable; the `main` channels
file is what makes the pointer mutable. Both live in the same repo,
both visible in `git log`.

### 5.4 Installer integration

The installer fetches the channel mapping at install/upgrade time:

```python
# frontend/src-tauri/backend/app/services/release_resolver.py (new)
METADATA_REPO = "thinkube/thinkube-metadata"
CHANNELS_URL = f"https://raw.githubusercontent.com/{METADATA_REPO}/main/channels.json"

async def resolve_channel(channel: str = "stable") -> dict:
    channels = await fetch_json(CHANNELS_URL)
    entry = channels["channels"][channel]
    if entry is None:
        raise ChannelEmpty(channel)
    manifest = await fetch_yaml(
        f"https://raw.githubusercontent.com/{METADATA_REPO}/"
        f"{entry['metadata_tag']}/releases/{entry['version']}.yaml"
    )
    return manifest
```

The resolved manifest is then injected into the Ansible run as group
variables: kubernetes version, containerd version, helm chart versions,
binary URLs. Replaces today's hardcoded `k8s_version: "1.35.0"` and
`k8s_snap_revisions: {...}` literals.

A new wizard screen (or pre-deploy step) shows the user **what version
they're about to install** with K8s/Cilium/CSI/etc. pinned versions —
makes the manifest visible at install time rather than buried in a YAML
file.

### 5.5 Naming convention

Thinkube is **not a monolithic stack.** It is a set of composable
components, any subset of which can be used independently. The naming
below makes the boundaries explicit so contributors, documentation, and
the version manifest agree on what each thing is.

#### The components

| Name | What it is | Scope |
|---|---|---|
| **Thinkube Cluster** | The kubeadm-based Kubernetes distribution: kubeadm + containerd + Cilium + OpenEBS Rawfile + Envoy Gateway + Gateway API CRDs + GPU operator | Private only (bare metal / VM the user owns) |
| **Thinkube Platform** | A capability-neutral API contract: identity, registry, git, cd, workflow, rdbms, object_storage, shared_filesystem, dns, tls, secrets, model_registry, observability. Apps consume this API and do not know which implementation backs it. | Portable — any deployment target with a connector |
| **Thinkube Connectors** | Adapters that fulfil the Platform API against a specific deployment target. The 0.1.0 release ships one: the **self-hosted connector**, in which the in-cluster components (Keycloak, Harbor, PostgreSQL, …) directly satisfy the API. The schema reserves room for additional connectors targeting other substrates; specific implementations are tracked separately from this plan. | The connector layer is the substitution mechanism |
| **Thinkube AI Lab** | The private AI development environment (umbrella concept; not a new URL). Three sub-components, each at an existing URL: **Notebooks** (`jupyter.<domain>` — JupyterHub + `thinkube-ai-lab-theme` + `tk-ai-extension`), **Code** (`code.<domain>` — code-server + `thinkube-ai-integration`), **Console** (`control.<domain>` — `thinkube-control`, includes templates catalogue) | Private only — coupled to host-path mounts, GPU passthrough, sovereign developer experience. Not portable. |
| **Thinkube Apps** | User-built workloads consuming the Thinkube Platform API. Independent of which connector fulfils the API at deployment time. | Portable — runs wherever a connector exists |
| **Thinkube Installer** | The desktop bootstrap application | Private side |
| **Thinkube Metadata** | Channel + release manifest + mirror catalogues; the canonical source of truth for what each release ships | Public metadata repo |

#### Composition, not stacking

There is no required vertical order. Valid combinations include:

- Thinkube Cluster + Thinkube Platform + Thinkube AI Lab (full private setup)
- Thinkube Cluster alone (bring-your-own apps; you just wanted the distribution)
- Thinkube Apps + a connector against any conformant Kubernetes (no Thinkube Cluster needed)
- Develop on Thinkube AI Lab (private), deploy via a different connector to a different substrate

The only mandatory pieces are an app and a connector that fulfils the
capabilities that app declares it needs.

#### Capability-neutral naming on the user-facing surface

User-facing variables and documentation describe the capability, not
the implementation:

| Capability | Implementation in the self-hosted connector |
|---|---|
| `identity` | Keycloak |
| `registry` | Harbor |
| `git` | Gitea |
| `cd` | ArgoCD |
| `workflow` | Argo Workflows |
| `rdbms` | PostgreSQL |
| `object_storage` | SeaweedFS |
| `shared_filesystem` | JuiceFS |
| `dns` | BIND9 |
| `tls` | ACME / Let's Encrypt |
| `secrets` | Kubernetes Secrets |
| `model_registry` | MLflow |
| `observability` | Perses |

The pattern already in use for `registry_subdomain: "registry"`
(`inventory/group_vars/k8s.yml:31`) extends to every capability above.

**Playbook directories stay implementation-named** (`core/harbor/`,
`core/seaweedfs/`, `core/juicefs/`). The playbook in
`core/harbor/00_install.yaml` installs Harbor specifically; renaming
that directory to `core/registry/` would be misleading. The neutral
abstraction lives **above** the implementation — in the inventory
variables, the documentation, the version manifest — not in the install
step itself.

**Implementation-specific tuning stays implementation-named**
(`harbor_registry_size`, `keycloak_db_password`, `juicefs_mount_options`,
…). These encode product-specific semantics that don't translate
across connectors; the consumer already knows which implementation
they're configuring because the variable name says so.

#### Variable-rename sweep (one-shot audit)

A single PR within the migration audits user-facing variables and
renames the ones that name an implementation when they should name a
capability:

```bash
grep -rn "seaweedfs_\|juicefs_\|mlflow_\|gitea_\|keycloak_\|postgresql_\|argocd_\|bind9_" \
  inventory/ ansible/40_thinkube/ \
  --include="*.yaml" --include="*.yml"
```

For each hit, classify:

- **User-facing endpoint / URL / generic config** → rename to capability-neutral (`seaweedfs_endpoint` → `object_storage_endpoint`).
- **Implementation-specific tuning** → leave alone (`harbor_registry_size` stays).

Bounded list; one-shot audit; lands in Phase 2 or 3 of the
implementation (see section 11).

#### Updated manifest structure

The §5.2 schema becomes capability-keyed under `platform.capabilities`,
with `connectors` listing what's available and what it implements.
The 0.1.0 release populates only the `self_hosted` connector:

```yaml
version: v1.35.5+thinkube.0.1.0

cluster:                              # optional — private deployments only
  kubernetes: "1.35.5"
  cilium: "1.19.4"
  openebs_rawfile: "0.13.1"
  envoy_gateway: "v1.8.0"

platform:                             # the API contract
  api_version: "1"
  capabilities:
    identity:           { impl: keycloak,        version: "26.0.5" }
    registry:           { impl: harbor,          version: "2.11.1" }
    git:                { impl: gitea,           version: "1.22.0" }
    cd:                 { impl: argocd,          version: "2.13.0" }
    workflow:           { impl: argo_workflows,  version: "3.5.13" }
    rdbms:              { impl: postgresql,      version: "16.4" }
    object_storage:     { impl: seaweedfs,       version: "3.79" }
    shared_filesystem:  { impl: juicefs,         version: "1.2.1" }
    dns:                { impl: bind9,           version: "9.20.4" }
    tls:                { impl: acme_letsencrypt, version: n/a }
    secrets:            { impl: k8s_secrets,     version: n/a }
    model_registry:     { impl: mlflow,          version: "2.18.0" }
    observability:      { impl: perses,          version: "0.50.0" }

connectors:                           # at least one required
  self_hosted:
    version: "0.1.0"
    implements: [identity, registry, git, cd, workflow, rdbms,
                 object_storage, shared_filesystem, dns, tls,
                 secrets, model_registry, observability]
  # Schema reserves room for additional connectors targeting other
  # deployment substrates. Tracked separately from this plan.

ai_lab:                               # private only
  scope: private_only
  notebooks:
    jupyterhub: "5.2.1"
    theme: "thinkube-ai-lab-theme@v1.0.0"
    extension: "tk-ai-extension@v0.3.0"
  code:
    code_server: "4.96.4"
    extension: "thinkube-ai-integration@v0.1.0"
  console:
    thinkube_control: "0.1.0"

apps:                                 # user artefacts; empty in the Thinkube release manifest
  {}
```

The `cluster:`, `platform:`, `ai_lab:`, and `apps:` sections are
**independent** — a deployment may include or omit each one based on
which subset of Thinkube it uses. The only universally required section
is `connectors:` (at least one entry, because every app needs *some*
way to fulfil the Platform API).

#### Unified visual branding

Out of scope for the migration PR set but tracked as an immediate
follow-up: extend the `thinkube-ai-lab-theme` brand (logo strip, color
palette, header layout) to code-server's landing page and to
`thinkube-control`'s home page so all three AI Lab sub-components feel
like one product. Doc-only / theming work, no functional change.

## 6. Playbook-by-playbook change list

### 6.1 `ansible/40_thinkube/core/infrastructure/k8s/10_install_k8s.yaml`

Currently 920+ lines. Becomes ~500 lines after migration.

**Deleted sections (with line ranges):**
- 308-328: snap install + hold (entire `## k8s-snap Installation` block)
- 330-352: k8s bootstrap config (replaced by kubeadm config)
- 356-365: `k8s bootstrap` invocation
- 367-373: `k8s status --wait-ready` polling
- 386-423: containerd `00-k8s-runc.toml` workaround
- 425-444: post-install Cilium / CoreDNS waits via `k8s kubectl` (replaced)
- 446-479: Cilium ZeroTier patch + restart (moved to helm values)
- 494-508: storage class verification (moved to OpenEBS install step)
- 510-568: rawfile-csi DaemonSet patch

**New sections (in install order):**
1. Install `containerd.io` from Docker apt repo. Write
   `/etc/containerd/config.toml` from a Jinja2 template with
   `SystemdCgroup = true` on both CRI plugins.
   `systemctl enable --now containerd`.
2. Install `kubeadm`, `kubelet`, `kubectl` from k8s apt repo at
   the version pinned by the release manifest. `apt-mark hold` all
   three plus `containerd.io`.
3. Pull required images: `kubeadm config images pull`.
4. Write `/tmp/kubeadm-config.yaml` from a Jinja2 template containing
   `InitConfiguration` (advertise address = `k8s_stable_ip`),
   `ClusterConfiguration` (controlPlaneEndpoint, podSubnet,
   serviceSubnet, kubernetesVersion), `KubeletConfiguration`
   (cgroupDriver=systemd, systemReserved, kubeReserved, evictionHard,
   evictionSoft, evictionSoftGracePeriod, enforceNodeAllocatable,
   maxPods=500).
5. `kubeadm init --config /tmp/kubeadm-config.yaml --upload-certs`
   (upload-certs lets future HA control planes join with the certificate
   key).
6. Copy `/etc/kubernetes/admin.conf` to `~{{ system_username }}/.kube/config`.
7. Helm-install Cilium with values for devices, kubeProxyReplacement,
   k8sServiceHost/Port, no WireGuard.
8. Helm-install OpenEBS Rawfile CSI. Apply `k8s-hostpath` alias
   StorageClass from `files/k8s-hostpath-storageclass.yaml` (unchanged).
9. Wait for CoreDNS (installed by kubeadm) + Cilium + rawfile-csi
   DaemonSet ready.
10. The kubectl/helm `get_url` downloads stay as-is (already kubeadm-clean).

**Kept verbatim:**
- 80-83: minimum RAM check
- 105-164: k8s0 dummy interface
- 167-305: UFW rules
- 575-625: kubectl + helm download (vanilla upstream)
- 627-660: kubeconfig copy
- 700-900: closing summary / wrapper script creation

### 6.2 `ansible/40_thinkube/core/infrastructure/k8s/11_configure_kubelet_args.yaml`

**Delete entirely.** Kubelet args migrate into the `KubeletConfiguration`
block embedded in `kubeadm-config.yaml` at init time. The vars at lines
30-46 of the current file move into a `vars/` file consumed by both
the init playbook and the join playbook so the values stay
single-sourced.

### 6.3 `ansible/40_thinkube/core/infrastructure/k8s/20_join_workers.yaml`

Currently 800+ lines. Becomes ~400 lines after migration.

**Deleted sections:**
- 33-37 + 431-435: `k8s_snap_revisions` per-arch lookup tables
- 220-260 (approx): snap install + hold
- 594-629: k8s join config + `k8s join-cluster` invocation
- 631-655: `00-k8s-runc.toml` worker copy
- 657-689: kubelet `--root-dir` patch + snap restart

**New sections:**
1. Install `containerd.io` + write `/etc/containerd/config.toml`
   (same Jinja2 template as control plane, role-extracted).
2. Install `kubeadm`, `kubelet`, `kubectl` + `apt-mark hold`.
3. Generate join token on control plane: `kubeadm token create
   --print-join-command` (via `delegate_to`). Includes CA hash.
4. `kubeadm join <CP-IP>:6443 --token <T> --discovery-token-ca-cert-hash
   sha256:<H> --config /tmp/kubeadm-join-config.yaml` where the join
   config carries the worker's `KubeletConfiguration`.

**Kept verbatim:**
- 70-180 (approx): UFW worker rules
- 691-705: wait-for-node-ready check
- 708-758: **Cilium-on-new-node self-heal block** — Cilium-internal,
  unchanged

### 6.4 `ansible/40_thinkube/core/infrastructure/k8s/19_rollback_control.yaml` + `29_rollback_workers.yaml`

Rewrite both. New shape:

1. `kubeadm reset --force` (cleans /etc/kubernetes, /var/lib/etcd,
   kubelet config, CNI config, drains iptables).
2. `apt purge -y kubeadm kubelet kubectl containerd.io`.
3. Wipe `/var/lib/containerd/`, `/var/lib/kubelet/`,
   `/etc/cni/net.d/`, `~/.kube/config`.
4. Remove cilium-installed interfaces (lines 137-146 of current
   `19_rollback_control.yaml` — keep as-is, those iptable/interface
   names are Cilium's, not snap's).
5. Reset UFW (keep current behaviour).

Test rollback playbooks (`18_test_control.yaml`, `28_test_worker.yaml`)
get small edits: replace `k8s kubectl get ...` with `{{ kubectl_bin }}
get ...`.

### 6.5 `ansible/40_thinkube/core/infrastructure/gpu_operator/10_deploy.yaml`

**Path-only edits, no structural change.**

Line 372-380 — helm install env vars change paths:

| From | To |
|---|---|
| `/var/lib/k8s-containerd/k8s-containerd/etc/containerd/config.toml` | `/etc/containerd/config.toml` |
| `/var/lib/k8s-containerd/k8s-containerd/run/containerd/containerd.sock` | `/run/containerd/containerd.sock` |
| `/var/lib/k8s-containerd/k8s-containerd/etc/containerd/conf.d/99-nvidia.toml` | `/etc/containerd/conf.d/99-nvidia.toml` |

Line 380 — `daemonsets.toolkit.volumes` hostPath paths change to the
same set of standard locations.

Line 438-441 — `snap restart k8s.containerd` becomes `systemctl restart
containerd`.

Line 432 — `wait_for: path: /etc/containerd/conf.d/99-nvidia.toml`
stays (the path was already the standard one even before migration —
the toolkit wrote to two locations).

### 6.6 `ansible/40_thinkube/core/infrastructure/dns-server/10_deploy.yaml`

Line 197 (image import via `ctr`):

```diff
-sudo /snap/k8s/current/bin/ctr --address /var/lib/k8s-containerd/k8s-containerd/run/containerd/containerd.sock --namespace k8s.io images import {{ bind9_build_dir }}/thinkube-bind9.tar
+sudo ctr --address /run/containerd/containerd.sock --namespace k8s.io images import {{ bind9_build_dir }}/thinkube-bind9.tar
```

### 6.7 `ansible/40_thinkube/core/infrastructure/gateway-api/10_deploy.yaml`

Line 101 — drop the `k8s status --output-format yaml` probe that
detects k8s-snap's bundled Gateway API. Always run the
`kubectl apply -f .../experimental-install.yaml` at line 190 (currently
gated on the probe result). Tiny edit.

### 6.8 Helper roles

`ansible/roles/container_deployment/deployment/tasks/main.yaml` and
`ansible/roles/waiting_for_image/tasks/main.yaml`: replace `k8s kubectl`
with `{{ kubectl_bin }}` (~6 occurrences combined).

### 6.9 Files to delete

- `ansible/40_thinkube/core/keycloak/test_credentials_to_be_deleted.yaml`
- `ansible/40_thinkube/core/infrastructure/fix_tkc_dns_to_be_deleted.yaml`

Already flagged for deletion in their filenames; no other code references
them.

### 6.10 Contributor fork support

The first thing a contributor will try is "fork the relevant repo and
test my change end-to-end through the installer." Today the installer
hard-clones `github.com/thinkube/thinkube`, and the metadata fetch
URLs are also hardcoded to the `thinkube` org. Four small edits make
the fork-and-test loop work without touching any other code.

Scope is deliberately narrow: **only org/repo URLs that determine
where the system fetches code or metadata from**. In-pod paths like
`/home/thinkube/` are intentional Thinkube branding (the hostPath
mount is templated with `{{ system_username }}` host-side; the
mountPath is fixed pod-side — same shape as Docker stamping
`/var/lib/docker/`) and are explicitly out of scope.

| File:line | Hardcoded URL | New env var (default) |
|---|---|---|
| `installer/frontend/src-tauri/backend/app/services/ansible_environment.py:31` | `https://github.com/thinkube/thinkube.git` | `THINKUBE_REPO_URL` (default unchanged). Sibling to existing `THINKUBE_BRANCH` at line 32. |
| `installer/frontend/src-tauri/backend/app/services/release_resolver.py` (new, Phase 4) | `thinkube/thinkube-metadata` | `THINKUBE_METADATA_REPO` (default unchanged). Used to build both the `channels.json` and the tagged `releases/<VERSION>.yaml` URLs. |
| `thinkube-control/backend/app/services/optional_components.py:21` | `https://raw.githubusercontent.com/thinkube/thinkube-metadata/main/optional_components.json` | Same `THINKUBE_METADATA_REPO` env var; same default. |
| `thinkube/ansible/40_thinkube/optional/perses/14_import_dashboards_percli.yaml:50` | `https://github.com/thinkube/thinkube-monitor.git` (already in `vars:` block) | Promote to `group_vars/all.yml` (new file) with the existing default; contributors override via inventory or `--extra-vars`. |

**Cosmetic URL references** (UI "View on GitHub" links in
`complete.tsx:390`, `Documentation=` in
`vfio-bind.service.j2:6`, package metadata in
`fastapi-mcp-extended/pyproject.toml`, default template URLs in
`thinkube-control/.../deployment_schemas.py:22`) are left alone — they
describe upstream by design and should not change in a fork.

**New `CONTRIBUTING.md`** at the root of `thinkube-installer` (and a
matching one in `thinkube`) documents the env-var-based fork workflow:

```bash
# Test your fork of the thinkube playbooks end-to-end
THINKUBE_REPO_URL=https://github.com/<you>/thinkube.git \
THINKUBE_BRANCH=my-feature-branch \
npm run tauri:dev

# Test your fork of the metadata repo (release manifests, mirror lists)
THINKUBE_METADATA_REPO=<you>/thinkube-metadata \
npm run tauri:dev

# Both at once — typical contributor flow
THINKUBE_REPO_URL=https://github.com/<you>/thinkube.git \
THINKUBE_BRANCH=my-feature-branch \
THINKUBE_METADATA_REPO=<you>/thinkube-metadata \
npm run tauri:dev
```

The CONTRIBUTING.md also documents the per-repo worktree workflow
already described in section 9.2, the per-PR scope discipline from
section 9.4, and the matching-branch-names convention from section 9.1.

### 6.11 README and docs

- `ansible/40_thinkube/core/infrastructure/k8s/README.md` — rewrite the
  "k8s-snap" sections to describe kubeadm install, the
  `containerd-base-dir` / `00-k8s-runc.toml` workaround discussion gets
  removed.
- `ansible/40_thinkube/core/infrastructure/k8s/TROUBLESHOOTING.md` —
  drop snap-specific troubleshooting; add kubeadm-equivalent (kubelet
  systemd unit, containerd systemd unit, `kubeadm reset` semantics).
- `ansible/40_thinkube/core/infrastructure/gpu_operator/README.md` —
  drop the `00-k8s-runc.toml` workaround section; describe how
  `/etc/containerd/conf.d/99-nvidia.toml` merges with our base config.

## 7. New shared role / templates to create

Reuse over duplication. Two new roles factor common logic out of the
control-plane and worker playbooks:

### 7.1 `ansible/roles/containerd_install/`

Tasks:
- Add Docker apt key + repo
- Install `containerd.io` at the pinned version
- Render `/etc/containerd/config.toml` from
  `templates/config.toml.j2` (the template embeds `SystemdCgroup = true`
  on both CRI plugins + `imports = ["/etc/containerd/conf.d/*.toml"]`)
- Create `/etc/containerd/conf.d/` directory
- `systemctl enable --now containerd`
- `apt-mark hold containerd.io`

### 7.2 `ansible/roles/kubeadm_install/`

Tasks:
- Add Kubernetes apt key + repo (URL templated from release manifest:
  `pkgs.k8s.io/core:/stable:/v{{ k8s_minor }}/deb/`)
- Install `kubeadm`, `kubelet`, `kubectl` at the pinned versions
- `apt-mark hold` all three
- Disable swap (already done elsewhere? — verify)
- Load required kernel modules (`br_netfilter`, `overlay`)
- Apply required sysctl (`net.bridge.bridge-nf-call-iptables=1`,
  `net.ipv4.ip_forward=1`, `net.bridge.bridge-nf-call-ip6tables=1`)

Both roles consumed by `10_install_k8s.yaml` and `20_join_workers.yaml`
so version pinning + containerd config live in one place.

### 7.3 `kubeadm-config.yaml` template

`ansible/40_thinkube/core/infrastructure/k8s/templates/kubeadm-init-config.yaml.j2`
and `kubeadm-join-config.yaml.j2`. Single-source the `KubeletConfiguration`
block via `vars/kubelet_config.yaml` so init and join produce identical
kubelet behaviour.

## 8. Acceptance criteria

A migration PR is mergeable when **all** these pass on a real two-node
test (control plane + worker, mixed amd64 / arm64 if possible):

### 8.1 Cluster comes up

- [ ] `kubectl get nodes` shows both nodes `Ready` within 10 min of
      install start.
- [ ] `kubectl version` reports the K8s version from the release
      manifest on both nodes.
- [ ] `kubectl get pods -A` shows all kube-system pods running, no
      restarts.

### 8.2 Workarounds-replaced verifications (one per row in section 4)

- [ ] `containerd config dump | grep SystemdCgroup` shows `true` for
      both `io.containerd.cri.v1.runtime` and `io.containerd.grpc.v1.cri`.
- [ ] No file at `/etc/containerd/conf.d/00-k8s-runc.toml`.
- [ ] No directory at `/var/lib/k8s-containerd`.
- [ ] After `kubectl apply` of a CUDA test pod, GPU operator
      sees the nvidia runtime via `/etc/containerd/conf.d/99-nvidia.toml`
      and the runc runtime survives (the actual #1991 outcome test).
- [ ] `apt-mark showhold | grep -E 'kubeadm|kubelet|kubectl|containerd.io'`
      shows all four held.
- [ ] `systemctl is-active containerd kubelet docker` shows all three
      active on DGX Spark (Docker + cluster containerd coexist).
- [ ] `ls /run/containerd/containerd.sock /run/docker/containerd/containerd.sock`
      shows both sockets present.
- [ ] `kubectl get storageclass` shows `csi-rawfile-default` AND
      `k8s-hostpath`.

### 8.3 Application stack still works

- [ ] Full deploy queue (deploy.tsx) runs to completion without manual
      intervention.
- [ ] Harbor pulls a test image successfully.
- [ ] PostgreSQL PVC binds and pod starts.
- [ ] Keycloak login UI reachable on `keycloak.<domain>`.
- [ ] At least one optional app (e.g. JupyterHub) deploys and a user
      pod starts.

### 8.4 Rollback works

- [ ] `19_rollback_control.yaml` cleanly removes kubeadm artefacts; a
      second `10_install_k8s.yaml` run after rollback succeeds.
- [ ] `29_rollback_workers.yaml` cleanly removes worker artefacts.

### 8.5 Single-arch and mixed-arch installs

- [ ] Install succeeds on a single amd64 control plane.
- [ ] Install succeeds on a single arm64 control plane (DGX Spark).
- [ ] Install succeeds with amd64 control plane + arm64 worker.
- [ ] Install succeeds with arm64 control plane + amd64 worker.

### 8.6 Versioning

- [ ] The release manifest at
      `raw.githubusercontent.com/thinkube/thinkube-metadata/<TAG>/releases/v<VERSION>.yaml`
      resolves and installs cleanly.
- [ ] The installer reads `channels.json` and surfaces the pinned K8s
      version in the wizard before the deploy step.
- [ ] No reference to `k8s_snap_revisions` survives in any playbook.
- [ ] Contributor fork workflow: with
      `THINKUBE_REPO_URL=https://github.com/<fork>/thinkube.git`
      and `THINKUBE_METADATA_REPO=<fork>/thinkube-metadata` set in the
      environment, `npm run tauri:dev` clones the fork, resolves the
      channel from the fork's metadata repo, and the install proceeds
      end-to-end against the forked code with no other edits required.
- [ ] No user-facing inventory variable names a specific implementation.
      Audit (see §5.5) shows zero hits for user-facing variables
      prefixed with implementation product names (`seaweedfs_*`,
      `juicefs_*`, `mlflow_*`, `gitea_*`, `keycloak_*`, `postgresql_*`,
      `argocd_*`, `bind9_*`) in `inventory/` and `ansible/40_thinkube/`,
      with the exception of implementation-specific tuning
      (documented).

## 9. Development process

### 9.1 Branch layout (all three repos in lockstep)

Same branch name across `thinkube-installer`, `thinkube`, and
`thinkube-control`:

```
main                            # current k8s-snap code, untouched
feature/kubeadm-migration       # all migration work happens here
```

The shared name is load-bearing: the installer's `THINKUBE_BRANCH` env
var (validated at `frontend/src-tauri/backend/app/services/ansible_environment.py:32`)
must match the thinkube branch being tested, so keeping the names
identical avoids cross-branch confusion. For PRs that touch the
thinkube-control flow, the matching `thinkube-control` branch should
also follow the same name.

Sub-branches off `feature/kubeadm-migration` for focused PRs:

```
feature/kubeadm-migration                        # integration branch
├── feature/kubeadm-containerd-role              # PR 1: containerd_install role
├── feature/kubeadm-install-role                 # PR 2: kubeadm_install role
├── feature/kubeadm-cluster-init                 # PR 3: rewrite 10_install_k8s.yaml
├── feature/kubeadm-worker-join                  # PR 4: rewrite 20_join_workers.yaml
├── feature/kubeadm-cilium-helm                  # PR 5: Cilium helm replaces ConfigMap patch
├── feature/kubeadm-rawfile-csi                  # PR 6: install OpenEBS Rawfile standalone
├── feature/kubeadm-gpu-paths                    # PR 7: GPU operator path edits
├── feature/kubeadm-helper-roles                 # PR 8: k8s kubectl → kubectl_bin sweep
├── feature/kubeadm-rollback                     # PR 9: rewrite 19/29 rollbacks
├── feature/kubeadm-release-manifest             # PR 10: thinkube-metadata schemas
└── feature/kubeadm-installer-resolver           # PR 11: installer reads channel
```

PRs land into `feature/kubeadm-migration`, not `main`. Final merge to
`main` happens as one squash that includes all PRs after the full
acceptance suite (section 8) passes on real hardware.

### 9.2 Worktrees

Git worktrees let multiple branches be checked out simultaneously in
sibling directories, sharing the same `.git`. Useful here because you
can keep `main` (current code, available for reference) and
`feature/kubeadm-migration` (work in progress) checked out at the
same time.

Setup, per repo:

```bash
# In each of the three repos, from the existing checkout on main:
cd /home/thinkube/thinkube-installer
git fetch origin
git worktree add ../thinkube-installer-kubeadm -b feature/kubeadm-migration origin/main

cd /home/thinkube/thinkube
git fetch origin
git worktree add ../thinkube-kubeadm -b feature/kubeadm-migration origin/main

cd /home/thinkube/thinkube-control
git fetch origin
git worktree add ../thinkube-control-kubeadm -b feature/kubeadm-migration origin/main
```

Result on disk:

```
/home/thinkube/
├── thinkube-installer/              # main (current k8s-snap code, untouched)
├── thinkube-installer-kubeadm/      # feature/kubeadm-migration worktree
├── thinkube/                        # main
├── thinkube-kubeadm/                # feature/kubeadm-migration worktree
├── thinkube-control/                # main
└── thinkube-control-kubeadm/        # feature/kubeadm-migration worktree
```

Working in a worktree:

```bash
cd /home/thinkube/thinkube-kubeadm
git status                # on feature/kubeadm-migration
# edit ansible/40_thinkube/core/infrastructure/k8s/10_install_k8s.yaml
git add . && git commit && git push origin feature/kubeadm-migration
```

Removing a worktree when the work is merged:

```bash
git worktree remove /home/thinkube/thinkube-kubeadm
git branch -d feature/kubeadm-migration   # locally; remote branch stays
```

The local checkout at `/home/thinkube/thinkube-kubeadm/` is independent
of `/home/thinkube/thinkube/`. Edits in one have no effect on the other
until pushed to origin. This means you can diff side-by-side without
risk of mis-applying a change to the wrong branch.

**Note on the installer's clone behaviour**: the installer always clones
`THINKUBE_BRANCH` fresh from `origin/<branch>` into
`/tmp/thinkube-installer-<uid>/` (verified at
`frontend/src-tauri/backend/app/services/ansible_environment.py:200-242`),
shallow `--depth 1`. **It does not consult any local checkout**. To test
a change, you push it first; the installer fetches from GitHub. This
is the correct boundary — the installer represents the user's flow.

### 9.3 Local testing flow

For an end-to-end test from this development machine, with a target
homelab machine available:

```bash
# 1. Push your work-in-progress to the feature branch
cd /home/thinkube/thinkube-kubeadm
git push origin feature/kubeadm-migration

# 2. Run the installer in dev mode, pointed at the feature branch
cd /home/thinkube/thinkube-installer-kubeadm/frontend
THINKUBE_BRANCH=feature/kubeadm-migration TK_TEST=1 npm run tauri:dev
```

`TK_TEST=1` (validated at `frontend/src-tauri/src/lib.rs:14-29`) disables
the auto-advance between playbooks and adds Test/Rollback buttons. Use
it during migration testing — when a playbook fails, you can iterate
without re-running the whole queue.

For per-playbook isolation while iterating:

```bash
# On the dev machine, with the inventory the installer would build:
cd /home/thinkube/thinkube-kubeadm
./scripts/run_ansible.sh ansible/40_thinkube/core/infrastructure/k8s/10_install_k8s.yaml
```

This bypasses the installer UI and runs the playbook directly against
whatever inventory you point at. Useful when iterating on a single
playbook without restarting the full Tauri app.

### 9.4 Per-PR scope discipline

One concern per PR. Examples of bad scope:

- "Rewrite k8s install AND fix the gateway-api probe" — two unrelated
  changes, blocks review on the slower half.
- "Replace 00-k8s-runc.toml AND change CSI driver" — two structural
  changes, hides which one broke a test.

Examples of right-sized PRs (from section 9.1 sub-branch list above):

- PR 1: add `containerd_install` role. Tests: role applies cleanly on
  a fresh Ubuntu 24.04 VM; `containerd config dump` shows expected
  output.
- PR 3: rewrite `10_install_k8s.yaml` to use kubeadm. Tests: full
  acceptance suite section 8.1, 8.2.
- PR 5: replace Cilium ConfigMap patch with helm values. Tests: 
  `kubectl get cm cilium-config -o yaml | yq '.data.devices'` shows
  the expected device list after install (no separate patch needed).

### 9.5 Pre-merge checklist (final merge to `main`)

- [ ] All 11 sub-branch PRs merged to `feature/kubeadm-migration`
- [ ] Full acceptance suite (section 8) passes on a real two-node
      install (amd64 + arm64 if possible)
- [ ] `KUBEADM_MIGRATION_PLAN.md` (this file) updated to reflect any
      decisions changed during implementation
- [ ] `ALPHA_2_TASKS.md` / `ALPHA_3_TASKS.md` updated: any task that
      assumed k8s-snap behaviour is reworded
- [ ] Release manifest `releases/v1.<MINOR>.<PATCH>+thinkube.0.1.0.yaml`
      committed to `thinkube-metadata`
- [ ] `channels.json` updated to point `latest` (and `stable` if
      acceptance passed cleanly) at the new version
- [ ] Single squash commit to `main` referencing the migration plan

## 10. Decisions made during implementation

This section was originally "open questions." All items below were
decided during Phase 1–2 implementation; preserving the rationale
here so the plan stays a true record.

### Resolved version pins (release manifest `v1.35.5+thinkube.0.1.0`)

1. **Kubernetes 1.35.5**. The initial plan recommended 1.31 as the
   "documented compatibility" floor, but that recommendation was
   wrong: 1.31 would have regressed from the current k8s-snap pin
   of 1.35.0. Empirical evidence (k8s-snap with Cilium 1.19 in
   production; RKE2 v1.35.5 also ships Cilium 1.19) shows K8s 1.35
   + Cilium 1.19 works despite Cilium's CI matrix only documenting
   K8s 1.31-1.34. Picked 1.35.5 (latest patch, released 2026-05-12,
   EOL 2027-02-28) — no functional regression, real EOL runway.

2. **Cilium 1.19.4**. Current stable line; Cilium 1.20 is only
   pre-release. Battle-tested with K8s 1.35 in two production
   distros (RKE2 and the existing k8s-snap installation).

3. **OpenEBS Rawfile 0.13.1**. v0.14.0 (released 4 days before
   migration start) introduced breaking config changes around
   storage pools; v0.13.1 (March 2026) is the most recent stable
   point. v0.13.x is what gets pinned; v0.14 is reserved for a
   later bump after the breaking-change story stabilises.

4. **containerd.io 2.2.4-1**. Latest 2.x from Docker's apt repo.
   Chosen over 1.7.x because: (a) NRI plugin support
   (`io.containerd.cri.v1.runtime`) is required for the planned
   Buildah-on-Kubernetes work in ALPHA_2_TASKS.md, (b) RKE2 v1.35.5
   ships containerd 2.2.3, validating the 2.x line, (c) the
   k8s-snap pain documented in canonical/k8s-snap#2529 was config
   management (snap's hardcoded import path), not containerd 2.x
   itself — with our own `/etc/containerd/config.toml` setting
   `SystemdCgroup = true` on both CRI plugins, the failure class
   cannot reach our users.

5. **Envoy Gateway v1.8.0** + **Gateway API CRDs v1.5.1**. Envoy
   Gateway 1.8 officially supports K8s 1.32-1.35 and requires
   Gateway API v1.5.1 (up from v1.2.1 currently in the playbook).
   Phase 3's gateway-api playbook PR coordinates the CRD bump.

6. **NVIDIA GPU Operator v26.3.1**. Patch bump from v26.3.0 (the
   version currently pinned in `gpu_operator/10_deploy.yaml`). The
   v26.3 line is what's empirically validated on DGX Spark in the
   user's environment — NVIDIA does not publish formal
   K8s-version recommendations for DGX Spark, so the strongest
   evidence is the existing setup's track record.

### Other implementation decisions

7. **Pod CIDR 10.244.0.0/16, Service CIDR 10.96.0.0/12**. Standard
   K8s defaults. /16 pod range with Cilium's /24-per-node cluster-
   pool IPAM gives ~256 nodes × ~250 pods, far above homelab scale.
   No conflict with typical ZeroTier (10.x.x.x/24) or Tailscale
   (100.64.0.0/10) overlays.

8. **`kubeadm init --skip-phases=addon/kube-proxy`**. Cilium with
   `kubeProxyReplacement: true` handles all service routing in
   eBPF. Letting kubeadm install kube-proxy alongside would create
   two competing dataplanes. Critical flag.

9. **Cilium L2 LB via CRDs, not helm values**. The L2-announce
   range is configured via `CiliumLoadBalancerIPPool` and
   `CiliumL2AnnouncementPolicy` resources applied post-helm-install
   (`templates/cilium-l2-lb.yaml.j2`), not via helm values. Cilium
   1.19's helm chart doesn't expose IP pool blocks as values; the
   CRDs are the supported configuration surface. ZeroTier mode
   only — Tailscale mode disables `l2announcements` in the helm
   values and the Tailscale Operator handles Service exposure.

10. **Workers get vanilla `kubectl`/`helm` but no kubeconfig**.
    Operators wanting cluster access SSH to the control plane.
    Worker shell aliases for kubectl also dropped (workers aren't
    where users run kubectl interactively).

11. **containerd sandbox image pinned to
    `registry.k8s.io/pause:3.10`**. Matches what kubeadm 1.35
    expects via `kubeadm config images list`. Documented in
    `containerd_install` role defaults; should bump with K8s minor
    when that changes.

12. **Bootstrap-time vs. post-install Gateway API CRDs** — kept
    current pattern (installed by `gateway-api/10_deploy.yaml`,
    not by `10_install_k8s.yaml`). Separates concerns, smaller
    k8s install playbook.

13. **Talos/k0s-style upgrade playbook** — deferred to post-0.1.0.
    The `releases/v<VERSION>.yaml` schema is forward-compatible
    with an upgrade playbook (it has enough information to know
    "which K8s patch am I going from / to"), so the design isn't
    blocked. Implementation happens after alpha when the user
    base exists.

## 11. Implementation phases

Each phase is one or a few PRs. Each phase exits cleanly — the migration
branch should be in a working state at every phase boundary.

### Phase 1 — Foundation (no behaviour change yet)

1. Add `thinkube-metadata/releases/v1.35.5+thinkube.0.1.0.yaml` ✓
   ([thinkube-metadata#1](https://github.com/thinkube/thinkube-metadata/pull/1))
2. Add `thinkube-metadata/channels.json` (initial: `testing` = the new
   version, everything else `null`) ✓ (same PR)
3. Tag `thinkube-metadata` as `v1.35.5+thinkube.0.1.0` so the manifest
   URL becomes immutably resolvable (done on PR merge)
4. Add `containerd_install` and `kubeadm_install` roles (used by no
   playbook yet) ✓ ([thinkube#12](https://github.com/thinkube/thinkube/pull/12), [thinkube#13](https://github.com/thinkube/thinkube/pull/13))

Exit criteria: existing k8s-snap install still works (no playbooks
touched yet); the new roles apply cleanly when invoked manually.

### Phase 2 — Core cluster install

5. Rewrite `10_install_k8s.yaml` to use the new roles + kubeadm + Cilium
   helm + OpenEBS Rawfile helm
6. Rewrite `20_join_workers.yaml` similarly
7. Rewrite `19_rollback_control.yaml` and `29_rollback_workers.yaml`
8. Delete `11_configure_kubelet_args.yaml` (folded into kubeadm config)

Exit criteria: section 8.1, 8.2, 8.4, 8.5 acceptance tests pass on a
single-node + two-node install.

### Phase 3 — Component path updates

9. GPU operator playbook: path edits + `systemctl restart containerd`
10. dns-server playbook: `ctr` socket edit
11. gateway-api playbook: drop k8s-snap probe
12. Helper roles: `k8s kubectl` → `{{ kubectl_bin }}`
13. Delete `*_to_be_deleted.yaml` files
14. **Variable-rename sweep** (see §5.5): audit user-facing inventory
    variables, rename implementation-named ones to capability-neutral
    (`seaweedfs_endpoint` → `object_storage_endpoint`, etc.). Leave
    implementation-specific tuning variables alone.

Exit criteria: section 8.3 (full application stack) acceptance tests
pass; section 8.6 capability-neutral-naming criterion passes.

### Phase 4 — Installer integration

14. Add `release_resolver.py` to installer backend. Reads
    `THINKUBE_METADATA_REPO` env var (default `thinkube/thinkube-metadata`)
    to build channel + release-manifest URLs.
15. Add `THINKUBE_REPO_URL` env var to
    `ansible_environment.py:31` (default `https://github.com/thinkube/thinkube.git`).
    Sibling to existing `THINKUBE_BRANCH` at line 32.
16. Update `thinkube-control/.../optional_components.py:21` to read
    the same `THINKUBE_METADATA_REPO` env var.
17. Promote `thinkube_monitor_repo` in
    `perses/14_import_dashboards_percli.yaml:50` to `group_vars/all.yml`
    so contributors can override via inventory.
18. New wizard screen (or pre-deploy info) showing pinned versions.
19. Replace hardcoded `k8s_version` literals in playbooks with values
    sourced from the resolved manifest.
20. Update `frontend/package.json` to surface `THINKUBE_CHANNEL` env var
    (default `stable`) alongside `THINKUBE_BRANCH` and the new
    `THINKUBE_REPO_URL` / `THINKUBE_METADATA_REPO`.
21. Write `CONTRIBUTING.md` at the root of `thinkube-installer` and
    `thinkube` documenting the fork-and-test workflow (env vars +
    worktree setup from section 9).

Exit criteria: section 8.6 acceptance tests pass; installer correctly
fetches and installs from the channel server.

### Phase 5 — Docs, release, announce

18. Rewrite k8s/README.md and TROUBLESHOOTING.md
19. Rewrite gpu_operator/README.md (drop `00-k8s-runc.toml` references)
20. Update root README in thinkube-installer to describe the
    distribution framing
21. Cut `v1.<MINOR>.<PATCH>+thinkube.0.1.0` tag on `thinkube`
22. Cut `0.1.0` tag on `thinkube-installer`
23. Update `channels.json` to promote the version to `stable` and
    `latest`
24. Public alpha announcement

Exit criteria: a fresh `thinkube-installer` install on a real DGX Spark
+ amd64 worker, using only the published binaries (no local builds),
completes the full deploy queue end-to-end.

## Appendix A — Source-of-truth facts

These were verified against `main` of each repo at the time this plan
was written, to ground the diff above. If anything in this section
becomes false during implementation, the plan needs to be updated, not
worked around.

- `thinkube` `VERSION` = `0.1.0`
- `thinkube-installer` Cargo + package.json + Tauri = `0.1.0`
- `thinkube-metadata` contains `mirror_images.json` (v1.2.0),
  `models.json`, `optional_components.json`, `repositories.json`. No
  release manifests or channel file yet.
- `THINKUBE_BRANCH` default `main`, shallow `--depth 1` clone to
  `/tmp/thinkube-installer-<uid>/`. The installer **always re-clones**;
  no resume from local edits. Reference:
  `frontend/src-tauri/backend/app/services/ansible_environment.py:32, 200-242`.
- `kubectl_bin` = `~/.local/bin/kubectl` (downloaded from `dl.k8s.io`),
  `helm_bin` = `~/.local/bin/helm` (via `get-helm-3.sh`). Defined in
  `inventory/group_vars/k8s.yml:87-88`. Used by 769 + 121 playbook
  references already.
- `k8s_snap_revisions` is the per-arch revision lookup table (currently
  `amd64: 5046, arm64: 5049`). Lives inline in two playbooks:
  `10_install_k8s.yaml:40-42` and `20_join_workers.yaml:34-36, 431-435`.
- `csi-rawfile-default` is the provisioner-installed StorageClass name;
  `k8s-hostpath` is a thin alias defined in
  `ansible/40_thinkube/core/infrastructure/k8s/files/k8s-hostpath-storageclass.yaml`.
- Three github.com/canonical/k8s-snap issues motivate this migration:
  - #1991 (closed "not planned"): `containerd-base-dir` doesn't
    propagate to the `imports` path
  - #2529 (open): auto-upgrade to v1.35.3 / containerd v2.1.5 broke
    rawfile-csi because `SystemdCgroup` doesn't propagate to the new
    `io.containerd.cri.v1.runtime` plugin
  - kubelet `--root-dir` worker/control mismatch (not filed, fixed via
    workaround in `20_join_workers.yaml:657-689`)
- No CI workflows currently exist in any of the three repos
  (`.github/workflows/` empty or missing). Channel publishing for now is
  a manual `git push` to `thinkube-metadata`; CI automation is a
  post-alpha task.
