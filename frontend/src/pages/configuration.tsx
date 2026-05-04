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
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Loader2,
  CheckCircle2,
  Package,
} from "lucide-react"
import { cn } from "@/lib/utils"
import axios from "@/utils/axios"

// TypeScript Interfaces
interface ConfigData {
  clusterName: string
  domainName: string
  cloudflareToken: string
  githubToken: string
  githubOrg: string
  hfToken: string
}

interface ValidationErrors {
  clusterName: string
  domainName: string
  cloudflareToken: string
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
    githubToken: '',
    githubOrg: '',
    hfToken: ''
  })

  const [errors, setErrors] = useState<ValidationErrors>({
    clusterName: '',
    domainName: '',
    cloudflareToken: '',
    githubToken: '',
    githubOrg: '',
    hfToken: ''
  })

  const [showCloudflareToken, setShowCloudflareToken] = useState(false)
  const [showGithubToken, setShowGithubToken] = useState(false)
  const [showHfToken, setShowHfToken] = useState(false)

  const [verifyingCloudflare, setVerifyingCloudflare] = useState(false)
  const [cloudflareVerified, setCloudflareVerified] = useState(false)
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
    return (
      config.clusterName &&
      config.domainName &&
      config.cloudflareToken &&
      config.githubToken &&
      config.githubOrg &&
      !errors.clusterName &&
      !errors.domainName &&
      !errors.githubOrg
    )
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

    const savePayload: any = {
      cloudflareToken: config.cloudflareToken,
      githubToken: config.githubToken,
      hfToken: config.hfToken,
      githubOrg: config.githubOrg,
      clusterName: config.clusterName,
      domainName: config.domainName,
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
      clusterName: config.clusterName,
      domainName: config.domainName,
      githubOrg: config.githubOrg,
      sudoPassword: sudoPassword,
      systemUsername: systemUsername,
    }
    // Preserve any overlay-related fields written by /overlay-credentials so
    // we don't clobber them when the user revisits this page.
    const existingLocal = JSON.parse(localStorage.getItem('thinkube-config') || '{}')
    localStorage.setItem(
      'thinkube-config',
      JSON.stringify({ ...existingLocal, ...configToSave }),
    )

    sessionStorage.setItem('cloudflareToken', config.cloudflareToken)
    sessionStorage.setItem('domainName', config.domainName)
    sessionStorage.setItem('clusterName', config.clusterName)

    if (config.githubToken) {
      sessionStorage.setItem('githubToken', config.githubToken)
      sessionStorage.setItem('githubOrg', config.githubOrg)
    }

    if (config.hfToken) {
      sessionStorage.setItem('hfToken', config.hfToken)
    }

    navigate('/overlay-credentials')
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

        {/* GitHub Integration */}
        <TkCard className="mb-6">
          <TkCardHeader>
            <TkCardTitle>GitHub Integration (Required)</TkCardTitle>
          </TkCardHeader>
          <TkCardContent>
            <TkAlert className="mb-4">
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
            Continue to Overlay Network
            <ChevronRight className="w-5 h-5 ml-2" />
          </TkButton>
        </div>
      </form>
    </TkPageWrapper>
  )
}
