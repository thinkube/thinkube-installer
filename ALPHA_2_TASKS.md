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
