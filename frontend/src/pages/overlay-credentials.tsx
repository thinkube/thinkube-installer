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
import {
  TkInput,
  TkLabel,
  TkSelect,
  TkSelectContent,
  TkSelectItem,
  TkSelectTrigger,
  TkSelectValue,
} from "thinkube-style/components/forms-inputs"
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
}

export default function OverlayCredentials() {
  const navigate = useNavigate()

  // Provider + cluster name come from the previous step (configuration page).
  const [overlayProvider, setOverlayProvider] = useState<OverlayProvider>("zerotier")
  const [clusterName, setClusterName] = useState<string>("")

  const [zt, setZt] = useState<ZerotierState>({ networkId: "", apiToken: "" })
  const [ts, setTs] = useState<TailscaleState>({ authKey: "", apiToken: "" })

  const [showZtToken, setShowZtToken] = useState(false)
  const [showTsAuthKey, setShowTsAuthKey] = useState(false)
  const [showTsApiToken, setShowTsApiToken] = useState(false)

  // Verification state — Verify is always read-only.
  const [verifyingZt, setVerifyingZt] = useState(false)
  const [ztVerified, setZtVerified] = useState(false)
  const [ztError, setZtError] = useState("")

  const [verifyingTs, setVerifyingTs] = useState(false)
  const [tsVerified, setTsVerified] = useState(false)
  const [tsError, setTsError] = useState("")

  // Continue-time state: Continue saves credentials AND (in TS mode) calls
  // ensure-acl-tags before navigating. The button label is explicit about
  // what it does so this isn't a hidden side effect.
  const [continuing, setContinuing] = useState(false)
  const [continueError, setContinueError] = useState("")

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
      })
    }
  }, [])

  // Reset verification state when credentials change.
  useEffect(() => {
    setZtVerified(false)
    setZtError("")
    setContinueError("")
  }, [zt.networkId, zt.apiToken])

  useEffect(() => {
    setTsVerified(false)
    setTsError("")
    setContinueError("")
  }, [ts.authKey, ts.apiToken])

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

  const canContinue = useMemo(() => {
    if (overlayProvider === "zerotier") return ztVerified
    return tsVerified
  }, [overlayProvider, ztVerified, tsVerified])

  const handleContinue = async () => {
    setContinuing(true)
    setContinueError("")
    const localCfg = JSON.parse(localStorage.getItem("thinkube-config") || "{}")
    const savePayload: any = { overlayProvider, clusterName }

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
      savePayload.tailscaleAuthKey = ts.authKey
      savePayload.tailscaleApiToken = ts.apiToken
      Object.assign(localCfg, {
        overlayProvider,
        tailscaleAuthKey: ts.authKey,
        tailscaleApiToken: ts.apiToken,
      })
      sessionStorage.setItem("tailscaleAuthKey", ts.authKey)
      sessionStorage.setItem("tailscaleApiToken", ts.apiToken)
    }

    try {
      await axios.post("/api/save-configuration", savePayload)
    } catch {
      setContinuing(false)
      setContinueError("Failed to save credentials securely. Please try again.")
      return
    }
    localStorage.setItem("thinkube-config", JSON.stringify(localCfg))

    // In Tailscale mode, prepare the tailnet policy file *as part of
    // advancing*. The Continue button label says it does this. The tag
    // definitions are a hard prerequisite for the next screen (the OAuth
    // client picker won't list tag:k8s-operator otherwise), so this is a
    // logical part of "advance" — not a hidden side effect.
    if (overlayProvider === "tailscale") {
      try {
        const resp = await axios.post("/api/tailscale/ensure-acl-tags", {
          api_token: ts.apiToken,
        })
        if (!resp.data.ok) {
          setContinuing(false)
          setContinueError(
            resp.data.message ||
              "Could not update tailnet policy file with required tags.",
          )
          return
        }
      } catch (err: any) {
        setContinuing(false)
        setContinueError(
          err.response?.data?.detail ||
            err.message ||
            "Could not update tailnet policy file with required tags.",
        )
        return
      }
      navigate("/tailscale-operator-setup")
      return
    }

    navigate("/overlay-setup")
  }

  return (
    <TkPageWrapper title="Overlay Network">
      <TkCard className="mb-6">
        <TkCardHeader>
          <TkCardTitle>Overlay Network Provider</TkCardTitle>
        </TkCardHeader>
        <TkCardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Choose how cluster nodes will be connected. The choice drives
            which credentials you fill in below.
          </p>
          <TkSelect
            value={overlayProvider}
            onValueChange={(value: string) => {
              const next = value as OverlayProvider
              setOverlayProvider(next)
              sessionStorage.setItem("overlayProvider", next)
            }}
          >
            <TkSelectTrigger id="overlayProviderSelect">
              <TkSelectValue />
            </TkSelectTrigger>
            <TkSelectContent>
              <TkSelectItem value="zerotier">ZeroTier</TkSelectItem>
              <TkSelectItem value="tailscale">Tailscale</TkSelectItem>
            </TkSelectContent>
          </TkSelect>
          <p className="text-xs text-muted-foreground">
            {overlayProvider === "zerotier"
              ? "ZeroTier: software-defined networking with centralized control."
              : "Tailscale: WireGuard-based mesh VPN (recommended for DGX Spark)."}
          </p>
        </TkCardContent>
      </TkCard>

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

        </>
      )}

      {continueError && (
        <TkAlert className="bg-destructive/10 text-destructive border-destructive/20 mb-4">
          <TkAlertDescription>{continueError}</TkAlertDescription>
        </TkAlert>
      )}

      {overlayProvider === "tailscale" && (
        <p className="text-xs text-muted-foreground text-right mb-2">
          Continue will add <code>tag:k8s-operator</code> and{" "}
          <code>tag:k8s</code> to your tailnet policy file (required by the
          operator).
        </p>
      )}

      <div className="flex justify-between mt-2">
        <TkButton type="button" intent="ghost" onClick={() => navigate("/configuration")}>
          <ChevronLeft className="w-5 h-5 mr-2" />
          Back to Configuration
        </TkButton>
        <TkButton
          type="button"
          disabled={!canContinue || continuing}
          onClick={handleContinue}
        >
          {continuing && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          {overlayProvider === "tailscale"
            ? "Continue (sets up tailnet policy)"
            : "Continue"}
          <ChevronRight className="w-5 h-5 ml-2" />
        </TkButton>
      </div>
    </TkPageWrapper>
  )
}
