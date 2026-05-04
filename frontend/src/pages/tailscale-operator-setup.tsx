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
import axios from "@/utils/axios"

export default function TailscaleOperatorSetup() {
  const navigate = useNavigate()

  const [clusterName, setClusterName] = useState<string>("")

  const [oauthClientId, setOauthClientId] = useState("")
  const [oauthClientSecret, setOauthClientSecret] = useState("")
  const [gatewayHostname, setGatewayHostname] = useState("")
  const [showSecret, setShowSecret] = useState(false)

  const [verifying, setVerifying] = useState(false)
  const [verified, setVerified] = useState(false)
  const [verifyError, setVerifyError] = useState("")

  const [copiedTag, setCopiedTag] = useState(false)
  const [continueError, setContinueError] = useState("")

  // Hydrate. The user got here from /overlay-credentials in Tailscale mode,
  // so tag:k8s-operator + tag:k8s are already in their tailnet's policy
  // file. Pull persisted credentials from ~/.env (durable) and overlay
  // any in-progress wizard edits from localStorage.
  useEffect(() => {
    const hydrate = async () => {
      setClusterName(sessionStorage.getItem("clusterName") || "")
      let envCfg: any = {}
      try {
        const resp = await axios.get("/api/load-configuration")
        if (resp.data.exists) envCfg = resp.data.config
      } catch {
        /* load is optional */
      }
      const localCfg = JSON.parse(localStorage.getItem("thinkube-config") || "{}")
      const merged = { ...envCfg, ...localCfg }
      setOauthClientId(merged.tailscaleOauthClientId || "")
      setOauthClientSecret(merged.tailscaleOauthClientSecret || "")
      setGatewayHostname(merged.gatewayHostname || "")
    }
    hydrate()
  }, [])

  // Reset verification when credentials change.
  useEffect(() => {
    setVerified(false)
    setVerifyError("")
  }, [oauthClientId, oauthClientSecret])

  const verifyOauth = async (): Promise<boolean> => {
    if (!oauthClientId || !oauthClientSecret) {
      setVerifyError("Both Client ID and Client Secret are required")
      return false
    }
    setVerifying(true)
    setVerifyError("")
    try {
      const resp = await axios.post("/api/verify-tailscale-oauth", {
        client_id: oauthClientId,
        client_secret: oauthClientSecret,
      })
      if (resp.data.valid) {
        setVerified(true)
        return true
      }
      setVerified(false)
      setVerifyError(resp.data.message || "Invalid OAuth client")
      return false
    } catch (err: any) {
      setVerified(false)
      setVerifyError(
        err.response?.data?.detail || "Failed to verify Tailscale OAuth client",
      )
      return false
    } finally {
      setVerifying(false)
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

  // Continue is enabled as soon as both fields are filled in. If the
  // OAuth client hasn't been verified yet, handleContinue runs the
  // verify automatically and only blocks if the API rejects it.
  const canContinue = useMemo(
    () => !!oauthClientId && !!oauthClientSecret,
    [oauthClientId, oauthClientSecret],
  )

  const handleContinue = async () => {
    setContinueError("")

    if (!verified) {
      const ok = await verifyOauth()
      if (!ok) return
    }

    const resolvedGatewayHostname = gatewayHostname || `${clusterName}-gw`

    const localCfg = JSON.parse(localStorage.getItem("thinkube-config") || "{}")
    const savePayload: any = {
      tailscaleOauthClientId: oauthClientId,
      tailscaleOauthClientSecret: oauthClientSecret,
      gatewayHostname: resolvedGatewayHostname,
    }
    Object.assign(localCfg, savePayload)

    try {
      await axios.post("/api/save-configuration", savePayload)
    } catch {
      setContinueError("Failed to save credentials securely. Please try again.")
      return
    }

    localStorage.setItem("thinkube-config", JSON.stringify(localCfg))
    sessionStorage.setItem("tailscaleOauthClientId", oauthClientId)
    sessionStorage.setItem("tailscaleOauthClientSecret", oauthClientSecret)
    sessionStorage.setItem("gatewayHostname", resolvedGatewayHostname)
    navigate("/overlay-setup")
  }

  return (
    <TkPageWrapper title="Tailscale Operator Setup">
      <TkCard className="mb-6">
        <TkCardHeader>
          <TkCardTitle>Generate the Operator's OAuth Client</TkCardTitle>
        </TkCardHeader>
        <TkCardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            The in-cluster Tailscale Operator uses an OAuth client to mint
            per-device auth keys at runtime. This is the one step Tailscale
            doesn't let us automate — about 30 seconds in their console.
            Your tailnet's policy file already has the
            <code className="ml-1">tag:k8s-operator</code> definition the
            OAuth dialog needs.
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
                  Click <strong>Generate</strong>. Tailscale shows the Client
                  ID and Secret <em>once</em> — paste them below before
                  closing the dialog.
                </li>
              </ol>
            </TkAlertDescription>
          </TkAlert>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <TkLabel htmlFor="oauthClientId">OAuth Client ID</TkLabel>
              <TkInput
                id="oauthClientId"
                type="text"
                placeholder="kEXAMPLE..."
                value={oauthClientId}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setOauthClientId(e.target.value)
                }
              />
            </div>

            <div className="space-y-2">
              <TkLabel htmlFor="oauthClientSecret">OAuth Client Secret</TkLabel>
              <div className="relative">
                <TkInput
                  id="oauthClientSecret"
                  type={showSecret ? "text" : "password"}
                  placeholder="tskey-client-..."
                  value={oauthClientSecret}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setOauthClientSecret(e.target.value)
                  }
                  className="pr-24"
                />
                <div className="absolute inset-y-0 right-0 flex items-center pr-3 gap-2">
                  {oauthClientId && oauthClientSecret && (
                    <TkButton
                      type="button"
                      intent="ghost"
                      size="sm"
                      className="h-auto p-1"
                      onClick={verifyOauth}
                      disabled={verifying}
                    >
                      {verifying ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : verified ? (
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
                    onClick={() => setShowSecret(!showSecret)}
                  >
                    {showSecret ? (
                      <EyeOff className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Eye className="h-4 w-4 text-muted-foreground" />
                    )}
                  </TkButton>
                </div>
              </div>
            </div>
          </div>
          {verifyError && (
            <p className="text-sm text-destructive">{verifyError}</p>
          )}
          {verified && (
            <p className="text-sm text-success">
              ✓ OAuth client verified — operator has the scopes it needs
            </p>
          )}
        </TkCardContent>
      </TkCard>

      <TkCard className="mb-6">
        <TkCardHeader>
          <TkCardTitle>Cluster Gateway Hostname</TkCardTitle>
        </TkCardHeader>
        <TkCardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">
            The hostname the operator will claim for the cluster Gateway
            device on your tailnet. Reachable as
            <code className="ml-1">
              {(gatewayHostname || `${clusterName}-gw`) + ".<tailnet>.ts.net"}
            </code>
            .
          </p>
          <TkInput
            id="gatewayHostname"
            type="text"
            placeholder={`${clusterName}-gw`}
            value={gatewayHostname}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setGatewayHostname(e.target.value)
            }
            className="max-w-md"
          />
          <p className="text-xs text-muted-foreground">
            Leave blank to use <code>{clusterName}-gw</code>.
          </p>
        </TkCardContent>
      </TkCard>

      {continueError && (
        <TkAlert className="bg-destructive/10 text-destructive border-destructive/20 mb-4">
          <TkAlertDescription>{continueError}</TkAlertDescription>
        </TkAlert>
      )}

      <div className="flex justify-between mt-6">
        <TkButton
          type="button"
          intent="ghost"
          onClick={() => navigate("/overlay-credentials")}
        >
          <ChevronLeft className="w-5 h-5 mr-2" />
          Back to Overlay Network
        </TkButton>
        <TkButton type="button" disabled={!canContinue} onClick={handleContinue}>
          Continue
          <ChevronRight className="w-5 h-5 ml-2" />
        </TkButton>
      </div>
    </TkPageWrapper>
  )
}
