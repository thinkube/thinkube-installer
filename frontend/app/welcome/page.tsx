/*
 * Copyright 2025 Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

"use client"

import { useRouter } from "next/navigation"
import Image from "next/image"
import { TkCard, TkCardContent, TkCardFooter, TkCardHeader } from "thinkube-style/components/cards-data"
import { TkAlert, TkAlertDescription } from "thinkube-style/components/feedback"
import { TkButton } from "thinkube-style/components/buttons-badges"
import { Info, CheckCircle2, ChevronRight } from "lucide-react"

export default function Welcome() {
  const router = useRouter()

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 flex items-center justify-center min-h-screen">
      <div className="w-full flex items-center justify-center">
        <TkCard className="max-w-2xl w-full shadow-xl">
          <TkCardHeader className="text-center">
            <div className="flex justify-center mb-6">
              <Image
                src="/tk_full_logo.svg"
                alt="Thinkube"
                width={128}
                height={128}
                className="h-32 w-auto"
              />
            </div>

            <h1 className="text-4xl font-heading font-bold mb-2">Welcome</h1>

            <p className="text-lg text-muted-foreground mb-8">
              Let's set up your AI-focused Kubernetes homelab platform
            </p>
          </TkCardHeader>

          <TkCardContent className="space-y-8">
            <TkAlert className="bg-info/10 text-info border-info/20">
              <Info className="h-4 w-4" />
              <TkAlertDescription>
                This installer will guide you through configuring and deploying Thinkube on your Ubuntu systems.
              </TkAlertDescription>
            </TkAlert>

            <div className="space-y-3 text-left">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-6 w-6 text-success flex-shrink-0" />
                <span className="font-medium">System requirements check</span>
              </div>
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-6 w-6 text-success flex-shrink-0" />
                <span className="font-medium">Cluster configuration</span>
              </div>
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-6 w-6 text-success flex-shrink-0" />
                <span className="font-medium">Automated deployment</span>
              </div>
            </div>
          </TkCardContent>

          <TkCardFooter className="justify-center">
            <TkButton
              size="lg"
              className="gap-2"
              onClick={() => router.push('/requirements')}
            >
              Get Started
              <ChevronRight className="h-5 w-5" />
            </TkButton>
          </TkCardFooter>
        </TkCard>
      </div>
    </div>
  )
}
