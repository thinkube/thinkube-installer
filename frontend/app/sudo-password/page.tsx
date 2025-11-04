/*
 * Copyright 2025 Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { TkCard, TkCardContent, TkCardHeader, TkCardTitle } from "thinkube-style/components/cards-data"
import { TkAlert, TkAlertDescription } from "thinkube-style/components/feedback"
import { TkButton } from "thinkube-style/components/buttons-badges"
import { TkInput } from "thinkube-style/components/forms-inputs"
import { TkLabel } from "thinkube-style/components/forms-inputs"
import { TkPageWrapper } from "thinkube-style/components/utilities"
import { Info, ChevronLeft, Eye, EyeOff, Loader2 } from "lucide-react"
import axios from "@/utils/axios"

export default function SudoPassword() {
  const router = useRouter()
  const [currentUser, setCurrentUser] = useState("")
  const [sudoPassword, setSudoPassword] = useState("")
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState("")
  const [showSudoPassword, setShowSudoPassword] = useState(false)

  useEffect(() => {
    const fetchCurrentUser = async () => {
      // Clear any stored passwords from previous sessions
      sessionStorage.removeItem("sudoPassword")

      // Get current user from backend
      try {
        const response = await axios.get("/api/current-user")
        setCurrentUser(response.data.username)
      } catch (error) {
        setCurrentUser("ubuntu")
      }
    }

    fetchCurrentUser()
  }, [])

  const verifyAndContinue = async (e: React.FormEvent) => {
    e.preventDefault()
    setVerifying(true)
    setError("")

    try {
      // Verify the sudo password
      const response = await axios.post("/api/verify-sudo", {
        password: sudoPassword
      })

      if (response.data.valid) {
        // Store the password temporarily for SSH setup and other operations
        sessionStorage.setItem("sudoPassword", sudoPassword)
        // Store the system username for inventory generation
        sessionStorage.setItem("systemUsername", currentUser)

        // Check if tools need installation
        const requirementsResponse = await axios.get("/api/check-requirements")
        const toolRequirements = requirementsResponse.data.requirements.filter(
          (req: any) => req.category === "tools"
        )
        const hasToolsToInstall = toolRequirements.some(
          (req: any) => req.status === "missing"
        )

        // Check if we're in skip-config mode
        const skipConfigMode = sessionStorage.getItem("skipConfigMode") === "true"

        if (hasToolsToInstall) {
          // Tools need installation - start the installation process
          const setupResponse = await axios.post("/api/run-setup", {
            sudo_password: sudoPassword
          })

          if (setupResponse.data.status === "exists" || skipConfigMode) {
            // If tools were already installed or we're in skip-config mode,
            // check where to go next
            if (skipConfigMode) {
              router.push("/deploy")
            } else {
              router.push("/server-discovery")
            }
          } else {
            // Redirect to installation progress page
            router.push("/installation")
          }
        } else if (skipConfigMode) {
          // All tools already installed and in skip-config mode
          router.push("/deploy")
        } else {
          // All tools are already installed, proceed normally
          router.push("/server-discovery")
        }
      } else {
        setError("Invalid password. Please try again.")
        setSudoPassword("")
      }
    } catch (err: any) {
      // Handle specific sudo password errors
      if (
        err.response &&
        err.response.status === 400 &&
        err.response.data.detail?.includes("sudo password")
      ) {
        setError("Invalid sudo password. Please try again.")
        setSudoPassword("")
      } else {
        setError(
          "Failed to verify password: " +
            (err.response?.data?.detail || err.message)
        )
      }
    } finally {
      setVerifying(false)
    }
  }

  return (
    <TkPageWrapper title="Administrator Access">
      <TkCard className="mb-6">
        <TkCardHeader>
          <TkCardTitle className="mb-4">Sudo Password Required</TkCardTitle>
        </TkCardHeader>
        <TkCardContent className="space-y-6">
          <TkAlert className="bg-info/10 text-info border-info/20">
            <Info className="h-4 w-4" />
            <TkAlertDescription>
              <div>
                <p>
                  The installer needs administrator access for SSH configuration
                  and server setup.
                </p>
                <p className="text-sm mt-1">
                  Your password will be used to run commands with sudo and will
                  not be stored.
                </p>
              </div>
            </TkAlertDescription>
          </TkAlert>

          <form onSubmit={verifyAndContinue}>
            <div className="space-y-4">
              <div className="space-y-2">
                <TkLabel htmlFor="current-user">Current User</TkLabel>
                <TkInput
                  id="current-user"
                  type="text"
                  value={currentUser}
                  disabled
                />
              </div>

              <div className="space-y-2">
                <div className="flex justify-between">
                  <TkLabel htmlFor="sudo-password">Sudo Password</TkLabel>
                  <span className="text-sm text-muted-foreground">
                    Your password for {currentUser}
                  </span>
                </div>
                <div className="relative">
                  <TkInput
                    id="sudo-password"
                    type={showSudoPassword ? "text" : "password"}
                    placeholder="Enter your password"
                    value={sudoPassword}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                      setSudoPassword(e.target.value)
                      setError("")
                    }}
                    className={error ? "border-destructive" : ""}
                    required
                    autoFocus
                  />
                  <button
                    type="button"
                    className="absolute inset-y-0 right-0 flex items-center pr-3"
                    onClick={() => setShowSudoPassword(!showSudoPassword)}
                  >
                    {showSudoPassword ? (
                      <EyeOff className="w-5 h-5 text-muted-foreground" />
                    ) : (
                      <Eye className="w-5 h-5 text-muted-foreground" />
                    )}
                  </button>
                </div>
                {error && (
                  <p className="text-sm text-destructive">{error}</p>
                )}
              </div>

              <div className="text-sm text-muted-foreground">
                <p className="mb-2">The installer will use sudo to:</p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li>Configure SSH access between servers</li>
                  <li>Install missing tools (if needed)</li>
                  <li>Configure your environment</li>
                  <li>Set up system services</li>
                </ul>
              </div>
            </div>
          </form>
        </TkCardContent>
      </TkCard>

      <div className="flex justify-between mt-6">
        <TkButton
          variant="ghost"
          className="gap-2"
          onClick={() => router.push("/requirements")}
        >
          <ChevronLeft className="w-5 h-5" />
          Back
        </TkButton>

        <TkButton
          className="gap-2"
          disabled={!sudoPassword || verifying}
          onClick={verifyAndContinue}
        >
          {verifying ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Verifying...
            </>
          ) : (
            "Verify & Continue"
          )}
        </TkButton>
      </div>
    </TkPageWrapper>
  )
}
