# Alpha-2 task backlog

Tasks deferred from alpha-1 to a follow-up release. Each entry is a brief; when implementing, expand into a plan + code as needed.

---

## Decouple install-host user from cluster user

**Status:** not started

**Why:** Today the wizard takes the user that's running the installer (`/api/current-user`) and uses it as both the local sudo verification target and the cluster's `system_username`. That's fine as long as the install-host user matches the user that exists on the cluster nodes. With macOS support landed, the install host is often a personal Mac (`alexmc`, `jane`, etc.) while the cluster nodes use a service-account convention (`thinkube`). Conflating the two forces the user to either rename their Mac account or rename the cluster user — neither is what they want.

**What changes:**

1. `frontend/src/pages/sudo-password.tsx` — add a "Linux user on the cluster nodes" field. Default value = current host user (preserves existing behavior when the user accepts the default). Save to `sessionStorage.systemUsername` from this field instead of from `currentUser`.

2. Same file — skip the local `/api/verify-sudo` POST when the entered cluster user differs from the host user. The password being collected is the cluster user's password, not the host user's, so verifying it against local sudo will always fail.

3. Defer credential verification to the first real use — SSH key distribution against the first target in the discovery / SSH-setup flow. That code path already has a clear failure mode if the password is wrong; surface that as the verification.

4. No backend API change needed. The inventory generator already emits `system_username: config.systemUsername` (see `frontend/src/utils/inventoryGenerator.js:88`); sourcing that from the new field flows through to the rest of the pipeline including the thinkube-control add-node flow (which reads `system_username` from inventory).

**Things to watch:**

- Label the field clearly. "Linux user on the cluster nodes" is more obvious than "system username." Add a hint that says it must already exist on every node and have sudo.
- The current screen also uses `currentUser` to label the local sudo prompt. With user split, the local-sudo path shouldn't be triggered at all when users differ — make sure the screen doesn't show a stale "Your password for thinkube" hint when the host user is alexmc.
- If the installer's local-helper steps actually need host sudo (e.g. installing nmap via apt for discovery), those should happen *before* the cluster user prompt, or use a separate password input. Audit the `/api/check-requirements` and tool-install flow before assuming local sudo is unused.
- Estimated effort: 2-4 hours. Mostly UI plumbing; the inventory and downstream playbooks already key off `system_username`.

---

## Mirror upstream artifacts to harden the install path

**Status:** not started

**Why:** During alpha-1 testing the install pipeline hit transient GitHub release-CDN EOFs four separate times in one afternoon (helm chart fetches for jupyterhub/argo-events, the crane binary in ci-utils, the nerd-fonts wget in code-server-dev), plus a fifth on the GitHub CLI keyring fetch in code-server-dev. All were fixed locally with `--retry`/`--fail` flags, but the structural fragility is the same: a fresh install does dozens of one-shot downloads from `github.com` / `release-assets.githubusercontent.com` / random vendor CDNs, and any one of them dropping the connection at the wrong moment fails the install. Mirroring those artifacts to Harbor / DevPi / Athens / Panamax removes the most common reason a fresh install errors out.

This is **not** an airgap story. A real airgap would also require mirroring apt (100s of GB of Ubuntu archive), conda/mamba (JupyterHub user kernels routinely pull from anaconda.org), NVIDIA's CUDA/cuDNN distribution, npm/yarn, and every curl-fetched binary embedded in user Containerfiles. Mirroring just what Thinkube itself uses for installation/upgrade doesn't make user image builds airgappable. Don't promise that.

**Bonus capability the same daemons enable: private package hosting.** DevPi / Verdaccio / kellnr / Athens / Harbor each serve dual duty — they're caching proxies for the public registry AND they can host packages of your own that never leave your network. Once Thinkube grows internal libraries (e.g. a shared `thinkube-py` or `@thinkube/control-sdk`), you publish them to the same daemon, and consuming code installs them with the standard tooling (`pip install thinkube-py`, `npm install @thinkube/control-sdk`, etc.) — the package looks exactly like a public one to the dependency resolver, but the bytes stay inside the cluster. No extra infrastructure beyond what we'd stand up for the reliability fix. Worth keeping in mind when scoping each daemon's deployment (volume sizing, auth, backup), even if no internal library exists yet on day one.

