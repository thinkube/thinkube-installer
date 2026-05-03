# Tailscale Operator Migration Plan

Reference document for the work to make Tailscale a first-class overlay
provider in Thinkube alongside ZeroTier, plus the `metallb_*` → `lb_*`
rename cleanup.

## Goals

1. Make Tailscale a first-class overlay provider end-to-end. Replace the
   brittle subnet-route workaround in `11_setup_tailscale.yaml` with the
   Tailscale Kubernetes Operator + Gateway API.
2. Rename misleading `metallb_*` variables since the actual implementation
   is Cilium's k8s-snap built-in load balancer (no MetalLB is deployed
   anywhere — verified empirically: zero `kind: IPAddressPool`,
   `kind: L2Advertisement`, or `metallb-system` namespace references in
   the playbooks).
3. ZeroTier mode behaves exactly as today after the rename — no functional
   regression.
4. Land changes in dependency order so each phase produces a working
   installer.

## Constraints

- Both providers stay supported. ZeroTier path keeps Cilium L2 mode;
  Tailscale path uses the Operator.
- Variable rename touches both `thinkube` (playbooks) and
  `thinkube-installer` (UI + inventory generator) — pair commits.
- Existing ZeroTier installs upgrade cleanly: backward-compat alias for
  the legacy var names.

## What we know about the Tailscale credentials (locked)

Three Tailscale credentials with distinct roles. All three live on the
configuration page:

| Credential | Purpose | Expires? | Created via |
|---|---|---|---|
| **Auth Key** (`tskey-auth-…`) | Each node uses it to join the tailnet | Yes (configurable) | Tailscale Admin → Keys |
| **API Access Token** (`tskey-api-…`) | Installer uses to verify + edit the policy file via API | Yes (max 90 days) | Tailscale Admin → Keys |
| **OAuth Client** (`tskey-client-…` ID + Secret) | Operator uses to mint per-device auth keys at runtime | **No** (indefinite) | Tailscale Admin → **Trust credentials** → +Credential → OAuth (Devices→Core R+W, Keys→Auth Keys R+W; tag `tag:k8s-operator`) |

**OAuth client creation cannot be automated** — confirmed across multiple
Tailscale API releases. Public API exposes
`POST /api/v2/tailnet/{tailnet}/keys` for *auth keys only*; no endpoint
for OAuth clients exists. This is a deliberate Tailscale design choice.
The OAuth client creation is the **single unautomatable manual step** in
the Tailscale flow.

**Everything else can be automated**: tag definitions in the policy file
via `POST /api/v2/tailnet/{tailnet}/acl`, device/auth-key plumbing inside
the operator, BIND9 wildcard discovery, etc.

---

## Phase 0 — Setup

- **0.1** Confirm Tailscale OAuth client mechanism (done).
- **0.2** Default Gateway hostname pattern: `{{ cluster_name }}-gw`
  (user-overridable).

---

## Phase 1 — Rename `metallb_*` → `lb_*` (no behavior change)

Pure rename, lands first. Both repos in lockstep.

**Mapping:**

- `metallb_ip_start_octet` → `lb_ip_start_octet`
- `metallb_ip_end_octet` → `lb_ip_end_octet`
- `metallb_cidr` → `lb_cidr`
- `metallb_ips` → `lb_ips`
- Task names: "Generate MetalLB IP range …" → "Generate load balancer
  IP range …"
- Doc copy: drop "MetalLB", say "Cilium load balancer".

**`thinkube` repo:**

- **1.1** Rename in `40_thinkube/core/infrastructure/k8s/10_install_k8s.yaml`
  (lines ~803-830).
- **1.2** Rename in `coredns/10_deploy.yaml`, `gateway-api/10_deploy.yaml`,
  `dns-server/10_deploy.yaml`.
- **1.3** Rename in `30_networking/10_setup_zerotier.yaml`,
  `11_setup_tailscale.yaml`, `25_configure_remote_controller.yaml`.
- **1.4** Rename in `30_networking/README.md`.

**`thinkube-installer` repo:**

- **1.5** Rename in `frontend/src/utils/inventoryGenerator.js`
  (`metallbStartOctet` → `lbStartOctet`, etc.). Output `lb_ip_*_octet`
  to inventory.
- **1.6** Rename in `frontend/src/pages/network-configuration.tsx` —
  state fields, labels updated to "Cilium load balancer IP range".
- **1.7** Rename in any backend reference (`configuration.py`,
  `tokens.py` — quick grep first).

**Validation:** ZeroTier dry-run still produces a working deploy.

---

## Phase 2 — Add Tailscale Operator install playbook

