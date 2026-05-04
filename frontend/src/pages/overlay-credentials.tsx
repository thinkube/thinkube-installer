/*
 * Copyright 2025 Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  TkCard,
  TkCardContent,
  TkCardHeader,
  TkCardTitle,
} from "thinkube-style/components/cards-data"
import { TkAlert, TkAlertDescription } from "thinkube-style/components/feedback"
import { TkInput, TkLabel } from "thinkube-style/components/forms-inputs"
import { TkButton } from "thinkube-style/components/buttons-badges"
import { TkPageWrapper } from "thinkube-style/components/utilities"
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Loader2,
  CheckCircle2,
} from "lucide-react"
import { cn } from "@/lib/utils"
import axios from "@/utils/axios"

type OverlayProvider = "zerotier" | "tailscale"

interface ZerotierState {
  networkId: string
  apiToken: string
}

interface TailscaleState {
  authKey: string
  apiToken: string
  oauthClientId: string
  oauthClientSecret: string
  gatewayHostname: string
}

export default function OverlayCredentials() {
  const navigate = useNavigate()

  // Provider + cluster name come from the previous step (configuration page).
  const [overlayProvider, setOverlayProvider] = useState<OverlayProvider>("zerotier")
  const [clusterName, setClusterName] = useState<string>("")

  const [zt, setZt] = useState<ZerotierState>({ networkId: "", apiToken: "" })
  const [ts, setTs] = useState<TailscaleState>({
    authKey: "",
    apiToken: "",
    oauthClientId: "",
    oauthClientSecret: "",
    gatewayHostname: "",
  })

  const [showZtToken, setShowZtToken] = useState(false)
  const [showTsAuthKey, setShowTsAuthKey] = useState(false)
  const [showTsApiToken, setShowTsApiToken] = useState(false)
  const [showTsOauthSecret, setShowTsOauthSecret] = useState(false)

  // Verification state — Verify is always read-only.
  const [verifyingZt, setVerifyingZt] = useState(false)
  const [ztVerified, setZtVerified] = useState(false)
  const [ztError, setZtError] = useState("")

  const [verifyingTs, setVerifyingTs] = useState(false)
  const [tsVerified, setTsVerified] = useState(false)
  const [tsError, setTsError] = useState("")

  const [verifyingTsOauth, setVerifyingTsOauth] = useState(false)
  const [tsOauthVerified, setTsOauthVerified] = useState(false)
  const [tsOauthError, setTsOauthError] = useState("")

  // Mutating action — explicit, separate button.
  const [preparingPolicy, setPreparingPolicy] = useState(false)
  const [policyStatus, setPolicyStatus] = useState<{
    kind: "ok" | "err" | ""
    message: string
  }>({ kind: "", message: "" })

  // Tag copy feedback
  const [copiedTag, setCopiedTag] = useState(false)

  // Hydrate from previous step + persisted values.
  useEffect(() => {
    const provider = (sessionStorage.getItem("overlayProvider") || "zerotier") as OverlayProvider
    setOverlayProvider(provider)
    setClusterName(sessionStorage.getItem("clusterName") || "")

    const localCfg = JSON.parse(localStorage.getItem("thinkube-config") || "{}")
    if (provider === "zerotier") {
      setZt({
        networkId: localCfg.zerotierNetworkId || "",
        apiToken: localCfg.zerotierApiToken || "",
      })
    } else {
      setTs({
        authKey: localCfg.tailscaleAuthKey || "",
        apiToken: localCfg.tailscaleApiToken || "",
        oauthClientId: localCfg.tailscaleOauthClientId || "",
        oauthClientSecret: localCfg.tailscaleOauthClientSecret || "",
        gatewayHostname: localCfg.gatewayHostname || "",
      })
    }
  }, [])

  // Reset verification state when credentials change.
  useEffect(() => {
    setZtVerified(false)
    setZtError("")
  }, [zt.networkId, zt.apiToken])

  useEffect(() => {
    setTsVerified(false)
    setTsError("")
    setPolicyStatus({ kind: "", message: "" })
  }, [ts.authKey, ts.apiToken])

  useEffect(() => {
    setTsOauthVerified(false)
    setTsOauthError("")
  }, [ts.oauthClientId, ts.oauthClientSecret])

  const verifyZt = async () => {
    if (!zt.networkId || !zt.apiToken) {
      setZtError("Both Network ID and API token are required")
      return
    }
    setVerifyingZt(true)
    setZtError("")
    try {
      const resp = await axios.post("/api/verify-zerotier", {
        api_token: zt.apiToken,
        network_id: zt.networkId,
      })
      if (resp.data.valid) {
        setZtVerified(true)
      } else {
        setZtVerified(false)
        setZtError(resp.data.message || "Invalid credentials")
      }
    } catch (err: any) {
      setZtVerified(false)
      setZtError(err.response?.data?.detail || "Failed to verify ZeroTier credentials")
    } finally {
      setVerifyingZt(false)
    }
  }

  const verifyTs = async () => {
    if (!ts.authKey || !ts.apiToken) {
      setTsError("Both Auth Key and API Token are required")
      return
    }
    setVerifyingTs(true)
    setTsError("")
    try {
      const resp = await axios.post("/api/verify-tailscale", {
        api_token: ts.apiToken,
        auth_key: ts.authKey,
      })
      if (resp.data.valid) {
        setTsVerified(true)
      } else {
        setTsVerified(false)
        setTsError(resp.data.message || "Invalid credentials")
      }
    } catch (err: any) {
      setTsVerified(false)
      setTsError(err.response?.data?.detail || "Failed to verify Tailscale credentials")
    } finally {
      setVerifyingTs(false)
    }
  }

  const prepareTailnetPolicy = async () => {
    if (!ts.apiToken) {
      setPolicyStatus({ kind: "err", message: "API access token is required first" })
      return
    }
    setPreparingPolicy(true)
    setPolicyStatus({ kind: "", message: "" })
    try {
      const resp = await axios.post("/api/tailscale/ensure-acl-tags", {
        api_token: ts.apiToken,
      })
      if (resp.data.ok) {
        setPolicyStatus({
          kind: "ok",
          message:
            resp.data.message ||
            "Tailnet policy file updated with tag:k8s-operator and tag:k8s",
        })
      } else {
        setPolicyStatus({
          kind: "err",
          message: resp.data.message || "Could not update policy file",
        })
      }
    } catch (err: any) {
      setPolicyStatus({
        kind: "err",
        message: err.response?.data?.detail || err.message || "Could not update policy file",
      })
    } finally {
      setPreparingPolicy(false)
    }
  }

  const verifyTsOauth = async () => {
    if (!ts.oauthClientId || !ts.oauthClientSecret) {
      setTsOauthError("Both Client ID and Client Secret are required")
      return
    }
    setVerifyingTsOauth(true)
    setTsOauthError("")
    try {
      const resp = await axios.post("/api/verify-tailscale-oauth", {
        client_id: ts.oauthClientId,
        client_secret: ts.oauthClientSecret,
      })
      if (resp.data.valid) {
        setTsOauthVerified(true)
      } else {
        setTsOauthVerified(false)
        setTsOauthError(resp.data.message || "Invalid OAuth client")
      }
    } catch (err: any) {
      setTsOauthVerified(false)
      setTsOauthError(
        err.response?.data?.detail || "Failed to verify Tailscale OAuth client",
      )
    } finally {
      setVerifyingTsOauth(false)
    }
  }

  const copyOperatorTag = async () => {
    try {
      await navigator.clipboard.writeText("tag:k8s-operator")
      setCopiedTag(true)
      setTimeout(() => setCopiedTag(false), 2000)
    } catch {
      /* clipboard may be unavailable; ignore */
    }
  }

  const canContinue = useMemo(() => {
    if (overlayProvider === "zerotier") {
      return ztVerified
    }
    return tsVerified && tsOauthVerified
  }, [overlayProvider, ztVerified, tsVerified, tsOauthVerified])

  const handleContinue = async () => {
    // Persist to ~/.env (boundary for the playbook layer), then to
    // localStorage and sessionStorage. Default the gateway hostname to
    // <cluster_name>-gw exactly here so downstream consumers can trust it.
    const localCfg = JSON.parse(localStorage.getItem("thinkube-config") || "{}")
    const savePayload: any = {
      overlayProvider,
      clusterName,
    }
    if (overlayProvider === "zerotier") {
      savePayload.zerotierNetworkId = zt.networkId
      savePayload.zerotierApiToken = zt.apiToken
      Object.assign(localCfg, {
        overlayProvider,
        zerotierNetworkId: zt.networkId,
        zerotierApiToken: zt.apiToken,
      })
      sessionStorage.setItem("zerotierApiToken", zt.apiToken)
      sessionStorage.setItem("zerotierNetworkId", zt.networkId)
    } else {
      const resolvedGatewayHostname = ts.gatewayHostname || `${clusterName}-gw`
      savePayload.tailscaleAuthKey = ts.authKey
      savePayload.tailscaleApiToken = ts.apiToken
      savePayload.tailscaleOauthClientId = ts.oauthClientId
      savePayload.tailscaleOauthClientSecret = ts.oauthClientSecret
      savePayload.gatewayHostname = resolvedGatewayHostname
      Object.assign(localCfg, {
        overlayProvider,
        tailscaleAuthKey: ts.authKey,
        tailscaleApiToken: ts.apiToken,
        tailscaleOauthClientId: ts.oauthClientId,
        tailscaleOauthClientSecret: ts.oauthClientSecret,
        gatewayHostname: resolvedGatewayHostname,
      })
      sessionStorage.setItem("tailscaleAuthKey", ts.authKey)
      sessionStorage.setItem("tailscaleApiToken", ts.apiToken)
      sessionStorage.setItem("tailscaleOauthClientId", ts.oauthClientId)
      sessionStorage.setItem("tailscaleOauthClientSecret", ts.oauthClientSecret)
      sessionStorage.setItem("gatewayHostname", resolvedGatewayHostname)
    }

    try {
      await axios.post("/api/save-configuration", savePayload)
    } catch {
      alert("Failed to save credentials securely. Please try again.")
      return
    }

    localStorage.setItem("thinkube-config", JSON.stringify(localCfg))
    navigate("/overlay-setup")
  }

  return (
    <TkPageWrapper title="Overlay Network Credentials">
      {overlayProvider === "zerotier" && (
        <TkCard className="mb-6">
          <TkCardHeader>
            <TkCardTitle>ZeroTier Credentials</TkCardTitle>
          </TkCardHeader>
          <TkCardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              ZeroTier needs your network ID and an API token with admin
              permission on that network. The installer will use them to
              authorize each cluster node and assign overlay IPs.
            </p>

            <div className="space-y-2">
              <TkLabel htmlFor="ztNetworkId">ZeroTier Network ID</TkLabel>
              <TkInput
                id="ztNetworkId"
                type="text"
                placeholder="16-character network ID"
                value={zt.networkId}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setZt({ ...zt, networkId: e.target.value })
                }
              />
            </div>

            <div className="space-y-2">
              <TkLabel htmlFor="ztApiToken">ZeroTier API Token</TkLabel>
              <div className="relative">
                <TkInput
                  id="ztApiToken"
                  type={showZtToken ? "text" : "password"}
                  placeholder="API token"
                  value={zt.apiToken}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setZt({ ...zt, apiToken: e.target.value })
                  }
                  className="pr-24"
                />
                <div className="absolute inset-y-0 right-0 flex items-center pr-3 gap-2">
                  {zt.networkId && zt.apiToken && (
                    <TkButton
                      type="button"
                      intent="ghost"
                      size="sm"
                      className="h-auto p-1"
                      onClick={verifyZt}
                      disabled={verifyingZt}
                    >
                      {verifyingZt ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : ztVerified ? (
                        <CheckCircle2 className="h-3 w-3 text-success" />
                      ) : (
                        <span className="text-xs">Verify</span>
                      )}
                    </TkButton>
                  )}
                  <TkButton
                    type="button"
                    intent="ghost"
                    size="sm"
                    className="h-auto p-1"
                    onClick={() => setShowZtToken(!showZtToken)}
                  >
                    {showZtToken ? (
                      <EyeOff className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Eye className="h-4 w-4 text-muted-foreground" />
                    )}
                  </TkButton>
                </div>
              </div>
              {ztError && <p className="text-xs text-destructive">{ztError}</p>}
              {ztVerified && (
                <p className="text-xs text-success">
                  ✓ Credentials verified — operator has the access it needs
                </p>
              )}
            </div>
          </TkCardContent>
        </TkCard>
      )}

      {overlayProvider === "tailscale" && (
        <>
          <TkCard className="mb-6">
            <TkCardHeader>
              <TkCardTitle>Tailscale Node Credentials</TkCardTitle>
            </TkCardHeader>
            <TkCardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                These credentials let cluster nodes join your tailnet. The Auth
                Key is consumed once per node by <code>tailscale up</code>; the
                API Access Token is what the installer uses to talk to your
                tailnet's admin API.
              </p>

              <div className="space-y-2">
                <TkLabel htmlFor="tsAuthKey">Tailscale Auth Key</TkLabel>
                <div className="relative">
                  <TkInput
                    id="tsAuthKey"
                    type={showTsAuthKey ? "text" : "password"}
                    placeholder="tskey-auth-..."
                    value={ts.authKey}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setTs({ ...ts, authKey: e.target.value })
                    }
                    className="pr-10"
                  />
                  <TkButton
                    type="button"
                    intent="ghost"
                    size="sm"
                    className="h-auto p-1 absolute inset-y-0 right-0 mr-3"
                    onClick={() => setShowTsAuthKey(!showTsAuthKey)}
                  >
                    {showTsAuthKey ? (
                      <EyeOff className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Eye className="h-4 w-4 text-muted-foreground" />
                    )}
                  </TkButton>
                </div>
              </div>

              <div className="space-y-2">
                <TkLabel htmlFor="tsApiToken">Tailscale API Access Token</TkLabel>
                <div className="relative">
                  <TkInput
                    id="tsApiToken"
                    type={showTsApiToken ? "text" : "password"}
                    placeholder="tskey-api-..."
                    value={ts.apiToken}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setTs({ ...ts, apiToken: e.target.value })
                    }
                    className="pr-24"
                  />
                  <div className="absolute inset-y-0 right-0 flex items-center pr-3 gap-2">
                    {ts.authKey && ts.apiToken && (
                      <TkButton
                        type="button"
                        intent="ghost"
                        size="sm"
                        className="h-auto p-1"
                        onClick={verifyTs}
                        disabled={verifyingTs}
                      >
                        {verifyingTs ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : tsVerified ? (
                          <CheckCircle2 className="h-3 w-3 text-success" />
                        ) : (
                          <span className="text-xs">Verify</span>
                        )}
                      </TkButton>
                    )}
                    <TkButton
                      type="button"
                      intent="ghost"
                      size="sm"
                      className="h-auto p-1"
                      onClick={() => setShowTsApiToken(!showTsApiToken)}
                    >
                      {showTsApiToken ? (
                        <EyeOff className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <Eye className="h-4 w-4 text-muted-foreground" />
                      )}
                    </TkButton>
                  </div>
                </div>
                {tsError && <p className="text-xs text-destructive">{tsError}</p>}
                {tsVerified && (
                  <p className="text-xs text-success">✓ Tailscale credentials verified</p>
                )}
              </div>
            </TkCardContent>
          </TkCard>

          <TkCard className="mb-6">
            <TkCardHeader>
              <TkCardTitle>Tailnet Policy File</TkCardTitle>
            </TkCardHeader>
            <TkCardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                The Tailscale Operator needs two tag definitions in your
                tailnet policy file:
                <code className="ml-1">tag:k8s-operator</code> and{" "}
                <code>tag:k8s</code>. The installer can add them for you using
                your API access token. <em>You must do this before generating
                the OAuth client below</em> — Tailscale's OAuth dialog won't
                let you select <code>tag:k8s-operator</code> until it exists in
                the policy file.
              </p>

              <div className="flex items-center gap-3">
                <TkButton
                  type="button"
                  onClick={prepareTailnetPolicy}
                  disabled={preparingPolicy || !ts.apiToken}
                >
                  {preparingPolicy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Add required tags to my tailnet policy file
                </TkButton>
                {policyStatus.kind === "ok" && (
                  <span className="text-sm text-success flex items-center gap-1">
                    <CheckCircle2 className="h-4 w-4" /> {policyStatus.message}
                  </span>
                )}
              </div>
              {policyStatus.kind === "err" && (
                <p className="text-sm text-destructive">{policyStatus.message}</p>
              )}
              <p className="text-xs text-muted-foreground">
                Uses your API access token. Adds (or merges) the two
                <code> tagOwners</code> entries shown above. Idempotent — safe
                to click again.
              </p>
            </TkCardContent>
          </TkCard>

          <TkCard className="mb-6">
            <TkCardHeader>
              <TkCardTitle>Tailscale Operator Credentials</TkCardTitle>
            </TkCardHeader>
            <TkCardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                The in-cluster operator uses an OAuth client to mint per-device
                auth keys at runtime. This is the one step Tailscale doesn't
                let us automate — about 30 seconds in their console.
              </p>

              <TkAlert>
                <TkAlertDescription>
                  <ol className="text-xs space-y-2 list-decimal pl-4">
                    <li>
                      In the Tailscale admin console go to{" "}
                      <strong>Settings → Trust Credentials</strong>{" "}
                      (
                      <a
                        href="https://login.tailscale.com/admin/settings/oauth"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        direct link
                      </a>
                      ).
                    </li>
                    <li>
                      Click <strong>+ Credential</strong>, choose{" "}
                      <strong>OAuth</strong>, then click{" "}
                      <strong>Continue</strong>.
                    </li>
                    <li>
                      On the scopes screen, leave the dropdown on{" "}
                      <strong>Custom</strong> and check:
                      <ul className="list-disc pl-5 mt-1 space-y-1">
                        <li>
                          Devices → <strong>Core</strong> · ☑ Read · ☑ Write
                        </li>
                        <li>
                          Keys → <strong>Auth Keys</strong> · ☑ Read · ☑ Write
                        </li>
                      </ul>
                      Leave everything else unchecked.
                    </li>
                    <li>
                      Tag for this client:{" "}
                      <code className="font-mono bg-muted px-1 rounded">
                        tag:k8s-operator
                      </code>{" "}
                      <TkButton
                        type="button"
                        intent="ghost"
                        size="sm"
                        className="h-auto p-1 align-middle"
                        onClick={copyOperatorTag}
                      >
                        {copiedTag ? (
                          <CheckCircle2 className="h-3 w-3 text-success" />
                        ) : (
                          <span className="text-xs">Copy</span>
                        )}
                      </TkButton>
                    </li>
                    <li>
                      Click <strong>Generate</strong>. Tailscale shows the
                      Client ID and Secret <em>once</em> — paste them below
                      before closing the dialog.
                    </li>
                  </ol>
                </TkAlertDescription>
              </TkAlert>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <TkLabel htmlFor="tsOauthClientId">OAuth Client ID</TkLabel>
                  <TkInput
                    id="tsOauthClientId"
                    type="text"
                    placeholder="kEXAMPLE..."
                    value={ts.oauthClientId}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setTs({ ...ts, oauthClientId: e.target.value })
                    }
                  />
                </div>

                <div className="space-y-2">
                  <TkLabel htmlFor="tsOauthClientSecret">OAuth Client Secret</TkLabel>
                  <div className="relative">
                    <TkInput
                      id="tsOauthClientSecret"
                      type={showTsOauthSecret ? "text" : "password"}
                      placeholder="tskey-client-..."
                      value={ts.oauthClientSecret}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setTs({ ...ts, oauthClientSecret: e.target.value })
                      }
                      className="pr-24"
                    />
                    <div className="absolute inset-y-0 right-0 flex items-center pr-3 gap-2">
                      {ts.oauthClientId && ts.oauthClientSecret && (
                        <TkButton
                          type="button"
                          intent="ghost"
                          size="sm"
                          className="h-auto p-1"
                          onClick={verifyTsOauth}
                          disabled={verifyingTsOauth}
                        >
                          {verifyingTsOauth ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : tsOauthVerified ? (
                            <CheckCircle2 className="h-3 w-3 text-success" />
                          ) : (
                            <span className="text-xs">Verify</span>
                          )}
                        </TkButton>
                      )}
                      <TkButton
                        type="button"
                        intent="ghost"
                        size="sm"
                        className="h-auto p-1"
                        onClick={() => setShowTsOauthSecret(!showTsOauthSecret)}
                      >
                        {showTsOauthSecret ? (
                          <EyeOff className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <Eye className="h-4 w-4 text-muted-foreground" />
                        )}
                      </TkButton>
                    </div>
                  </div>
                </div>
              </div>
              {tsOauthError && (
                <p className="text-sm text-destructive">{tsOauthError}</p>
              )}
              {tsOauthVerified && (
                <p className="text-sm text-success">
                  ✓ OAuth client verified — operator has the scopes it needs
                </p>
              )}

              <div className="space-y-2 max-w-md">
                <TkLabel htmlFor="gatewayHostname">
                  Gateway hostname on the tailnet
                </TkLabel>
                <TkInput
                  id="gatewayHostname"
                  type="text"
                  placeholder={`${clusterName}-gw`}
                  value={ts.gatewayHostname}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setTs({ ...ts, gatewayHostname: e.target.value })
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Hostname the operator claims for the cluster Gateway device.
                  Leave blank to use <code>{clusterName}-gw</code>.
                </p>
              </div>
            </TkCardContent>
          </TkCard>
        </>
      )}

      <div className="flex justify-between mt-6">
        <TkButton type="button" intent="ghost" onClick={() => navigate("/configuration")}>
          <ChevronLeft className="w-5 h-5 mr-2" />
          Back to Configuration
        </TkButton>
        <TkButton type="button" disabled={!canContinue} onClick={handleContinue}>
          Continue
          <ChevronRight className="w-5 h-5 ml-2" />
        </TkButton>
      </div>
    </TkPageWrapper>
  )
}
