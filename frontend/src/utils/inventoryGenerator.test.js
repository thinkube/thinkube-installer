/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { parse } from 'yaml'

import { generateDynamicInventory, inventoryToYAML } from './inventoryGenerator.js'

function memoryStorage(entries) {
  const data = new Map(Object.entries(entries))
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  }
}

const baseConfig = {
  domainName: 'example.org',
  clusterName: 'thinkube',
  systemUsername: 'thinkube',
  overlayProvider: 'tailscale',
  tailscaleAuthKey: 'tskey-auth',
  tailscaleApiToken: 'tskey-api',
  gitAuthorName: 'Alejandro Martínez Corriá',
  gitAuthorEmail: 'alex@example.org',
}

function setUpBrowserState(config) {
  globalThis.localStorage = memoryStorage({ 'thinkube-config': JSON.stringify(config) })
  globalThis.sessionStorage = memoryStorage({
    networkConfiguration: JSON.stringify({
      networkConfig: { cidr: '192.168.1.0/24', gateway: '192.168.1.1' },
      physicalServers: [{ hostname: 'node1', ip: '192.168.1.10' }],
    }),
    discoveredServers: JSON.stringify([{ hostname: 'node1', ip: '192.168.1.10', architecture: 'x86_64', is_local: true }]),
    clusterNodes: JSON.stringify([{ hostname: 'node1', ip: '192.168.1.10', role: 'control_plane', type: 'baremetal' }]),
    buildArchitecture: 'amd64',
    cloudflareToken: 'cf-token',
    githubToken: 'gh-token',
  })
}

beforeEach(() => {
  console.log = () => {}
})

test('writes the git author name and email into the inventory as valid YAML', () => {
  setUpBrowserState(baseConfig)
  const yamlText = inventoryToYAML(generateDynamicInventory())
  const parsed = parse(yamlText)

  assert.equal(parsed.all.vars.git_author_name, 'Alejandro Martínez Corriá')
  assert.equal(parsed.all.vars.git_author_email, 'alex@example.org')
  assert.equal(parsed.all.vars.ansible_become_pass, "{{ lookup('env', 'ANSIBLE_BECOME_PASSWORD') }}")
})

test('escapes quotes and backslashes in the author name', () => {
  const name = 'Seán "Jack" O\'Brien \\ Ñúñez'
  setUpBrowserState({ ...baseConfig, gitAuthorName: name })
  const parsed = parse(inventoryToYAML(generateDynamicInventory()))

  assert.equal(parsed.all.vars.git_author_name, name)
})

test('does not construct an admin@<domain> email', () => {
  setUpBrowserState(baseConfig)
  const yamlText = inventoryToYAML(generateDynamicInventory())

  assert.ok(!yamlText.includes('admin@example.org'))
  assert.equal(parse(yamlText).all.vars.admin_email, undefined)
})

test('stops when the git author name is missing', () => {
  const { gitAuthorName, ...config } = baseConfig
  setUpBrowserState(config)

  assert.throws(() => generateDynamicInventory(), /Your name for git commits is required/)
})

test('stops when the git author email is missing', () => {
  const { gitAuthorEmail, ...config } = baseConfig
  setUpBrowserState(config)

  assert.throws(() => generateDynamicInventory(), /Your email for git commits is required/)
})

function withGpu(gpuEnabled) {
  setUpBrowserState({
    ...baseConfig,
    gpuNodes: [{ hostname: 'node1', ip: '192.168.1.10', gpu_detected: true, gpu_enabled: gpuEnabled }],
  })
  sessionStorage.setItem('serverHardware', JSON.stringify([
    { hostname: 'node1', hardware: { gpu_detected: true, gpu_count: 1, gpu_model: 'GeForce GTX 1080 Ti' } },
  ]))
  return parse(inventoryToYAML(generateDynamicInventory())).all.children.baremetal_gpus
}

test('a GPU the GPU check did not enable is not in baremetal_gpus', () => {
  assert.equal(withGpu(false).hosts?.node1, undefined)
})

test('a GPU the GPU check enabled is in baremetal_gpus', () => {
  assert.deepEqual(withGpu(true).hosts.node1, { gpu_count: 1, gpu_model: 'GeForce GTX 1080 Ti' })
})
