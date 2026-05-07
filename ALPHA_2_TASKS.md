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

## Mirror upstream artifacts → "build without external network" mode

**Status:** not started

**Why:** During alpha-1 testing the install pipeline hit transient GitHub release-CDN EOFs four separate times in one afternoon (helm chart fetches for jupyterhub/argo-events, the crane binary in ci-utils, the nerd-fonts wget in code-server-dev). All were fixed locally with `--retry`/`--fail` flags, but the structural fragility is the same: a fresh install does dozens of one-shot downloads from `github.com` / `release-assets.githubusercontent.com` / random vendor CDNs, and any one of them dropping the connection at the wrong moment fails the install. Beyond reliability, mirroring also opens a real capability: a "build anything after bootstrap with no external network" mode that's genuinely useful for security-sensitive homelab/research deployments (an actual airgap is harder; this is the much closer "post-bootstrap airgap" variant).

**What's already mirrored:**
- Container images via **Harbor** (`registry.thinkube.com/library/...` and `thinkube/...`).
- Python packages via **DevPi** (`root/stable` index, transparently caches PyPI).

**What would need adding:**

1. **Helm charts.** Today every `helm install` fetches the chart tarball from the upstream chart repo, which for Argo / JupyterHub / a bunch of others lands on `release-assets.githubusercontent.com`. Mirror these into Harbor as OCI helm-chart artifacts (`registry.thinkube.com/charts/...`) and switch installs to pull from there. Pinned versions get baked into Harbor at build-images time; deploys become network-independent for chart fetch.

2. **Binaries fetched in image builds.** Audit the `ansible/40_thinkube/core/harbor-images/base-images/*.Containerfile.j2` set — crane, k9s, stern, kubectl, code-server (.deb), nerd-fonts zips, argo/argocd CLIs, tea, yq, etc. Pull these once at build-images time, store as OCI artifacts in Harbor (or a small static-blob namespace), and rewrite the Containerfiles to fetch from Harbor instead of the upstream URL. Side benefit: pinned versions across rebuilds, no more "the latest crane release moved" surprises.

3. **(Stretch) Apt mirror.** Heavyweight (Ubuntu archive is 100s of GB), but a partial `apt-mirror`-style cache of just the packages Thinkube installs is feasible and would close most of the "build a new image" use case. Probably not worth doing for alpha-2 — flag for beta.

4. **(Out of scope for now)** NVIDIA driver downloads, OS install media, ansible-galaxy collections — these are bootstrap-time concerns, not per-deploy concerns. Real airgap is bigger work.

**Framing for alpha-2:**

Don't sell it as "reliability cleanup." Sell it as "thinkube can rebuild every workload image, redeploy every helm chart, and re-provision every pinned binary without internet, after the initial bootstrap completes." That's a feature for users who care (research orgs, security-sensitive setups, sites with bad ISPs); for everyone else it just removes the failure mode where their install errors out because GitHub had a hiccup.

**Things to watch:**

- The Harbor mirror itself becomes a single point of failure once you depend on it. Make sure backup / restore for the relevant Harbor projects is documented.
- Version refresh becomes a recurring chore — when do you re-pull `crane`, `kubectl`, etc.? Probably tie to a `tk_images rebuild` or similar; document it.
- The `helm pull` + `helm install <local>` pattern is already proved out (used in JupyterHub and now Argo); generalizing into a "fetch all charts to Harbor at build time, install from Harbor at deploy time" wrapper is the bulk of the work for #1.
- Estimated effort: harder than the user-split task. Days, not hours. Helm + binary mirrors are independent, can be done one at a time.
