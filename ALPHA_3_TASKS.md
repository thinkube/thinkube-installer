# Alpha-3 task backlog

Tasks deferred past alpha-2. Each entry is a brief; when implementing, expand into a plan + code as needed.

---

## Promote packages from private to public registries

**Status:** not started

**Depends on:** the alpha-2 mirror task — DevPi / Verdaccio / kellnr / Harbor each need to be running as private registries first, with packages actively published to them, before "promotion" has anything to promote.

**Why:** Once internal libraries (e.g. `thinkube-py`, `@thinkube/control-sdk`, a `thinkube` Cargo crate, a `thinkube-control` container image) are being published to the in-cluster private registries during development, there should be a clean path to release them to the public ecosystem when they're ready. Today that would mean running `twine upload` / `npm publish` / `cargo publish` / `crane copy` by hand against each public registry, with no shared metadata or audit trail. That's both error-prone (which version got promoted? was it tested?) and high-friction (different command per ecosystem). A unified promotion workflow turns "ship a new release" into one git tag + one CI run, with the same shape across all ecosystems Thinkube uses.

**What this looks like per ecosystem:**

- **Python (DevPi → PyPI).** DevPi already has `devpi push` for index-to-index promotion (e.g. `root/dev` → `root/stable`). Extending past the cluster to PyPI is just `twine upload --repository pypi <pkg>` from CI. No new tool needed; the workflow is the wrapper.
- **npm (Verdaccio → npmjs.org).** No built-in promote. Workflow: build/test against Verdaccio, then on tag push, run `npm publish --registry https://registry.npmjs.org/`.
- **Cargo (kellnr → crates.io).** Same shape: `cargo publish --registry kellnr` for dev, `cargo publish` (default crates.io) when promoting.
- **Go (Athens → public git tag).** Promotion is creating a public git tag on a public GitHub repo; Athens isn't really involved on the publish side. Workflow: bump version, tag, push to public repo, `pkg.go.dev` indexes it automatically.
- **Container images (Harbor → public registry).** Harbor has built-in replication rules — set up a rule from `private/<image>` to `ghcr.io/thinkube/<image>` (or wherever) triggered on tag. For a manual one-shot, `crane copy registry.thinkube.com/private/foo:v1 ghcr.io/thinkube/foo:v1`.
- **Helm charts (Harbor → public OCI registry).** Once helm charts are mirrored as OCI artifacts in Harbor (alpha-2 item #1), promotion is `helm push` to the public OCI registry of choice.

**Unifying pieces worth standing up:**

1. **A single `tk release` CLI / Argo Workflow per package** that takes a version + ecosystem and runs the right publish command, with logging to a single audit trail. The ecosystem-specific commands above are stable enough to script once.
2. **Provenance signing** with sigstore / cosign at promotion time, so consumers of the public package can verify it came out of Thinkube's pipeline. This is the right moment to sign — the package is already known-good (passed internal tests) and is about to leave our trust boundary.
3. **A "what's currently promoted vs internal-only" view** on thinkube-control (or a flat manifest committed to a repo). Avoids the "wait, which version of `@thinkube/control-sdk` is on npmjs.org again?" question that always shows up later.

**Things to watch:**

- **Credentials.** Each public registry needs its own publish token (PyPI API token, npm `_authToken`, crates.io `cargo login`, GitHub PAT for ghcr.io). These should land in the same credential storage path the installer already uses for GitHub/Cloudflare/Tailscale tokens — probably a `release-credentials` section on the configuration screen, gated to users who actually intend to publish.
- **Don't promote test artifacts.** Any internal-version-with-RC-tag (e.g. `1.2.0-rc.4`) needs to be filtered out of automatic promotion. Tag-based promotion (`v1.2.0` → promote, `v1.2.0-rc.4` → don't) is the simplest gate.
- **Yanking.** Each public registry has different semantics for retracting a bad release (PyPI yank, npm deprecate, cargo yank). The promote workflow should have a "retract" sibling that does the right thing per ecosystem; not glamorous but spares 3am pages.
- **Estimated effort:** the per-ecosystem publish wiring is a few hours each. The unifying CLI / audit / signing is the bulk of the work — probably a week of focused effort, less if Argo Workflows is the only orchestrator. Pair with the BuildKit/in-cluster-build task from alpha-2 if both land in the same release; the build service is the natural place to also do the promotion.

