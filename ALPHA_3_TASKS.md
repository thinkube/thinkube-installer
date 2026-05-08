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
