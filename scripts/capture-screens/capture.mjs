// Copyright Alejandro Martínez Corriá and the Thinkube contributors
// SPDX-License-Identifier: Apache-2.0

// Drives the installer in Chromium, page by page, and saves a screenshot of
// every page for the documentation. The installer must be serving on
// http://localhost:5173 with its backend on :8000 (scripts/dev-services.sh).
//
// The installer fills its tokens from ~/.env. Three values are typed here and
// must be set in the environment:
//   THINKUBE_SUDO_PASSWORD  the sudo password of this machine
//   GIT_AUTHOR_NAME, GIT_AUTHOR_EMAIL  the git identity the configuration page asks for
//
// Usage:
//   node capture.mjs --server <hostname> [--stop-at <route>] [--out <dir>]
//
//   --server    the discovered server to install on
//   --stop-at   take the screenshot of this page and stop without acting on
//               it, for example tailscale-operator-setup to stop before the
//               first page that installs anything on the server
//   --out       where the screenshots go (default: screens/<date-time>)
//
// Secrets stay masked: every token and password field is a password field,
// and the script never clicks the buttons that reveal them. Playbook output
// is blanked by the installer backend. The Tailscale OAuth client ID is a
// plain field, so every screenshot blacks out that field and any text that
// contains the ID, read from TAILSCALE_OAUTH_CLIENT_ID in ~/.env.

import { chromium } from "playwright"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"

const BASE_URL = "http://localhost:5173"
const WIDTH = 1440
const HEIGHT = 900
// Pages that run playbooks are captured again whenever their text changes.
const WATCH_INTERVAL_MS = 15000
const DEPLOY_TIMEOUT_MS = 4 * 60 * 60 * 1000

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]
    const value = argv[i + 1]
    if (!["--server", "--stop-at", "--out"].includes(key) || value === undefined) {
      throw new Error(`Unknown or incomplete argument: ${key}. Usage: node capture.mjs --server <hostname> [--stop-at <route>] [--out <dir>]`)
    }
    args[key.slice(2)] = value
  }
  if (!args.server) throw new Error("--server <hostname> is required: the discovered server to install on")
  return args
}