---

## Per-component self-heal recipes for known-flaky init paths

**Status:** not started

**Depends on:** the alpha-2 "diagnostic-on-failure blocks" task — the diagnostic output is what tells us *which* recoveries are worth encoding. Without it, we'd be guessing.

**Why:** Some failure modes are flaky-but-recoverable: a single targeted recovery action turns a 9-minute timeout-then-fail into a 30-second blip. The canonical example from alpha-1 testing is Cilium-on-new-node: the `config` init container of the Cilium DaemonSet pod silently no-ops its emptyDir write on first init (we have no upstream fix; the binary exits 0 with no error log), the cilium-agent main container then crashloops with `Non-existent configuration directory /tmp/cilium/config-map`, and the only fix is `kubectl delete pod -n kube-system <cilium-pod-on-new-node>` to force a re-init. That worked on retry. It's the kind of recovery the install should do automatically rather than failing the user out and asking them to re-run the add-node flow.

**What changes:**

For each known-flaky init path that has a deterministic recovery, encode the recovery as a "rescue-with-retry" block that:
1. Runs the original wait task with its normal retry budget.
2. On timeout, gathers the diagnostic (using the alpha-2 diagnostic-on-failure pattern) — which is logged regardless of whether the recovery succeeds.
3. Attempts the targeted recovery (e.g. `kubectl delete pod`).
4. Re-runs the wait task with a fresh retry budget.
5. If still failing, fail the play with the *full* diagnostic (both attempts, with timestamps).

Example shape (Cilium-on-new-node):

```yaml
- block:
    - name: Wait for Cilium IPAM (initial)
      shell: cilium status --brief
      retries: 12
      delay: 10
      until: cilium_check.rc == 0
  rescue:
    - name: Gather Cilium diagnostic
      shell: |
        kubectl describe pod ...
        kubectl logs ... --previous
      register: cilium_diag_pre_recovery
    - name: Recovery — delete cilium pod on new node
      shell: kubectl delete pod -n kube-system -l k8s-app=cilium --field-selector spec.nodeName={{ inventory_hostname }}
    - name: Wait for Cilium IPAM (post-recovery)
      shell: cilium status --brief
      retries: 12
      delay: 10
      until: cilium_recheck.rc == 0
      # If THIS fails, no second rescue — fail loud with both diagnostics.
```

**Initial scope (recoveries observed and known-good in alpha-1):**

1. **Cilium agent crashloop on new node** with empty `/tmp/cilium/config-map` → `kubectl delete pod` to re-run init.
2. **Stale CNI bridge IP (10.88.0.x)** on pods scheduled before Cilium initialized on a new node → already handled in `20_join_workers.yaml` as a one-shot pod restart, but worth refactoring into the same shape.
3. **ArgoCD application stuck in `ComparisonError: ssh handshake failed: knownhosts: key is unknown`** after Gitea host key added → already handled at deploy time via `kubectl rollout restart` of the repo-server, but the same self-heal at add-node / re-deploy time would prevent the 75s wait we hit today.

Each new self-heal recipe should be added as recoveries are *observed during testing*, not invented prophylactically. The bar: we've seen this exact failure with this exact recovery work at least twice.

**Things to watch:**

- **Don't recover in a loop.** Exactly one recovery attempt, then fail loud. Otherwise transient flakes turn into infinite hangs.
- **Recovery must be idempotent.** `kubectl delete pod` is safe to run on a healthy pod (just causes a recreation); other recoveries (e.g. `helm uninstall`) are not. Audit each recipe.
- **Log both attempts.** If the recovery succeeds, the user should still see "we noticed X, did Y, recovered" in the playbook output — silent self-heal makes the same failure invisible the next time it happens.
- **Don't hide upstream bugs.** Self-heal is a workaround, not a fix. Each recipe should link to an upstream issue / PR if one exists, or note "needs upstream investigation" if not. The Cilium emptyDir-write case in particular deserves a canonical/k8s bug report regardless of whether we self-heal around it.
- **Estimated effort:** few hours per recipe. The shape is the same as the alpha-2 diagnostic-on-failure pattern — same `block: / rescue:` with one extra recovery step in the middle. Pair with the alpha-2 task; same files, same testing pass.
