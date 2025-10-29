/*
 * Copyright 2025 Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

<template>
  <div class="flex items-center justify-center min-h-[60vh]">
    <div class="card w-full max-w-2xl bg-base-100 shadow-xl">
      <div class="card-body text-center">
        <div class="flex justify-center mb-6">
          <img src="/tk_full_logo.svg" alt="Thinkube" class="h-32" />
        </div>
        
        <h1 class="text-4xl font-bold mb-4 text-base-content">Welcome!</h1>
        <p class="text-lg text-base-content text-opacity-80 mb-8">
          Let's set up your AI-focused Kubernetes homelab platform
        </p>
        
        <div class="alert alert-info mb-8">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-current shrink-0 w-6 h-6">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
          </svg>
          <span class="text-base-content">This installer will guide you through configuring and deploying Thinkube on your Ubuntu systems.</span>
        </div>

        <div class="prose prose-base max-w-none text-left mb-8">
          <ul class="space-y-3 list-none">
            <li class="flex items-center gap-3">
              <svg class="w-6 h-6 text-success flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
              </svg>
              <span class="font-medium text-base-content">System requirements check</span>
            </li>
            <li class="flex items-center gap-3">
              <svg class="w-6 h-6 text-success flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
              </svg>
              <span class="font-medium text-base-content">Cluster configuration</span>
            </li>
            <li class="flex items-center gap-3">
              <svg class="w-6 h-6 text-success flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
              </svg>
              <span class="font-medium text-base-content">Automated deployment</span>
            </li>
          </ul>
        </div>

        <div class="card-actions justify-center">
          <button class="btn btn-primary btn-lg gap-2" @click="$router.push('/requirements')">
            Get Started
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
            </svg>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
// Welcome screen - no automatic navigation logic
// User must explicitly click "Get Started" to proceed

// 🤖 AI-generated
</script>