- **2.1** **New file**:
  `thinkube/ansible/40_thinkube/core/infrastructure/tailscale-operator/10_deploy.yaml`.
  Contents:
  - Add the `tailscale` Helm repo.
  - Install `tailscale-operator` chart in the `tailscale` namespace.
  - Pass OAuth Client ID + Secret as Helm values (`oauth.clientId`,
    `oauth.clientSecret`) — `no_log` so they don't leak.
  - The `tag:k8s-operator` is attached to the OAuth client itself in the
    Tailscale console (not a Helm value), and the matching `tagOwners`
    are placed in the policy file by the installer via the ACL API.
  - Wait for the `operator` deployment in the `tailscale` namespace to
    become ready.
  - **Skip entirely** when `overlay_provider != 'tailscale'`.
  - Position in chain: must come *after* `k8s/10_install_k8s.yaml`
    (needs a working cluster) and *before* `gateway-api/10_deploy.yaml`
    (which annotates the Gateway Service for the operator to expose).

---

## Phase 3 — Wire the shared Gateway through the operator

- **3.1** Modify `40_thinkube/core/infrastructure/gateway-api/10_deploy.yaml`:
  - When `overlay_provider == 'tailscale'`: annotate the Envoy Gateway
    Service with `tailscale.com/expose: "true"` and
    `tailscale.com/hostname: "{{ gateway_hostname }}"`. Do **not** assign
    `lb_ip` on the Gateway resource — let the operator provision the
    tailnet IP and surface it via
    `Service.status.loadBalancer.ingress[].ip`.
  - When `overlay_provider == 'zerotier'`: keep current behavior unchanged.
- **3.2** Modify `40_thinkube/core/infrastructure/k8s/10_install_k8s.yaml`
  (lines ~803-830):
  - **Skip** `k8s enable load-balancer` and
    `k8s set load-balancer.cidrs … l2-mode=true` when
    `overlay_provider == 'tailscale'`. Cilium remains the CNI; just
    don't enable its L2 LB feature.
  - ZeroTier path unchanged.
- **3.3** Modify `30_networking/11_setup_tailscale.yaml`:
  - **Remove** the `--advertise-routes` subnet-routing workaround
    (current lines ~93-141).
  - Keep the host-level Tailscale install and IP forwarding.

---

## Phase 4 — Dynamic DNS discovery for the Tailscale Gateway IP

- **4.1** Modify `40_thinkube/core/infrastructure/dns-server/10_deploy.yaml`:
  - When `overlay_provider == 'tailscale'`: poll
    `kubectl get svc <gateway-svc> -n envoy-gateway-system -o jsonpath={.status.loadBalancer.ingress[0].ip}`
    in an `until` loop with a sensible timeout.
  - Set fact `effective_gateway_ip` = that result for Tailscale, or
    `primary_ingress_ip` for ZeroTier.
  - Replace the hardcoded `* IN A {{ primary_ingress_ip }}` in the BIND9
    zone (line ~69-72) with `effective_gateway_ip`.
- **4.2** Graceful failure: if the LoadBalancer IP doesn't appear within
  timeout, fail with a clear error pointing to the Tailscale operator
  pod logs and the OAuth client scopes/tag — don't silently fall back.

---

## Phase 5 — Installer UX changes

### 5.1 Configuration page (`frontend/src/pages/configuration.tsx`)

Single screen, two grouped subsections in Tailscale mode. The card
visually progresses as the user advances — operator credentials gated
on API token verify.

