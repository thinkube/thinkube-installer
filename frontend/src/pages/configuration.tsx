/*
 * Copyright 2025 Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useMemo, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { TkCard, TkCardContent, TkCardHeader, TkCardTitle } from "thinkube-style/components/cards-data"
import { TkAlert, TkAlertDescription } from "thinkube-style/components/feedback"
import { TkInput } from "thinkube-style/components/forms-inputs"
import { TkLabel } from "thinkube-style/components/forms-inputs"
import { TkButton } from "thinkube-style/components/buttons-badges"
import { TkPageWrapper } from "thinkube-style/components/utilities"
import {
  TkSelect,
  TkSelectContent,
  TkSelectItem,
  TkSelectTrigger,
  TkSelectValue,
} from "thinkube-style/components/forms-inputs"
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Package,
} from "lucide-react"
import { cn } from "@/lib/utils"
import axios from "@/utils/axios"

// TypeScript Interfaces
interface ConfigData {
  clusterName: string
  domainName: string
  cloudflareToken: string
  overlayProvider: string
  zerotierNetworkId: string
  zerotierApiToken: string
  tailscaleAuthKey: string
  tailscaleApiToken: string
  tailscaleOauthClientId: string
  tailscaleOauthClientSecret: string
  gatewayHostname: string
  githubToken: string
  githubOrg: string
  hfToken: string
}

interface ValidationErrors {
  clusterName: string
  domainName: string
  cloudflareToken: string
  zerotierNetworkId: string
  zerotierApiToken: string
  tailscaleAuthKey: string
  tailscaleApiToken: string
  tailscaleOauthClient: string
  githubToken: string
  githubOrg: string
  hfToken: string
}

export default function Configuration() {
  const navigate = useNavigate()

  const [config, setConfig] = useState<ConfigData>({
    clusterName: 'thinkube',
    domainName: '',
    cloudflareToken: '',
    overlayProvider: 'zerotier',
    zerotierNetworkId: '',
    zerotierApiToken: '',
    tailscaleAuthKey: '',
    tailscaleApiToken: '',
    tailscaleOauthClientId: '',
    tailscaleOauthClientSecret: '',
    gatewayHostname: '',
    githubToken: '',
    githubOrg: '',
    hfToken: ''
  })

  const [errors, setErrors] = useState<ValidationErrors>({
    clusterName: '',
    domainName: '',
    cloudflareToken: '',
    zerotierNetworkId: '',
    zerotierApiToken: '',
    tailscaleAuthKey: '',
    tailscaleApiToken: '',
    tailscaleOauthClient: '',
    githubToken: '',
    githubOrg: '',
    hfToken: ''
  })

  const [showCloudflareToken, setShowCloudflareToken] = useState(false)
  const [showZerotierToken, setShowZerotierToken] = useState(false)
  const [showTailscaleAuthKey, setShowTailscaleAuthKey] = useState(false)
  const [showTailscaleApiToken, setShowTailscaleApiToken] = useState(false)
  const [showTailscaleOauthSecret, setShowTailscaleOauthSecret] = useState(false)
  const [showGithubToken, setShowGithubToken] = useState(false)
  const [showHfToken, setShowHfToken] = useState(false)
  const [showOperatorWalkthrough, setShowOperatorWalkthrough] = useState(false)
  const [tagOwnersStatus, setTagOwnersStatus] = useState<string>('')
  const [copiedTag, setCopiedTag] = useState(false)

  const [verifyingCloudflare, setVerifyingCloudflare] = useState(false)
  const [cloudflareVerified, setCloudflareVerified] = useState(false)
  const [verifyingZerotier, setVerifyingZerotier] = useState(false)
  const [zerotierVerified, setZerotierVerified] = useState(false)
  const [verifyingTailscale, setVerifyingTailscale] = useState(false)
  const [tailscaleVerified, setTailscaleVerified] = useState(false)
  const [verifyingTailscaleOauth, setVerifyingTailscaleOauth] = useState(false)
  const [tailscaleOauthVerified, setTailscaleOauthVerified] = useState(false)
  const [verifyingGithub, setVerifyingGithub] = useState(false)
  const [githubVerified, setGithubVerified] = useState(false)
  const [verifyingHf, setVerifyingHf] = useState(false)
  const [hfVerified, setHfVerified] = useState(false)

  // Load saved configuration on mount
  useEffect(() => {
    const loadConfiguration = async () => {
      try {
        const envResponse = await axios.get('/api/load-configuration')
        if (envResponse.data.exists) {
          const savedConfig = envResponse.data.config

          setConfig(prev => ({
            ...prev,
            ...(savedConfig.cloudflareToken && { cloudflareToken: savedConfig.cloudflareToken }),
            ...(savedConfig.overlayProvider && { overlayProvider: savedConfig.overlayProvider }),
            ...(savedConfig.zerotierApiToken && { zerotierApiToken: savedConfig.zerotierApiToken }),
            ...(savedConfig.zerotierNetworkId && { zerotierNetworkId: savedConfig.zerotierNetworkId }),
            ...(savedConfig.tailscaleAuthKey && { tailscaleAuthKey: savedConfig.tailscaleAuthKey }),
            ...(savedConfig.tailscaleApiToken && { tailscaleApiToken: savedConfig.tailscaleApiToken }),
            ...(savedConfig.tailscaleOauthClientId && {
              tailscaleOauthClientId: savedConfig.tailscaleOauthClientId,
            }),
            ...(savedConfig.tailscaleOauthClientSecret && {
              tailscaleOauthClientSecret: savedConfig.tailscaleOauthClientSecret,
            }),
            ...(savedConfig.gatewayHostname && { gatewayHostname: savedConfig.gatewayHostname }),
            ...(savedConfig.githubToken && { githubToken: savedConfig.githubToken }),
            ...(savedConfig.githubOrg && { githubOrg: savedConfig.githubOrg }),
            ...(savedConfig.hfToken && { hfToken: savedConfig.hfToken }),
            ...(savedConfig.clusterName && { clusterName: savedConfig.clusterName }),
            ...(savedConfig.domainName && { domainName: savedConfig.domainName }),
          }))
        }
      } catch (e) {
        // Configuration loading is optional
      }

      const localConfig = localStorage.getItem('thinkube-config')
      if (localConfig) {
        try {
          const parsed = JSON.parse(localConfig)
          setConfig(prev => ({
            ...prev,
            ...(parsed.domainName && { domainName: parsed.domainName }),
            ...(parsed.clusterName && { clusterName: parsed.clusterName }),
            ...(parsed.overlayProvider && { overlayProvider: parsed.overlayProvider }),
          }))
        } catch (e) {
          // Ignore parse errors
        }
      }
    }

    loadConfiguration()
  }, [])

  // Validation functions
  const isValidClusterName = (name: string) => /^[a-z0-9-]+$/.test(name)
  const isValidDomain = (domain: string) => /^[a-z0-9.-]+$/.test(domain)

  // Validate cluster name
  useEffect(() => {
    if (config.clusterName && !isValidClusterName(config.clusterName)) {
      setErrors(prev => ({ ...prev, clusterName: 'Only lowercase letters, numbers, and hyphens' }))
    } else {
      setErrors(prev => ({ ...prev, clusterName: '' }))
    }
  }, [config.clusterName])

  // Validate domain name
  useEffect(() => {
    if (config.domainName && !isValidDomain(config.domainName)) {
      setErrors(prev => ({ ...prev, domainName: 'Invalid domain name' }))
    } else {
      setErrors(prev => ({ ...prev, domainName: '' }))
    }
  }, [config.domainName])

  // Reset Cloudflare verification when token or domain changes
  useEffect(() => {
    setCloudflareVerified(false)
    setErrors(prev => ({ ...prev, cloudflareToken: '' }))
  }, [config.cloudflareToken, config.domainName])

  // Reset ZeroTier verification when credentials change
  useEffect(() => {
    setZerotierVerified(false)
    setErrors(prev => ({ ...prev, zerotierApiToken: '' }))
  }, [config.zerotierApiToken, config.zerotierNetworkId])

  // Reset Tailscale verification when credentials change
  useEffect(() => {
    setTailscaleVerified(false)
    setTagOwnersStatus('')
    setErrors(prev => ({ ...prev, tailscaleApiToken: '' }))
  }, [config.tailscaleAuthKey, config.tailscaleApiToken])

  // Reset OAuth verification when those credentials change
  useEffect(() => {
    setTailscaleOauthVerified(false)
    setErrors(prev => ({ ...prev, tailscaleOauthClient: '' }))
  }, [config.tailscaleOauthClientId, config.tailscaleOauthClientSecret])

  // Reset GitHub verification when token changes
  useEffect(() => {
    setGithubVerified(false)
    setErrors(prev => ({ ...prev, githubToken: '' }))
  }, [config.githubToken])

  // Reset HuggingFace verification when token changes
  useEffect(() => {
    setHfVerified(false)
    setErrors(prev => ({ ...prev, hfToken: '' }))
  }, [config.hfToken])

  const isValid = useMemo(() => {
    const baseValid = config.clusterName &&
           config.domainName &&
           config.cloudflareToken &&
           config.githubToken &&
           config.githubOrg &&
           !errors.clusterName &&
           !errors.domainName &&
           !errors.githubOrg

    if (config.overlayProvider === 'tailscale') {
      return baseValid && config.tailscaleAuthKey && config.tailscaleApiToken
    }
    return baseValid && config.zerotierNetworkId && config.zerotierApiToken
  }, [config, errors])

  const verifyCloudflare = async () => {
    setVerifyingCloudflare(true)
    setCloudflareVerified(false)
    setErrors(prev => ({ ...prev, cloudflareToken: '' }))

    try {
      const response = await axios.post('/api/verify-cloudflare', {
        token: config.cloudflareToken,
        domain: config.domainName
      })

      if (response.data.valid) {
        setCloudflareVerified(true)
        setErrors(prev => ({ ...prev, cloudflareToken: '' }))
        return true
      } else {
        setErrors(prev => ({
          ...prev,
          cloudflareToken: response.data.message || 'Token does not have access to this domain'
        }))
        setCloudflareVerified(false)
        return false
      }
    } catch (error: any) {
      setErrors(prev => ({
        ...prev,
        cloudflareToken: error.response?.data?.detail || 'Failed to verify Cloudflare token'
      }))
      setCloudflareVerified(false)
      return false
    } finally {
      setVerifyingCloudflare(false)
    }
  }

  const verifyZerotier = async () => {
    if (!config.zerotierApiToken || !config.zerotierNetworkId) {
      setErrors(prev => ({ ...prev, zerotierApiToken: 'Both API token and Network ID are required' }))
      setZerotierVerified(false)
      return false
    }

    setVerifyingZerotier(true)
    setErrors(prev => ({ ...prev, zerotierApiToken: '' }))

    try {
      const response = await axios.post('/api/verify-zerotier', {
        api_token: config.zerotierApiToken,
        network_id: config.zerotierNetworkId
      })

      if (response.data.valid) {
        setZerotierVerified(true)
        setErrors(prev => ({ ...prev, zerotierApiToken: '' }))
        return true
      } else {
        setErrors(prev => ({
          ...prev,
          zerotierApiToken: response.data.message || 'Invalid credentials'
        }))
        setZerotierVerified(false)
        return false
      }
    } catch (error: any) {
      setErrors(prev => ({
        ...prev,
        zerotierApiToken: error.response?.data?.detail || 'Failed to verify ZeroTier credentials'
      }))
      setZerotierVerified(false)
      return false
    } finally {
      setVerifyingZerotier(false)
    }
  }

  const verifyTailscale = async () => {
    if (!config.tailscaleAuthKey || !config.tailscaleApiToken) {
      setErrors(prev => ({ ...prev, tailscaleApiToken: 'Both Auth Key and API Token are required' }))
      setTailscaleVerified(false)
      return false
    }

    setVerifyingTailscale(true)
    setTagOwnersStatus('')
    setErrors(prev => ({ ...prev, tailscaleApiToken: '' }))

    try {
      const response = await axios.post('/api/verify-tailscale', {
        api_token: config.tailscaleApiToken,
        auth_key: config.tailscaleAuthKey
      })

      if (!response.data.valid) {
        setErrors(prev => ({
          ...prev,
          tailscaleApiToken: response.data.message || 'Invalid credentials'
        }))
        setTailscaleVerified(false)
        return false
      }

      setTailscaleVerified(true)
      setErrors(prev => ({ ...prev, tailscaleApiToken: '' }))

      // Once the API token works, idempotently install the operator's
      // required tag ownership in the tailnet policy file. Without this
      // the user can't pick `tag:k8s-operator` when they generate the
      // OAuth client in the next step.
      try {
        const aclResp = await axios.post('/api/tailscale/ensure-acl-tags', {
          api_token: config.tailscaleApiToken,
        })
        if (aclResp.data.ok) {
          setTagOwnersStatus(aclResp.data.message || 'Tailnet policy file prepared')
        } else {
          setTagOwnersStatus(`Could not update policy file: ${aclResp.data.message}`)
        }
      } catch (err: any) {
        setTagOwnersStatus(
          `Could not update policy file: ${err.response?.data?.detail || err.message}`
        )
      }

      return true
    } catch (error: any) {
      setErrors(prev => ({
        ...prev,
        tailscaleApiToken: error.response?.data?.detail || 'Failed to verify Tailscale credentials'
      }))
      setTailscaleVerified(false)
      return false
    } finally {
      setVerifyingTailscale(false)
    }
  }

  const verifyGithub = async () => {
    if (!config.githubToken) {
      setErrors(prev => ({ ...prev, githubToken: 'GitHub token is required' }))
      setGithubVerified(false)
      return false
    }

    setVerifyingGithub(true)
    setErrors(prev => ({ ...prev, githubToken: '' }))

    try {
      const response = await axios.post('/api/verify-github', {
        token: config.githubToken
      })

      if (response.data.valid) {
        setGithubVerified(true)
        setErrors(prev => ({ ...prev, githubToken: '' }))
        return true
      } else {
        setErrors(prev => ({
          ...prev,
          githubToken: response.data.message || 'Invalid GitHub token'
        }))
        setGithubVerified(false)
        return false
      }
    } catch (error: any) {
      setErrors(prev => ({
        ...prev,
        githubToken: error.response?.data?.detail || 'Failed to verify GitHub token'
      }))
      setGithubVerified(false)
      return false
    } finally {
      setVerifyingGithub(false)
    }
  }

  const verifyTailscaleOauth = async () => {
    if (!config.tailscaleOauthClientId || !config.tailscaleOauthClientSecret) {
      setErrors(prev => ({
        ...prev,
        tailscaleOauthClient: 'Both Client ID and Client Secret are required',
      }))
      setTailscaleOauthVerified(false)
      return false
    }

    setVerifyingTailscaleOauth(true)
    setErrors(prev => ({ ...prev, tailscaleOauthClient: '' }))

    try {
      const response = await axios.post('/api/verify-tailscale-oauth', {
        client_id: config.tailscaleOauthClientId,
        client_secret: config.tailscaleOauthClientSecret,
      })

      if (response.data.valid) {
        setTailscaleOauthVerified(true)
        setErrors(prev => ({ ...prev, tailscaleOauthClient: '' }))
        return true
      } else {
        setErrors(prev => ({
          ...prev,
          tailscaleOauthClient: response.data.message || 'Invalid OAuth client',
        }))
        setTailscaleOauthVerified(false)
        return false
      }
    } catch (error: any) {
      setErrors(prev => ({
        ...prev,
        tailscaleOauthClient:
          error.response?.data?.detail || 'Failed to verify Tailscale OAuth client',
      }))
      setTailscaleOauthVerified(false)
      return false
    } finally {
      setVerifyingTailscaleOauth(false)
    }
  }

  const copyOperatorTag = async () => {
    try {
      await navigator.clipboard.writeText('tag:k8s-operator')
      setCopiedTag(true)
      setTimeout(() => setCopiedTag(false), 2000)
    } catch {
      /* clipboard may be unavailable; ignore */
    }
  }

  const verifyHf = async () => {
    if (!config.hfToken) {
      setErrors(prev => ({ ...prev, hfToken: 'HuggingFace token is required' }))
      setHfVerified(false)
      return false
    }

    setVerifyingHf(true)
    setErrors(prev => ({ ...prev, hfToken: '' }))

    try {
      const response = await axios.post('/api/verify-huggingface', {
        token: config.hfToken
      })

      if (response.data.valid) {
        setHfVerified(true)
        setErrors(prev => ({ ...prev, hfToken: '' }))
        return true
      } else {
        setErrors(prev => ({
          ...prev,
          hfToken: response.data.message || 'Invalid HuggingFace token'
        }))
        setHfVerified(false)
        return false
      }
    } catch (error: any) {
      setErrors(prev => ({
        ...prev,
        hfToken: error.response?.data?.detail || 'Failed to verify HuggingFace token'
      }))
      setHfVerified(false)
      return false
    } finally {
      setVerifyingHf(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!isValid) {
      alert('Please fix all validation errors before continuing')
      return
    }

    if (!config.cloudflareToken) {
      alert('Cloudflare API token is required')
      return
    }

    if (!cloudflareVerified) {
      const cloudflareValid = await verifyCloudflare()
      if (!cloudflareValid) {
        alert('Please provide a valid Cloudflare API token with access to your domain')
        return
      }
    }

    if (config.overlayProvider === 'zerotier') {
      if (!config.zerotierApiToken || !config.zerotierNetworkId) {
        alert('ZeroTier API token and Network ID are required')
        return
      }
      if (!zerotierVerified) {
        const zerotierValid = await verifyZerotier()
        if (!zerotierValid) {
          alert('Please provide valid ZeroTier credentials with network access')
          return
        }
      }
    } else {
      if (!config.tailscaleAuthKey || !config.tailscaleApiToken) {
        alert('Tailscale Auth Key and API Token are required')
        return
      }
      if (!tailscaleVerified) {
        const tailscaleValid = await verifyTailscale()
        if (!tailscaleValid) {
          alert('Please provide valid Tailscale credentials')
          return
        }
      }
      if (!config.tailscaleOauthClientId || !config.tailscaleOauthClientSecret) {
        alert(
          'Tailscale Operator OAuth Client ID and Secret are required. ' +
            'Generate one at Tailscale Admin → Trust credentials.',
        )
        return
      }
      if (!tailscaleOauthVerified) {
        const oauthValid = await verifyTailscaleOauth()
        if (!oauthValid) {
          alert('Please provide a valid Tailscale OAuth client for the operator')
          return
        }
      }
    }

    if (config.githubToken && !githubVerified) {
      const githubValid = await verifyGithub()
      if (!githubValid) {
        alert('Please provide a valid GitHub token or leave it empty')
        return
      }
    }

    if (config.hfToken && !hfVerified) {
      const hfValid = await verifyHf()
      if (!hfValid) {
        alert('Please provide a valid HuggingFace token or leave it empty')
        return
      }
    }

    // Resolve the gateway hostname default once, here. Downstream
    // consumers (sessionStorage readers, inventory generator, playbooks)
    // can then trust the value is always populated.
    const resolvedGatewayHostname =
      config.gatewayHostname || `${config.clusterName}-gw`

    const savePayload: any = {
      cloudflareToken: config.cloudflareToken,
      githubToken: config.githubToken,
      hfToken: config.hfToken,
      githubOrg: config.githubOrg,
      clusterName: config.clusterName,
      domainName: config.domainName,
      overlayProvider: config.overlayProvider,
    }
    if (config.overlayProvider === 'zerotier') {
      savePayload.zerotierApiToken = config.zerotierApiToken
      savePayload.zerotierNetworkId = config.zerotierNetworkId
    } else {
      savePayload.tailscaleAuthKey = config.tailscaleAuthKey
      savePayload.tailscaleApiToken = config.tailscaleApiToken
      savePayload.tailscaleOauthClientId = config.tailscaleOauthClientId
      savePayload.tailscaleOauthClientSecret = config.tailscaleOauthClientSecret
      savePayload.gatewayHostname = resolvedGatewayHostname
    }

    try {
      await axios.post('/api/save-configuration', savePayload)
    } catch (error) {
      alert('Failed to save configuration securely. Please try again.')
      return
    }

    const sudoPassword = sessionStorage.getItem('sudoPassword')
    const systemUsername = sessionStorage.getItem('systemUsername')

    const configToSave: any = {
      overlayProvider: config.overlayProvider,
      clusterName: config.clusterName,
      domainName: config.domainName,
      githubOrg: config.githubOrg,
      sudoPassword: sudoPassword,
      systemUsername: systemUsername,
    }
    if (config.overlayProvider === 'zerotier') {
      configToSave.zerotierNetworkId = config.zerotierNetworkId
      configToSave.zerotierApiToken = config.zerotierApiToken
    } else {
      configToSave.tailscaleAuthKey = config.tailscaleAuthKey
      configToSave.tailscaleApiToken = config.tailscaleApiToken
      configToSave.tailscaleOauthClientId = config.tailscaleOauthClientId
      configToSave.tailscaleOauthClientSecret = config.tailscaleOauthClientSecret
      configToSave.gatewayHostname = resolvedGatewayHostname
    }
    localStorage.setItem('thinkube-config', JSON.stringify(configToSave))

    sessionStorage.setItem('overlayProvider', config.overlayProvider)
    sessionStorage.setItem('cloudflareToken', config.cloudflareToken)
    sessionStorage.setItem('domainName', config.domainName)
    sessionStorage.setItem('clusterName', config.clusterName)

    if (config.overlayProvider === 'zerotier') {
      sessionStorage.setItem('zerotierApiToken', config.zerotierApiToken)
      sessionStorage.setItem('zerotierNetworkId', config.zerotierNetworkId)
    } else {
      sessionStorage.setItem('tailscaleAuthKey', config.tailscaleAuthKey)
      sessionStorage.setItem('tailscaleApiToken', config.tailscaleApiToken)
      sessionStorage.setItem('tailscaleOauthClientId', config.tailscaleOauthClientId)
      sessionStorage.setItem('tailscaleOauthClientSecret', config.tailscaleOauthClientSecret)
      sessionStorage.setItem('gatewayHostname', resolvedGatewayHostname)
    }

    if (config.githubToken) {
      sessionStorage.setItem('githubToken', config.githubToken)
      sessionStorage.setItem('githubOrg', config.githubOrg)
    }

    if (config.hfToken) {
      sessionStorage.setItem('hfToken', config.hfToken)
    }

    navigate('/overlay-setup')
  }

  return (
    <TkPageWrapper title="Cluster Configuration">
      <form onSubmit={handleSubmit}>
        {/* Basic Settings */}
        <TkCard className="mb-6">
          <TkCardHeader>
            <TkCardTitle>Basic Settings</TkCardTitle>
          </TkCardHeader>
          <TkCardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <TkLabel htmlFor="clusterName">Cluster Name</TkLabel>
                  <span className="text-xs text-muted-foreground">Name for your Thinkube cluster</span>
                </div>
                <TkInput
                  id="clusterName"
                  type="text"
                  placeholder="thinkube"
                  value={config.clusterName}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfig({ ...config, clusterName: e.target.value })}
                  className={cn(errors.clusterName && "border-destructive")}
                  required
                />
                {errors.clusterName && (
                  <p className="text-xs text-destructive">{errors.clusterName}</p>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <TkLabel htmlFor="domainName">Domain Name</TkLabel>
                  <span className="text-xs text-muted-foreground">Your domain for the cluster</span>
                </div>
                <TkInput
                  id="domainName"
                  type="text"
                  placeholder="thinkube.com"
                  value={config.domainName}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfig({ ...config, domainName: e.target.value })}
                  className={cn(errors.domainName && "border-destructive")}
                  required
                />
                {errors.domainName && (
                  <p className="text-xs text-destructive">{errors.domainName}</p>
                )}
              </div>

              <div className="space-y-2 md:col-span-2">
                <div className="flex items-center justify-between">
                  <TkLabel htmlFor="cloudflareToken">Cloudflare API Token</TkLabel>
                  <span className="text-xs text-muted-foreground">For SSL certificate generation</span>
                </div>
                <div className="relative">
                  <TkInput
                    id="cloudflareToken"
                    type={showCloudflareToken ? 'text' : 'password'}
                    placeholder="Cloudflare API Token"
                    value={config.cloudflareToken}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfig({ ...config, cloudflareToken: e.target.value })}
                    className={cn(
                      "pr-24",
                      errors.cloudflareToken && "border-destructive",
                      cloudflareVerified && "border-success"
                    )}
                  />
                  <div className="absolute inset-y-0 right-0 flex items-center pr-3 gap-2">
                    {config.cloudflareToken && config.domainName && (
                      <TkButton
                        type="button"
                        intent="ghost"
                        size="sm"
                        className="h-auto p-1"
                        onClick={verifyCloudflare}
                        disabled={verifyingCloudflare}
                      >
                        {verifyingCloudflare ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : cloudflareVerified ? (
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
                      onClick={() => setShowCloudflareToken(!showCloudflareToken)}
                    >
                      {showCloudflareToken ? (
                        <EyeOff className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <Eye className="h-4 w-4 text-muted-foreground" />
                      )}
                    </TkButton>
                  </div>
                </div>
                {errors.cloudflareToken && (
                  <p className="text-xs text-destructive">{errors.cloudflareToken}</p>
                )}
                {cloudflareVerified && (
                  <p className="text-xs text-success">✓ Token has access to {config.domainName}</p>
                )}
              </div>
            </div>
          </TkCardContent>
        </TkCard>

        {/* Overlay Network Configuration */}
        <TkCard className="mb-6">
            <TkCardHeader>
              <TkCardTitle>Overlay Network Configuration</TkCardTitle>
            </TkCardHeader>
            <TkCardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Configure overlay networking to connect distributed nodes securely over the internet.
              </p>

              <div className="space-y-2 mb-6">
                <div className="flex items-center justify-between">
                  <TkLabel htmlFor="overlayProvider">Overlay Network Provider</TkLabel>
                  <span className="text-xs text-muted-foreground">Choose your preferred overlay network</span>
                </div>
                <TkSelect
                  value={config.overlayProvider}
                  onValueChange={(value: string) => setConfig({ ...config, overlayProvider: value })}
                >
                  <TkSelectTrigger id="overlayProvider">
                    <TkSelectValue />
                  </TkSelectTrigger>
                  <TkSelectContent>
                    <TkSelectItem value="zerotier">ZeroTier</TkSelectItem>
                    <TkSelectItem value="tailscale">Tailscale</TkSelectItem>
                  </TkSelectContent>
                </TkSelect>
                <p className="text-xs text-muted-foreground">
                  {config.overlayProvider === 'zerotier'
                    ? 'ZeroTier: Software-defined networking with centralized control'
                    : 'Tailscale: WireGuard-based mesh VPN (recommended for DGX Spark)'}
                </p>
              </div>

              {/* ZeroTier Credentials */}
              {config.overlayProvider === 'zerotier' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <TkLabel htmlFor="zerotierNetworkId">ZeroTier Network ID</TkLabel>
                      <span className="text-xs text-muted-foreground">16-character network ID</span>
                    </div>
                    <TkInput
                      id="zerotierNetworkId"
                      type="text"
                      placeholder="16-character network ID"
                      value={config.zerotierNetworkId}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfig({ ...config, zerotierNetworkId: e.target.value })}
                      className={cn(errors.zerotierNetworkId && "border-destructive")}
                    />
                    {errors.zerotierNetworkId && (
                      <p className="text-xs text-destructive">{errors.zerotierNetworkId}</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <TkLabel htmlFor="zerotierApiToken">ZeroTier API Token</TkLabel>
                      <span className="text-xs text-muted-foreground">For automatic node authorization</span>
                    </div>
                    <div className="relative">
                      <TkInput
                        id="zerotierApiToken"
                        type={showZerotierToken ? 'text' : 'password'}
                        placeholder="ZeroTier Central API Token"
                        value={config.zerotierApiToken}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfig({ ...config, zerotierApiToken: e.target.value })}
                        className={cn("pr-24", errors.zerotierApiToken && "border-destructive")}
                      />
                      <div className="absolute inset-y-0 right-0 flex items-center pr-3 gap-2">
                        {config.zerotierApiToken && config.zerotierNetworkId && (
                          <TkButton
                            type="button"
                            intent="ghost"
                            size="sm"
                            className="h-auto p-1"
                            onClick={verifyZerotier}
                            disabled={verifyingZerotier}
                          >
                            {verifyingZerotier ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : zerotierVerified ? (
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
                          onClick={() => setShowZerotierToken(!showZerotierToken)}
                        >
                          {showZerotierToken ? (
                            <EyeOff className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <Eye className="h-4 w-4 text-muted-foreground" />
                          )}
                        </TkButton>
                      </div>
                    </div>
                    {errors.zerotierApiToken && (
                      <p className="text-xs text-destructive">{errors.zerotierApiToken}</p>
                    )}
                    {zerotierVerified && (
                      <p className="text-xs text-success">✓ Token verified with network access</p>
                    )}
                  </div>
                </div>
              )}

              {/* Tailscale Credentials */}
              {config.overlayProvider === 'tailscale' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <TkLabel htmlFor="tailscaleAuthKey">Tailscale Auth Key</TkLabel>
                      <span className="text-xs text-muted-foreground">Auth key from admin console</span>
                    </div>
                    <div className="relative">
                      <TkInput
                        id="tailscaleAuthKey"
                        type={showTailscaleAuthKey ? 'text' : 'password'}
                        placeholder="tskey-auth-..."
                        value={config.tailscaleAuthKey}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfig({ ...config, tailscaleAuthKey: e.target.value })}
                        className={cn("pr-10", errors.tailscaleAuthKey && "border-destructive")}
                      />
                      <TkButton
                        type="button"
                        intent="ghost"
                        size="sm"
                        className="h-auto p-1 absolute inset-y-0 right-0 mr-3"
                        onClick={() => setShowTailscaleAuthKey(!showTailscaleAuthKey)}
                      >
                        {showTailscaleAuthKey ? (
                          <EyeOff className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <Eye className="h-4 w-4 text-muted-foreground" />
                        )}
                      </TkButton>
                    </div>
                    {errors.tailscaleAuthKey && (
                      <p className="text-xs text-destructive">{errors.tailscaleAuthKey}</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <TkLabel htmlFor="tailscaleApiToken">Tailscale API Token</TkLabel>
                      <span className="text-xs text-muted-foreground">For automatic route approval</span>
                    </div>
                    <div className="relative">
                      <TkInput
                        id="tailscaleApiToken"
                        type={showTailscaleApiToken ? 'text' : 'password'}
                        placeholder="tskey-api-..."
                        value={config.tailscaleApiToken}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfig({ ...config, tailscaleApiToken: e.target.value })}
                        className={cn("pr-24", errors.tailscaleApiToken && "border-destructive")}
                      />
                      <div className="absolute inset-y-0 right-0 flex items-center pr-3 gap-2">
                        {config.tailscaleAuthKey && config.tailscaleApiToken && (
                          <TkButton
                            type="button"
                            intent="ghost"
                            size="sm"
                            className="h-auto p-1"
                            onClick={verifyTailscale}
                            disabled={verifyingTailscale}
                          >
                            {verifyingTailscale ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : tailscaleVerified ? (
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
                          onClick={() => setShowTailscaleApiToken(!showTailscaleApiToken)}
                        >
                          {showTailscaleApiToken ? (
                            <EyeOff className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <Eye className="h-4 w-4 text-muted-foreground" />
                          )}
                        </TkButton>
                      </div>
                    </div>
                    {errors.tailscaleApiToken && (
                      <p className="text-xs text-destructive">{errors.tailscaleApiToken}</p>
                    )}
                    {tailscaleVerified && (
                      <p className="text-xs text-success">✓ API token verified</p>
                    )}
                    {tagOwnersStatus && (
                      <p className="text-xs text-muted-foreground">{tagOwnersStatus}</p>
                    )}
                  </div>
                </div>
              )}

              {/* Tailscale Operator credentials (gated on API token verify) */}
              {config.overlayProvider === 'tailscale' && (
                <div className="mt-6 pt-6 border-t border-border">
                  <div className="mb-3">
                    <h3 className="text-sm font-semibold">Operator credentials</h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      The in-cluster operator exposes services on your tailnet. It needs an
                      OAuth client. This is the one step Tailscale does not let us automate
                      — about 30 seconds in their console.
                    </p>
                  </div>

                  <div className="mb-3">
                    <TkButton
                      type="button"
                      intent="ghost"
                      size="sm"
                      onClick={() => setShowOperatorWalkthrough(!showOperatorWalkthrough)}
                    >
                      {showOperatorWalkthrough
                        ? '▼ Hide instructions'
                        : '▶ How to generate an OAuth client'}
                    </TkButton>
                  </div>

                  {showOperatorWalkthrough && (
                    <TkAlert className="mb-4">
                      <TkAlertDescription>
                        <ol className="text-xs space-y-2 list-decimal pl-4">
                          <li>
                            Open{' '}
                            <a
                              href="https://login.tailscale.com/admin/settings/oauth"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary hover:underline"
                            >
                              Tailscale Admin → Trust credentials
                            </a>
                            .
                          </li>
                          <li>Click <strong>+ Credential → OAuth client</strong>.</li>
                          <li>
                            On the scopes screen, leave the dropdown on{' '}
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
                            Tag for this client:{' '}
                            <code className="font-mono bg-muted px-1 rounded">
                              tag:k8s-operator
                            </code>{' '}
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
                            <span className="text-muted-foreground">
                              {' '}
                              (the policy-file definition is{' '}
                              {tailscaleVerified
                                ? 'in place'
                                : 'put in place once your API token verifies'}
                              )
                            </span>
                          </li>
                          <li>
                            Click <strong>Generate</strong>. Tailscale shows the Client ID and
                            Secret <em>once</em> — paste them below before closing the dialog.
                          </li>
                        </ol>
                      </TkAlertDescription>
                    </TkAlert>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <TkLabel htmlFor="tailscaleOauthClientId">OAuth Client ID</TkLabel>
                      <TkInput
                        id="tailscaleOauthClientId"
                        type="text"
                        placeholder="kEXAMPLE..."
                        value={config.tailscaleOauthClientId}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                          setConfig({ ...config, tailscaleOauthClientId: e.target.value })
                        }
                        disabled={!tailscaleVerified}
                        title={
                          tailscaleVerified
                            ? ''
                            : 'Verify your API access token first — that step prepares your tailnet policy file.'
                        }
                        className={cn(
                          errors.tailscaleOauthClient && 'border-destructive',
                          !tailscaleVerified && 'opacity-50 cursor-not-allowed',
                        )}
                      />
                    </div>

                    <div className="space-y-2">
                      <TkLabel htmlFor="tailscaleOauthClientSecret">OAuth Client Secret</TkLabel>
                      <div className="relative">
                        <TkInput
                          id="tailscaleOauthClientSecret"
                          type={showTailscaleOauthSecret ? 'text' : 'password'}
                          placeholder="tskey-client-..."
                          value={config.tailscaleOauthClientSecret}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                            setConfig({
                              ...config,
                              tailscaleOauthClientSecret: e.target.value,
                            })
                          }
                          disabled={!tailscaleVerified}
                          title={
                            tailscaleVerified
                              ? ''
                              : 'Verify your API access token first — that step prepares your tailnet policy file.'
                          }
                          className={cn(
                            'pr-24',
                            errors.tailscaleOauthClient && 'border-destructive',
                            !tailscaleVerified && 'opacity-50 cursor-not-allowed',
                          )}
                        />
                        <div className="absolute inset-y-0 right-0 flex items-center pr-3 gap-2">
                          {tailscaleVerified &&
                            config.tailscaleOauthClientId &&
                            config.tailscaleOauthClientSecret && (
                              <TkButton
                                type="button"
                                intent="ghost"
                                size="sm"
                                className="h-auto p-1"
                                onClick={verifyTailscaleOauth}
                                disabled={verifyingTailscaleOauth}
                              >
                                {verifyingTailscaleOauth ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : tailscaleOauthVerified ? (
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
                            onClick={() => setShowTailscaleOauthSecret(!showTailscaleOauthSecret)}
                            disabled={!tailscaleVerified}
                          >
                            {showTailscaleOauthSecret ? (
                              <EyeOff className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <Eye className="h-4 w-4 text-muted-foreground" />
                            )}
                          </TkButton>
                        </div>
                      </div>
                    </div>
                  </div>
                  {errors.tailscaleOauthClient && (
                    <p className="text-xs text-destructive mt-2">
                      {errors.tailscaleOauthClient}
                    </p>
                  )}
                  {tailscaleOauthVerified && (
                    <p className="text-xs text-success mt-2">
                      ✓ OAuth client verified — operator has the scopes it needs
                    </p>
                  )}

                  <div className="space-y-2 mt-4 max-w-md">
                    <TkLabel htmlFor="gatewayHostname">
                      Gateway hostname on the tailnet
                    </TkLabel>
                    <TkInput
                      id="gatewayHostname"
                      type="text"
                      placeholder={`${config.clusterName}-gw`}
                      value={config.gatewayHostname}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setConfig({ ...config, gatewayHostname: e.target.value })
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      The hostname the operator claims for the cluster Gateway
                      device on your tailnet. Leave blank to use{' '}
                      <code>{`${config.clusterName}-gw`}</code>.
                    </p>
                  </div>
                </div>
              )}
            </TkCardContent>
          </TkCard>

        {/* GitHub Integration */}
        <TkCard className="mb-6">
          <TkCardHeader>
            <TkCardTitle>GitHub Integration (Required)</TkCardTitle>
          </TkCardHeader>
          <TkCardContent>
            <TkAlert className="mb-4 bg-warning/10 border-warning text-warning">
              <AlertTriangle className="h-4 w-4" />
              <TkAlertDescription>
                GitHub access is required for Thinkube core components. Many services depend on Git repositories for configuration and deployment.
              </TkAlertDescription>
            </TkAlert>
            <p className="text-sm mb-4">
              Provide a GitHub personal access token to enable repository operations, GitOps workflows, and CI/CD integration.
            </p>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <TkLabel htmlFor="githubToken">GitHub Personal Access Token</TkLabel>
                <a
                  href="https://github.com/settings/tokens/new?scopes=repo,workflow,packages:write"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline"
                >
                  Generate token →
                </a>
              </div>
              <div className="relative">
                <TkInput
                  id="githubToken"
                  type={showGithubToken ? 'text' : 'password'}
                  placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  value={config.githubToken}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfig({ ...config, githubToken: e.target.value })}
                  className={cn("pr-16 font-mono", errors.githubToken && "border-destructive")}
                />
                <div className="absolute inset-y-0 right-0 flex items-center pr-3 gap-2">
                  {config.githubToken && (
                    <TkButton
                      type="button"
                      intent="ghost"
                      size="sm"
                      className="h-auto p-1"
                      onClick={verifyGithub}
                      disabled={verifyingGithub}
                    >
                      {verifyingGithub ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : githubVerified ? (
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
                    onClick={() => setShowGithubToken(!showGithubToken)}
                  >
                    {showGithubToken ? (
                      <EyeOff className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Eye className="h-4 w-4 text-muted-foreground" />
                    )}
                  </TkButton>
                </div>
              </div>
              {errors.githubToken && (
                <p className="text-xs text-destructive">{errors.githubToken}</p>
              )}
              {githubVerified && (
                <p className="text-xs text-success">✓ Token verified with repository access</p>
              )}
              <p className="text-xs text-muted-foreground">
                Required scopes: repo, workflow, packages:write
              </p>
            </div>

            <div className="space-y-2 mt-4">
              <TkLabel htmlFor="githubOrg">GitHub Organization or Username</TkLabel>
              <TkInput
                id="githubOrg"
                type="text"
                placeholder="your-github-org-or-username"
                value={config.githubOrg}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfig({ ...config, githubOrg: e.target.value })}
                className={cn(errors.githubOrg && "border-destructive")}
              />
              {errors.githubOrg && (
                <p className="text-xs text-destructive">{errors.githubOrg}</p>
              )}
              <p className="text-xs text-muted-foreground">
                The GitHub organization or username where repositories will be created
              </p>
            </div>
          </TkCardContent>
        </TkCard>

        {/* HuggingFace Configuration */}
        <TkCard>
          <TkCardHeader>
            <TkCardTitle className="flex items-center gap-2">
              <Package className="w-5 h-5" />
              HuggingFace Configuration
            </TkCardTitle>
          </TkCardHeader>
          <TkCardContent>
            <TkAlert className="mb-4">
              <TkAlertDescription>
                HuggingFace access is required for mirroring pre-optimized AI models to your local MLflow registry.
              </TkAlertDescription>
            </TkAlert>
            <p className="text-sm mb-4">
              Provide a HuggingFace access token to enable model mirroring from HuggingFace to your local MLflow model registry.
            </p>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <TkLabel htmlFor="hfToken">HuggingFace Access Token</TkLabel>
                <a
                  href="https://huggingface.co/settings/tokens"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline"
                >
                  Generate token →
                </a>
              </div>
              <div className="relative">
                <TkInput
                  id="hfToken"
                  type={showHfToken ? 'text' : 'password'}
                  placeholder="hf_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  value={config.hfToken}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfig({ ...config, hfToken: e.target.value })}
                  className={cn("pr-16 font-mono", errors.hfToken && "border-destructive")}
                />
                <div className="absolute inset-y-0 right-0 flex items-center pr-3 gap-2">
                  {config.hfToken && (
                    <TkButton
                      type="button"
                      intent="ghost"
                      size="sm"
                      className="h-auto p-1"
                      onClick={verifyHf}
                      disabled={verifyingHf}
                    >
                      {verifyingHf ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : hfVerified ? (
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
                    onClick={() => setShowHfToken(!showHfToken)}
                  >
                    {showHfToken ? (
                      <EyeOff className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Eye className="h-4 w-4 text-muted-foreground" />
                    )}
                  </TkButton>
                </div>
              </div>
              {errors.hfToken && (
                <p className="text-xs text-destructive">{errors.hfToken}</p>
              )}
              {hfVerified && (
                <p className="text-xs text-success">✓ Token verified with HuggingFace</p>
              )}
              <p className="text-xs text-muted-foreground">
                Required for downloading models from HuggingFace Hub
              </p>
            </div>
          </TkCardContent>
        </TkCard>

        {/* Navigation */}
        <div className="flex justify-between mt-6">
          <TkButton
            type="button"
            intent="ghost"
            onClick={() => navigate('/role-assignment')}
          >
            <ChevronLeft className="w-5 h-5 mr-2" />
            Back to Role Assignment
          </TkButton>
          <TkButton
            type="submit"
            disabled={!isValid}
          >
            Setup Overlay Network
            <ChevronRight className="w-5 h-5 ml-2" />
          </TkButton>
        </div>
      </form>
    </TkPageWrapper>
  )
}
