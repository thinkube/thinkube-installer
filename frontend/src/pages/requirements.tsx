/*
 * Copyright 2025 Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useMemo } from "react"
import { useNavigate } from "react-router-dom"
import { TkCard, TkCardContent, TkCardHeader, TkCardTitle } from "thinkube-style/components/cards-data"
import { TkAlert, TkAlertDescription } from "thinkube-style/components/feedback"
import { TkButton } from "thinkube-style/components/buttons-badges"
import { TkBadge } from "thinkube-style/components/buttons-badges"
import { TkPageWrapper } from "thinkube-style/components/utilities"
import { CheckCircle2, XCircle, Info, Loader2, ChevronLeft, ChevronRight, AlertCircle } from "lucide-react"
import axios from "@/utils/axios"

interface Requirement {
  name: string
  details: string
  status: 'pass' | 'fail' | 'missing'
  category: 'system' | 'tools'
  required?: boolean
  action?: 'install'
}

export default function Requirements() {
  const navigate = useNavigate()
  const [requirements, setRequirements] = useState<Requirement[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  const systemRequirements = useMemo(() => {
    return requirements.filter(req => req.category === 'system')
  }, [requirements])

  const toolRequirements = useMemo(() => {
    return requirements.filter(req => req.category === 'tools')
  }, [requirements])

  const hardRequirementsMet = useMemo(() => {
    return systemRequirements.every(req => req.status === 'pass')
  }, [systemRequirements])

  const hasToolsToInstall = useMemo(() => {
    return toolRequirements.some(req => req.status === 'missing')
  }, [toolRequirements])

  const allRequirementsMet = useMemo(() => {
    return hardRequirementsMet && !hasToolsToInstall
  }, [hardRequirementsMet, hasToolsToInstall])

  const canInstallTools = useMemo(() => {
    return hardRequirementsMet && hasToolsToInstall
  }, [hardRequirementsMet, hasToolsToInstall])

  useEffect(() => {
    const checkRequirements = async () => {
      const minLoadTime = new Promise(resolve => setTimeout(resolve, 500))

      try {
        setError('')
        const [response] = await Promise.all([
          axios.get('/api/check-requirements'),
          minLoadTime
        ])

        setRequirements(response.data.requirements)
      } catch (err: any) {
        const errorMessage = err.code === 'ERR_NETWORK' || err.message?.includes('Network')
          ? 'Cannot connect to backend. Make sure the backend server is running on port 8000.'
          : `Failed to check requirements: ${err.message}`

        setError(errorMessage)
        setRequirements([])

        setTimeout(() => {
          setIsLoading(false)
        }, 3000)
        return
      }

      setIsLoading(false)
    }

    checkRequirements()
  }, [])

  return (
    <TkPageWrapper title="System Requirements">
      {error && (
        <TkAlert className="bg-destructive/10 text-destructive border-destructive/20 mb-6">
          <XCircle className="h-4 w-4" />
          <TkAlertDescription>{error}</TkAlertDescription>
        </TkAlert>
      )}

      {isLoading ? (
        <TkCard className="mb-6">
          <TkCardContent className="py-8">
            <div className="flex flex-col items-center justify-center">
              <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
              <p className="text-lg">Checking system requirements...</p>
            </div>
          </TkCardContent>
        </TkCard>
      ) : (
        <TkCard className="mb-6">
          <TkCardHeader>
            <TkCardTitle>Control Node Requirements</TkCardTitle>
          </TkCardHeader>
          <TkCardContent className="space-y-6">
            {systemRequirements.length > 0 && (
              <div>
                <h3 className="font-semibold mb-3">System Requirements</h3>
                <div className="space-y-3">
                  {systemRequirements.map((req) => (
                    <div
                      key={req.name}
                      className="flex items-center gap-4 p-3 rounded-lg bg-muted"
                    >
                      <div className="flex-shrink-0">
                        {req.status === 'pass' ? (
                          <CheckCircle2 className="w-6 h-6 text-success" />
                        ) : (
                          <XCircle className="w-6 h-6 text-destructive" />
                        )}
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold">{req.name}</h3>
                        <p className="text-sm text-muted-foreground">
                          {req.details}
                          {req.required && (
                            <TkBadge variant="secondary" className="ml-2">
                              Required
                            </TkBadge>
                          )}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {toolRequirements.length > 0 && (
              <div>
                <h3 className="font-semibold mb-3">Tools Required</h3>
                <div className="space-y-3">
                  {toolRequirements.map((req) => (
                    <div
                      key={req.name}
                      className="flex items-center gap-4 p-3 rounded-lg bg-muted"
                    >
                      <div className="flex-shrink-0">
                        {req.status === 'pass' ? (
                          <CheckCircle2 className="w-6 h-6 text-success" />
                        ) : (
                          <Info className="w-6 h-6 text-info" />
                        )}
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold">{req.name}</h3>
                        <p className="text-sm text-muted-foreground">
                          {req.details}
                          {req.action === 'install' && (
                            <TkBadge variant="outline" className="ml-2 text-info border-info">
                              Will be installed
                            </TkBadge>
                          )}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!hardRequirementsMet && !isLoading && (
              <TkAlert className="bg-destructive/10 text-destructive border-destructive/20">
                <AlertCircle className="h-4 w-4" />
                <TkAlertDescription>
                  System requirements are not met. Please resolve them before continuing.
                </TkAlertDescription>
              </TkAlert>
            )}

            {hasToolsToInstall && hardRequirementsMet && !isLoading && (
              <TkAlert className="bg-info/10 text-info border-info/20">
                <Info className="h-4 w-4" />
                <TkAlertDescription>
                  Some tools need to be installed to continue.
                </TkAlertDescription>
              </TkAlert>
            )}
          </TkCardContent>
        </TkCard>
      )}

      {!isLoading && (
        <div className="flex justify-between">
          <TkButton
            variant="ghost"
            className="gap-2"
            onClick={() => navigate('/welcome')}
          >
            <ChevronLeft className="w-5 h-5" />
            Back
          </TkButton>

          {allRequirementsMet && (
            <TkButton
              className="gap-2"
              onClick={() => navigate('/sudo-password')}
            >
              Administrator Access
              <ChevronRight className="w-5 h-5" />
            </TkButton>
          )}

          {canInstallTools && (
            <TkButton
              className="gap-2"
              onClick={() => navigate('/sudo-password')}
            >
              Install Tools & Provide Access
              <ChevronRight className="w-5 h-5" />
            </TkButton>
          )}

          {!hardRequirementsMet && !canInstallTools && (
            <div className="text-destructive text-sm">
              Please resolve the system requirements before continuing.
            </div>
          )}
        </div>
      )}
    </TkPageWrapper>
  )
}