**What's already mirrored:**
- Container images via **Harbor** (`registry.thinkube.com/library/...` and `thinkube/...`).
- Python packages via **DevPi** (`root/stable` index, transparently caches PyPI).

**What would need adding:**

1. **Helm charts.** Today every `helm install` fetches the chart tarball from the upstream chart repo, which for Argo / JupyterHub / a bunch of others lands on `release-assets.githubusercontent.com`. Mirror these into Harbor as OCI helm-chart artifacts (`registry.thinkube.com/charts/...`) and switch installs to pull from there. Pinned versions get baked into Harbor at build-images time; deploys become network-independent for chart fetch.

2. **Binaries fetched in image builds.** Audit the `ansible/40_thinkube/core/harbor-images/base-images/*.Containerfile.j2` set — crane, k9s, stern, kubectl, code-server (.deb), nerd-fonts zips, argo/argocd CLIs, tea, yq, etc. Pull these once at build-images time, store as OCI artifacts in Harbor (or a small static-blob namespace), and rewrite the Containerfiles to fetch from Harbor instead of the upstream URL. Side benefit: pinned versions across rebuilds, no more "the latest crane release moved" surprises.

3. **Go modules — Athens.** [Athens](https://github.com/gomods/athens) (CNCF sandbox) is the standard transparent proxy for Go modules. Runs as a small Deployment + PVC. Configured client-side with `GOPROXY=https://athens.thinkube.com,https://proxy.golang.org,direct` — Go's built-in fallback chain handles "if Athens has it use cache; if not fetch+cache; if Athens is down, go direct." That fallback is in the language runtime, so the UX is cleaner than DevPi (no per-project `index-url`). Becomes load-bearing the moment any cluster workload is built in Go (controllers, custom operators) — until then it's a nice-to-have.
4. **Cargo crates — Panamax.** [Panamax](https://github.com/panamax-rs/panamax) is the closest DevPi analog for Rust: a transparent mirror of `crates.io` plus the `rustup` toolchain channels, designed for offline use. Configured per-project via `~/.cargo/config.toml` pointing `[source.crates-io]` at the mirror. If we also need to host private crates, [kellnr](https://kellnr.io) is the more featureful option (registry + proxy in one). Same caveat as Athens: only worth standing up once we have actual Rust workloads.

5. **npm packages — Verdaccio.** [Verdaccio](https://verdaccio.org/) (MIT) is the direct DevPi analog for npm: lightweight Node.js daemon, single Deployment + PVC, caches `registry.npmjs.org` on first hit and hosts private scoped packages. Configured client-side in `.npmrc` either as the default `registry=...` or scoped (`@thinkube:registry=...`) so only Thinkube-owned packages route through it. Same caveat: only worth standing up once cluster workloads or user images need npm packages at build time.

**Out of scope:** apt mirror (Ubuntu archive too large to fully cache, and partial caches don't help unknown user image builds), conda/mamba mirror, NVIDIA CUDA/cuDNN, OS install media, ansible-galaxy. These would each need their own mirror story and many have no clean solution. Picking them up would be a separate, much larger initiative — not part of this task.

**Things to watch:**

- The Harbor mirror itself becomes a single point of failure once you depend on it. Make sure backup / restore for the relevant Harbor projects is documented.
- Version refresh becomes a recurring chore — when do you re-pull `crane`, `kubectl`, etc.? Probably tie to a `tk_images rebuild` or similar; document it.
- The `helm pull` + `helm install <local>` pattern is already proved out (used in JupyterHub and now Argo); generalizing into a "fetch all charts to Harbor at build time, install from Harbor at deploy time" wrapper is the bulk of the work for #1.
- Estimated effort: harder than the user-split task. Days, not hours. Helm + binary mirrors are independent, can be done one at a time.

---

## Replace ansible+podman-on-build-host with an in-cluster build service

**Status:** not started

**Why:** Today image builds (harbor-images and any future user CI/CD) work by Ansible delegating `podman build` to a designated build host (the control plane, by default), which then pushes to Harbor. That pattern requires podman to be wired up on whichever node is acting as the build host, doesn't parallelize, and ties build capacity to one machine. Kaniko (the historical Kubernetes-native answer) is deprecated. The modern replacement is BuildKit running in-cluster as a daemon: callers submit a build over gRPC, BuildKit builds and pushes to Harbor, the caller pulls from Harbor. Composes cleanly with the airgap/mirror story (item above) — the entire build path stays inside the cluster, talking to Harbor and DevPi mirrors.

**What the new shape looks like:**

- `buildkitd` runs as a Kubernetes Deployment (rootless preferred; needs cgroup v2 + user namespaces — already available on the platform) with a Service.
- A small thin wrapper (FastAPI / gRPC) accepts build requests `{ context: tarball|git-ref, dockerfile, build-args, target-image }`, dispatches to BuildKit via `buildctl`, returns a job id.
- Argo Workflows (already in the cluster) is the natural orchestrator: a `WorkflowTemplate` per image type, parameterized on context + tag. Caller submits the workflow, polls for completion, pulls the image from Harbor.
- Migration path: keep the existing ansible+podman path operational; introduce the new service in parallel; cut over one Containerfile at a time. The harbor-images set is the obvious first cohort because it's already a fixed catalog.

**What this enables beyond reliability:**

- Parallel builds (multiple BuildKit replicas).
- No "build host" notion — any node with the BuildKit pod scheduled to it works.
- Native buildkit features Thinkube doesn't get today: cache mounts, secret mounts at build time, multi-platform builds via emulation or per-arch nodes.
- A coherent story for *user* CI/CD: same service builds platform images and user-application images, same code path.

**Things to watch:**

- Rootless BuildKit needs `seccomp` / `apparmor` annotations and `securityContext` tuning. Some environments need a privileged fallback. Keep both modes available.
- BuildKit's cache lives in a volume — sizing matters; on shared storage (juicefs/seaweedfs already in cluster) it can be reused across runs.
- Harbor pull-through cache settings need to be tuned so BuildKit pulling base images during a build doesn't hammer dockerhub directly.
- Don't try to reuse the existing podman flow's containers.conf / registries.conf — BuildKit configures registries through its own daemon flags / TOML.
- Estimated effort: significant. The MVP (BuildKit daemon + one WorkflowTemplate that builds python-base) is a few hours; getting the whole harbor-images catalog migrated, with caching dialed in and the ansible playbooks updated, is days. Pair this with the mirror-upstream task above for compounding airgap value.

---

## Sweep `k8s_info` + `until:` polling → `kubectl rollout status`

**Status:** not started

**Why:** During alpha-1 the thinkube-control deploy hit a false-failure because the `Verify backend deployment is running` task polled `k8s_info` for `replicas == readyReplicas` with `retries: 8, delay: 10` — an 80-second ceiling that's narrower than the kaniko build alone (~84s) on a fresh install. The fix in `ansible/40_thinkube/core/thinkube-control/12_deploy.yaml` (commit `ae647dc`) replaced both verify tasks with `kubectl rollout status --timeout=300s`, which returns immediately on real success or real failure (ImagePullBackOff, CrashLoopBackOff, ProgressDeadlineExceeded) instead of polling on a fixed schedule. The polling pattern is the wrong primitive: too short → false negatives, too long → user waits the full timeout on real failures.

**What changes:**

- Grep for the pattern across the playbook tree:
  ```
  grep -rln "kubernetes.core.k8s_info" ansible/ | xargs grep -l "until:"
  ```
  Last count: 131 files use `k8s_info`, 64 use `until:`. Not all are deployment-readiness checks (some wait for CRDs, secrets, custom-resource status fields), so this needs triage, not blind replace.

- For each task that polls a Deployment / StatefulSet / DaemonSet for ready replicas, convert to `kubectl rollout status` with a generous timeout (300s baseline; longer for known-slow components like Harbor or JupyterHub).

- For tasks that poll non-rollout objects (CRDs, secrets, certificates, custom-resource phase fields), keep `k8s_info` + `until:` but audit the retries × delay product against realistic ceilings — most are still too short.

**Things to watch:**

- `kubectl rollout status` requires `kubectl_bin` to be defined in the play. Most playbooks already set it; the few that don't will need it added.
- The exit status of `kubectl rollout status` is the source of truth — drop the `failed_when: false` shims that were masking false-fail UX.
- Some readiness checks gate downstream work via the registered fact (e.g., `when: backend_deployment.resources | length > 0` later in the play). Switching to `command:` loses that fact; either re-fetch with a short `k8s_info` after the rollout completes, or restructure the downstream gate.
- Estimated effort: 1-2 days of careful triage + per-component testing. Do it in batches per component (one PR per `40_thinkube/<area>/`), not as one mega-sweep.