function dotEnvValue(name) {
  const file = path.join(os.homedir(), ".env")
  const line = fs.readFileSync(file, "utf8").split("\n").find((l) => l.startsWith(`${name}=`))
  const value = line?.slice(name.length + 1).trim().replace(/^["']|["']$/g, "")
  if (!value) throw new Error(`${name} is not set in ${file}. The installer reads it from there too.`)
  return value
}

function requiredEnv(name) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set. Export it before running the capture.`)
  return value
}

const args = parseArgs(process.argv.slice(2))
const sudoPassword = requiredEnv("THINKUBE_SUDO_PASSWORD")
const gitAuthorName = requiredEnv("GIT_AUTHOR_NAME")
const gitAuthorEmail = requiredEnv("GIT_AUTHOR_EMAIL")
const oauthClientId = dotEnvValue("TAILSCALE_OAUTH_CLIENT_ID")
const outDir = args.out ?? path.join("screens", new Date().toISOString().replace(/[:.]/g, "-"))
fs.mkdirSync(outDir, { recursive: true })

let shotNumber = 0

// The height that shows the whole page, down to the footer.
//
// Panels that scroll inside the page — the live Ansible output — are left
// at the size their CSS gives them and appear scrolled, as they do in the
// app. Adding their hidden overflow here only stretched the page: the
// panel has a fixed height, so the extra height was blank space below the
// footer, thousands of pixels of it, and not one more line of log.
async function contentHeight(page) {
  return page.evaluate(() => document.documentElement.scrollHeight)
}

async function shot(page, label) {
  shotNumber += 1
  const route = new URL(page.url()).pathname.replace(/^\//, "") || "root"
  const file = path.join(outDir, `${String(shotNumber).padStart(3, "0")}-${route}${label ? "-" + label : ""}.png`)
  const height = Math.max(HEIGHT, await contentHeight(page))
  await page.setViewportSize({ width: WIDTH, height })
  await page.screenshot({
    path: file,
    fullPage: true,
    mask: [page.locator("#oauthClientId"), page.getByText(oauthClientId)],
    maskColor: "#000000",
  })
  await page.setViewportSize({ width: WIDTH, height: HEIGHT })
  console.log(`saved ${file}`)
}

function button(page, name) {
  return page.getByRole("button", { name, exact: true })
}

async function clickWhenEnabled(page, name, timeout = 120000) {
  const b = button(page, name)
  await b.waitFor({ state: "visible", timeout })
  await page.waitForFunction((el) => !el.disabled, await b.elementHandle(), { timeout })
  await b.click()
}

async function mainText(page) {
  return page.evaluate(() => document.body.innerText)
}

// The page text without what changes while a playbook runs: the live log,
// the current Ansible task with its count, and the no-output timer. A new
// screenshot is taken only when this changes, so one step gives one
// screenshot, not one per log line.
const STAGE_NOISE = [
  ".playbook-executor .font-mono",
  ".playbook-executor .flex.justify-between.text-sm.mb-1",
  ".playbook-executor .text-warning",
]

async function stageText(page) {
  return page.evaluate((selectors) => {
    const copy = document.body.cloneNode(true)
    for (const el of copy.querySelectorAll(selectors.join(","))) el.remove()
    return copy.innerText
  }, STAGE_NOISE)
}

// Captures a page that runs work on its own, each time its text changes,
// until the page is left or a failure text appears.
async function watchUntilLeft(page, route, failureTexts, timeout) {
  const started = Date.now()
  let lastStage = ""
  while (currentRoute(page) === route) {
    const text = await mainText(page)
    const stage = await stageText(page)
    if (stage !== lastStage) {
      await shot(page, "progress")
      lastStage = stage
    }
    const failure = failureTexts.find((t) => text.includes(t))
    if (failure) {
      await shot(page, "failed")
      throw new Error(`${route} failed: the page shows "${failure}"`)
    }
    if (Date.now() - started > timeout) throw new Error(`${route} did not finish within ${timeout / 60000} minutes`)
    await page.waitForTimeout(WATCH_INTERVAL_MS)
  }
}

function currentRoute(page) {
  return new URL(page.url()).pathname.replace(/^\//, "")
}

const handlers = {
  welcome: async (page) => {
    await button(page, "Get Started").waitFor()
    await shot(page)
    await button(page, "Get Started").click()
  },

  requirements: async (page) => {
    await button(page, "Back").waitFor({ timeout: 120000 })
    await shot(page)
    for (const name of ["Administrator Access", "Install Tools & Provide Access"]) {
      if (await button(page, name).count()) return button(page, name).click()
    }
    throw new Error('Requirements are not met: the page shows "Please resolve the system requirements before continuing."')
  },

  "sudo-password": async (page) => {
    await page.locator("#sudo-password").fill(sudoPassword)
    await shot(page)
    await clickWhenEnabled(page, "Discover Servers")
  },

  installation: async (page) => {
    const done = button(page, "Continue to Server Discovery")
    await watchUntilDone(page, done)
    if ((await mainText(page)).includes("failed")) throw new Error("Tool installation on this machine failed; see the screenshot")
    await done.click()
  },

  "server-discovery": async (page) => {
    await shot(page)
    await button(page, "Start Network Scan").click()
    // The status line shows only while scanning; the scan is over when the
    // button reads "Start Network Scan" again.
    await page.getByRole("button", { name: /Discovering/ }).waitFor({ timeout: 30000 })
    await page.getByRole("button", { name: /Discovering/ }).waitFor({ state: "detached", timeout: 180000 })
    const scanFailure = page.getByText(/^Scan failed: /)
    if (await scanFailure.count()) throw new Error(await scanFailure.textContent())
    const card = page.locator("div").filter({ hasText: args.server }).filter({ has: button(page, "Select") }).last()
    if (!(await card.count())) {
      await shot(page, "scan")
      throw new Error(`Server ${args.server} was not found with SSH available in the scan`)
    }
    await shot(page, "scan")
    await card.getByRole("button", { name: "Select", exact: true }).click()
    await shot(page, "selected")
    await clickWhenEnabled(page, "Setup SSH Connectivity")
  },

  "ssh-setup": (page) => watchUntilLeft(page, "ssh-setup", ["Retry SSH Setup"], 30 * 60000),

  "hardware-detection": async (page) => {
    const next = page.getByRole("button", { name: /^(Assign Roles|Continue Without GPU Nodes)$/ })
    await next.waitFor({ timeout: 300000 })
    await shot(page)
    await page.waitForFunction((el) => !el.disabled, await next.elementHandle())
    await next.click()
  },

  "role-assignment": async (page) => {
    await button(page, "Configure Cluster").waitFor()
    await shot(page)
    await clickWhenEnabled(page, "Configure Cluster")
  },

  configuration: async (page) => {
    await page.locator("#gitAuthorName").waitFor()
    await page.waitForLoadState("networkidle")
    await page.locator("#gitAuthorName").fill(gitAuthorName)
    await page.locator("#gitAuthorEmail").fill(gitAuthorEmail)
    await shot(page)
    await clickWhenEnabled(page, "Continue to Overlay Network")
  },

  "overlay-credentials": async (page) => {
    await page.waitForLoadState("networkidle")
    await shot(page)
    await clickWhenEnabled(page, "Continue (sets up tailnet policy)")
  },

  "tailscale-operator-setup": async (page) => {
    await page.waitForLoadState("networkidle")
    await shot(page)
    await clickWhenEnabled(page, "Continue")
  },

  "overlay-setup": (page) => watchUntilLeft(page, "overlay-setup", ["Retry Setup"], 30 * 60000),

  "network-configuration": async (page) => {
    await button(page, "Review Configuration").waitFor()
    await page.waitForLoadState("networkidle")
    await shot(page)
    await clickWhenEnabled(page, "Review Configuration")
  },

  "gpu-driver-check": async (page) => {
    await page.waitForLoadState("networkidle")
    await shot(page)
    await clickWhenEnabled(page, "Continue to Deployment")
  },

  review: async (page) => {
    await button(page, "Start Deployment").waitFor()
    await shot(page)
    await button(page, "Start Deployment").click()
  },

  deploy: async (page) => {
    await watchUntilText(page, ["Deployment Complete!"], ["Deployment Failed"], DEPLOY_TIMEOUT_MS)
    await button(page, "View Cluster Details").click()
  },

  complete: async (page) => {
    await page.waitForLoadState("networkidle")
    await shot(page)
    return "done"
  },
}

async function watchUntilDone(page, doneLocator) {
  let lastStage = ""
  while (!(await doneLocator.count())) {
    const text = await mainText(page)
    const stage = await stageText(page)
    if (stage !== lastStage) {
      await shot(page, "progress")
      lastStage = stage
    }
    await page.waitForTimeout(WATCH_INTERVAL_MS)
  }
  await shot(page)
}

async function watchUntilText(page, doneTexts, failureTexts, timeout) {
  const started = Date.now()
  let lastStage = ""
  for (;;) {
    const text = await mainText(page)
    const stage = await stageText(page)
    if (stage !== lastStage) {
      await shot(page, "progress")
      lastStage = stage
    }
    if (doneTexts.some((t) => text.includes(t))) return shot(page, "done")
    const failure = failureTexts.find((t) => text.includes(t))
    if (failure) {
      await shot(page, "failed")
      throw new Error(`The page shows "${failure}"`)
    }
    if (Date.now() - started > timeout) throw new Error(`Not finished within ${timeout / 60000} minutes`)
    await page.waitForTimeout(WATCH_INTERVAL_MS)
  }
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } })
// An alert in the installer reports a failed check; it stops the capture.
let alertMessage = null
page.on("dialog", async (dialog) => {
  alertMessage = dialog.message()
  await dialog.dismiss()
})

try {
  await page.goto(`${BASE_URL}/welcome`)
  for (;;) {
    await page.waitForLoadState("domcontentloaded")
    const route = currentRoute(page)
    if (route === args["stop-at"]) {
      await page.waitForLoadState("networkidle")
      await shot(page)
      console.log(`Stopped at ${route}, as asked.`)
      break
    }
    const handler = handlers[route]
    if (!handler) {
      await shot(page, "unknown")
      throw new Error(`No handler for the page /${route}`)
    }
    const result = await handler(page)
    if (alertMessage) throw new Error(`/${route} raised an alert: ${alertMessage}`)
    if (result === "done") break
    await page.waitForURL((url) => url.pathname.replace(/^\//, "") !== route, { timeout: 300000 })
  }
  console.log(`Screenshots in ${outDir}`)
} catch (error) {
  await shot(page, "stopped")
  console.error(`Capture stopped on /${currentRoute(page)}: ${error.message}`)
  process.exitCode = 1
} finally {
  await browser.close()
}