```
┌─ Tailscale Configuration ──────────────────────────────────┐
│                                                            │
│ Node credentials                                           │
│  Auth Key             [····················] [👁]          │
│  API Access Token     [····················] [👁] [Verify] │
│  ✓ Verified · Policy file prepared with required tags      │
│                                                            │
│ ─── Operator credentials ────────────────────────────────  │
│                                                            │
│ The in-cluster operator exposes services on your tailnet.  │
│ It needs an OAuth client. This is the one step Tailscale   │
│ does not let us automate — about 30 seconds in their       │
│ console.                                                   │
│                                                            │
│ ▸ How to generate an OAuth client  [expand]                │
│                                                            │
│ [ 🔗 Open Tailscale Trust credentials ] (button)           │
│                                                            │
│ OAuth Client ID     [····················]                 │
│ OAuth Client Secret [····················] [👁] [Verify]   │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

#### 5.1a "How to generate" expandable walkthrough

Numbered checklist with copy-paste affordances and visual emphasis on
the exact form fields:

```
1. Click [Open Tailscale Trust credentials] above (or visit
   https://login.tailscale.com/admin/settings/oauth).

2. Click "+ Credential" → "OAuth client".

3. On the scopes screen:
   • Leave the dropdown on "Custom".
   • Under Devices: check Core   ☑ Read  ☑ Write
   • Under Keys:    check Auth Keys ☑ Read  ☑ Write
   • Leave everything else unchecked.

4. Tag for this client:                        tag:k8s-operator [📋]
   (the policy-file definition for this tag is already in place)

5. Click "Generate".

6. Tailscale shows the Client ID and Secret ONCE.
   Paste them in the fields below before closing the dialog —
   the secret cannot be retrieved later.
```

The `[📋]` next to `tag:k8s-operator` copies the literal string. The
deep-link button targets the OAuth page directly.

#### 5.1b Status-line feedback after each verify

The installer surfaces what it has done and what's wrong, without making
the user dig:

- **After API token verify:** "✓ Verified — added `tag:k8s-operator` and
  `tag:k8s` to your tailnet policy file." Reassures them before they hit
  the Tailscale console — they know the tag is already there to select.
- **After OAuth verify, if scopes are wrong:** precise failure messages,
  e.g. *"Your OAuth client can read devices but can't create them. Go
  back to Trust credentials → edit the client → check Write under
  Devices → Core."* (Don't just say "invalid".)
- **After OAuth verify, if tag is missing/wrong:** *"OAuth client
  succeeded but is not tagged `tag:k8s-operator`. The operator needs
  that tag to mint device keys. Edit the client in Tailscale and assign
  the tag."*

The last two require the verify endpoint to actually call the Tailscale
API and inspect the OAuth client's scopes/tags after exchanging for an
access token, not just confirm the credentials work.

#### 5.1c Disabled-with-tooltip on gated OAuth fields

Until API token verify succeeds, OAuth Client ID / Secret inputs are
disabled. Tooltip on hover: *"Verify your API access token first — that
step prepares your tailnet policy file."*

#### 5.1d Smaller niceties

- **Policy-file dry-run preview** as a hidden affordance: "Show what
  we'll add to your tailnet policy" link expands the exact HuJSON
  snippet so audit-conscious users can see it before clicking Verify.
- **Persist a "this is set up" badge:** on subsequent reinstalls (when
  credentials load from `~/.env`), show "Operator credentials on file"
  without forcing re-verify.
- **Link to Tailscale's operator docs** at the bottom for users who
  want the full background.

### 5.2 Network-configuration page (`frontend/src/pages/network-configuration.tsx`) — Tailscale mode renders less

When `overlayProvider === 'tailscale'`:

- **Hide** overlay CIDR field.
- **Hide** per-host overlay IP pickers.
- **Hide** Cilium load balancer range (`lb_ip_*` octets).
- **Replace** the "Ingress IP Configuration" card with **"Gateway
  Configuration"**:
  - One field: **Gateway hostname** (default `{{ cluster_name }}-gw`,
    editable).

When `overlayProvider === 'zerotier'`: page renders as today (with the
Phase 1 label updates).

### 5.3 Wizard order

Keep network-configuration in the flow for symmetry with ZeroTier (it
just renders less in Tailscale mode). No new wizard step.

### 5.4 New backend endpoints (`frontend/src-tauri/backend/app/api/tailscale.py` — new file)

- `POST /api/tailscale/ensure-acl-tags` — accepts `{api_token, tailnet?}`;
  calls `GET /api/v2/tailnet/-/acl`, parses HuJSON, idempotently merges
  `tagOwners` for `tag:k8s-operator` and `tag:k8s`, posts back with
  `If-Match: <etag>`. Returns success/failure with a clear message.
- `POST /api/verify-tailscale-oauth` — accepts `{client_id, client_secret}`;
  exchanges for an access token at `/api/v2/oauth/token`; **inspects
  scopes and tag** of the resulting access token; returns
  `{valid, message}` with specific actionable detail when scopes/tag
  are wrong (drives the messages in 5.1b).

### 5.5 Persistence (`frontend/src-tauri/backend/app/api/tokens.py`)

Add to the `~/.env` save/load/check paths:

- `TAILSCALE_OAUTH_CLIENT_ID`
- `TAILSCALE_OAUTH_CLIENT_SECRET`
- `GATEWAY_HOSTNAME`

(Existing `TAILSCALE_AUTH_KEY` and `TAILSCALE_API_TOKEN` parity from
earlier work stays.)

### 5.6 Inventory generator (`frontend/src/utils/inventoryGenerator.js` and `overlayInventory.js`)

- Output `tailscale_oauth_client_id` and `tailscale_oauth_client_secret`
  as group vars in Tailscale mode.
- Output `gateway_hostname` (or skip and let playbook default).
- **Skip** `lb_ip_*_octet` / `overlay_cidr` / per-host `overlay_ip` for
  Tailscale mode.
- Schema validation: don't throw on missing overlay-CIDR fields when
  `overlay_provider == 'tailscale'`.

### 5.7 Playbook routing (`frontend/src-tauri/backend/app/api/playbook_stream.py`)

- Add `install-tailscale-operator` →
  `ansible/40_thinkube/core/infrastructure/tailscale-operator/10_deploy.yaml`
  to the
  playbook mapping.

### 5.8 Overlay-setup page (`frontend/src/pages/overlay-setup.tsx`)

- After `install-tailscale` succeeds in Tailscale mode, automatically
  chain `install-tailscale-operator` (same auto-trigger pattern as the
  existing install). Single visible playbook step from the user's POV:
  "Tailscale setup".

---

## Phase 6 — Cross-cutting cleanup

- **6.1** Update CLAUDE.md in both repos to mention the new Tailscale
  flow and the `lb_*` rename.
- **6.2** Update `30_networking/README.md`: document the operator
  playbook and conditional behavior by provider.
- **6.3** Add post-install summary on the installer's `complete.tsx`:
  where the assigned tailnet IP appears in the Tailscale admin, the
  Gateway hostname, and a sample `nslookup` to verify.
- **6.4** Sweep frontend `errors`/labels for stale "MetalLB" or
  "Ingress" references.

---

## Phase 7 — Testing

- **7.1** Fresh ZeroTier install end to end — confirm renamed vars work,
  no functional change.
- **7.2** Fresh Tailscale install end to end — confirm operator installs,
  Gateway gets a tailnet IP, BIND9 picks it up,
  `https://<service>.<domain>` works from a laptop joined to the tailnet.
- **7.3** From an in-cluster pod (e.g. JupyterHub shell): confirm the
  **existing** hairpin DNS path works in Tailscale mode (resolves via
  BIND9 to the tailnet IP, request hairpins back through the Gateway).
  No CoreDNS changes were made.
- **7.4** Reinstall test: tear down, redeploy from same `~/.env`, all
  four Tailscale credentials persist.
- **7.5** OAuth client expiration: confirm operator continues working
  past 90 days (sanity check that we're not accidentally using the API
  token for the operator).
- **7.6** UI guidance walkthrough: validate that a user who has never
  set up the operator before can complete the OAuth client creation
  using only the on-screen instructions (no external docs).

---

## Risks & open questions

- **Operator OAuth client provisioning** is the one human step.
  Mitigated by the inline walkthrough, deep-link button, copy-buttons
  for the tag string, and precise failure messages from the verify
  endpoint when the client is created with wrong scopes/tag.
- **Operator latency** assigning a tailnet IP after the annotation. If
  > ~60s typical, the Phase 4 wait loop needs tuning.
- **Per-service overrides** (annotate a specific Service for its own
  tailnet device) deferred. Easy to add later by surfacing the
  annotation; no architectural change.
- **Cert-manager + tailnet IPs**: Let's Encrypt won't issue for
  `*.ts.net` directly, but DNS-01 for `*.{{ domain_name }}` is
  unaffected (challenge via Cloudflare). Confirm in Phase 7.
- **`Services` scope on the OAuth client**: docs mention it, current
  Tailscale UI doesn't visibly expose a separate Services row — proceed
  without and add at install time if the operator complains.
- **CoreDNS in-cluster shortcut for `*.{{ domain_name }}`** —
  explicitly **out of scope**. The current BIND9-driven hairpin path
  stays. If revisiting later, treat as a separate scoped task with a
  non-prod cluster, dynamic discovery of the Envoy-generated Service
  name, and TLS / HTTPRoute / TCP-listener validation.
- **Trust credentials deep-link URL** (`/admin/settings/oauth`) needs
  verification — Tailscale console paths shift occasionally. Build the
  link with a sensible fallback if the path 404s.

---

## Suggested commit ordering

1. `chore: rename metallb_* vars to lb_* (no behavior change)` —
   Phase 1, both repos paired.
2. `feat(playbooks): add Tailscale Kubernetes Operator install playbook` —
   Phase 2.
3. `feat(playbooks): wire Envoy Gateway through Tailscale Operator in Tailscale mode` —
   Phase 3.
4. `feat(playbooks): discover BIND9 wildcard IP from Gateway Service in Tailscale mode` —
   Phase 4.
5. `feat(installer): collect Tailscale operator OAuth client + Gateway hostname` —
   Phase 5.1, 5.4–5.7.
6. `feat(installer): inline walkthrough + status feedback for OAuth client setup` —
   Phase 5.1a, 5.1b, 5.1c, 5.1d.
7. `feat(installer): hide overlay CIDR pickers in Tailscale mode, rename Ingress card to Gateway` —
   Phase 5.2.
8. `chore: docs + cleanup pass` — Phase 6.
