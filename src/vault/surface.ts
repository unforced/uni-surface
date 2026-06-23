// The single source of vault auth + transport for the whole app.
//
// Wraps `@openparachute/surface-client`'s `createVaultSurface` — the canonical,
// tested OAuth 2.1 + PKCE + DCR + refresh-on-401 dance — so we no longer
// hand-roll oauth/REST/token-storage (which had drifted from canonical and
// leaked the bearer into the SSE query string). `api.ts` and the live
// subscriptions both go through the `VaultClient` this module hands back.
//
// The connect screen still lets the operator type a full vault URL
// (`https://host/vault/<name>`). We split that into the hub origin + vault name
// `createVaultSurface` wants, and reconstruct the same URL on the other side
// (the lib builds `${hubUrl}/vault/${vaultName}`), so the entered URL round-trips
// byte-for-byte. The vault URL is also the stable per-vault identity the offline
// outbox keys its queued mutations on — so it stays under the legacy `pv.origin`
// key for continuity.

import {
  createVaultSurface,
  saveToken,
  type VaultSurface,
  type VaultClient,
  type StoredToken,
} from '@openparachute/surface-client'
import { clearAgentAuth } from './agentAuth'

// Default vault URL pre-filled on the connect screen (still editable).
export const DEFAULT_VAULT_URL = 'https://parachute.taildf9ce2.ts.net/vault/default'

// Stable app identifier: the token-storage app-segment
// (`parachute_token:<appName>:<vaultName>`) and the DCR-cache namespace.
const APP_NAME = 'uni-surface'
// Shown on the hub consent screen the first time the operator approves this app
// (and the DCR `client_name`). Rebrand deferred to P3 so the OAuth client
// identity doesn't churn during the stack migration.
const CLIENT_NAME = 'My Vault UI'
const SCOPE = 'vault:read vault:write'

// The vault URL the operator entered = the per-vault identity. Reused legacy key.
const VAULT_URL_KEY = 'pv.origin'

function normalizeVaultUrl(input: string): string {
  return input.trim().replace(/\/+$/, '')
}

export function getStoredVaultUrl(): string | null {
  const v = localStorage.getItem(VAULT_URL_KEY)
  return v && v.trim() ? v.trim() : null
}

function setStoredVaultUrl(vaultUrl: string): void {
  localStorage.setItem(VAULT_URL_KEY, normalizeVaultUrl(vaultUrl))
}

// Split `https://host/vault/<name>` → { hubUrl: 'https://host', vaultName }.
// The hub mounts the vault at `<origin>/vault/<name>` and serves OAuth discovery
// at the origin root, so the hub origin is what `createVaultSurface` needs.
function parseVaultUrl(vaultUrl: string): { hubUrl: string; vaultName: string } {
  const u = new URL(normalizeVaultUrl(vaultUrl))
  const m = u.pathname.match(/\/vault\/([^/]+)/)
  return {
    hubUrl: u.origin,
    vaultName: m ? decodeURIComponent(m[1]) : 'default',
  }
}

// The redirect URI must include vite's BASE_URL (`/uni-surface/` on GH Pages),
// so it lands on this app's /oauth/callback route. The lib's standalone default
// (`${origin}/oauth/callback`) omits the base path — so we pass it explicitly.
function redirectUri(): string {
  return `${window.location.origin.replace(/\/$/, '')}${import.meta.env.BASE_URL}oauth/callback`
}

// ── surface + client memoization ──
// One `VaultSurface` per (hub, vault) config; one retained `VaultClient` per
// surface (the lib's getClient() builds a fresh client + refresh closure each
// call, so we hold a single instance — its refresh loop re-reads the latest
// stored token on every request, so it stays current across rotation).

let _surface: VaultSurface | null = null
let _surfaceKey = ''
let _client: VaultClient | null = null

function getSurface(): VaultSurface | null {
  const vaultUrl = getStoredVaultUrl()
  if (!vaultUrl) return null
  const { hubUrl, vaultName } = parseVaultUrl(vaultUrl)
  const key = `${hubUrl}|${vaultName}`
  if (!_surface || _surfaceKey !== key) {
    _surface = createVaultSurface({
      clientName: CLIENT_NAME,
      appName: APP_NAME,
      hubUrl,
      vaultName,
      scope: SCOPE,
      // GitHub Pages / vite dev — never behind a Parachute surface-host, so DCR.
      bootstrap: 'dcr',
      redirectUri: redirectUri(),
    })
    _surfaceKey = key
    _client = null
  }
  return _surface
}

// The active VaultClient, or null if not signed in. Memoized; safe to call from
// event handlers / effects (NOT from a React render body — retain the result).
export function getClient(): VaultClient | null {
  const s = getSurface()
  if (!s) return null
  if (_client) return _client
  _client = s.getClient()
  return _client
}

export function requireClient(): VaultClient {
  const c = getClient()
  if (!c) throw new Error('Vault not connected — sign in first.')
  return c
}

// ── auth lifecycle ──

// Primary connect: store the vault URL, then redirect into the OAuth dance.
export async function login(vaultUrl: string): Promise<void> {
  setStoredVaultUrl(vaultUrl)
  _surface = null // force rebuild against the new URL
  _client = null
  const s = getSurface()
  if (!s) throw new Error('Could not initialize the vault surface.')
  await s.login()
}

// Complete the OAuth flow from the current window.location (vault flow). The
// agent:read flow is handled separately by the callback route.
export async function handleVaultCallback(): Promise<void> {
  const s = getSurface()
  if (!s) throw new Error('No pending sign-in. Start again from the connect screen.')
  await s.handleCallback()
  _client = null // pick up the freshly-stored token
}

// Secondary connect: a pasted Bearer token. We persist it under the same
// token-storage key the surface's getClient() reads (`oauth.getToken(vaultName)`
// → `parachute_token:<appName>:<vaultName>`), so the client picks it up. No
// refresh material → a 401 simply fails (same as the old pasted-token path).
export function connectWithToken(vaultUrl: string, token: string): void {
  setStoredVaultUrl(vaultUrl)
  _surface = null
  _client = null
  const { vaultName } = parseVaultUrl(vaultUrl)
  const stored: StoredToken = { accessToken: token.trim(), scope: SCOPE }
  saveToken(APP_NAME, vaultName, stored)
}

// Local sign-out: clear the vault token + the entered URL, and the isolated
// agent:read token (kept separate, still hand-rolled — P2).
export function disconnect(): void {
  const s = getSurface()
  s?.logout()
  localStorage.removeItem(VAULT_URL_KEY)
  clearAgentAuth()
  _surface = null
  _surfaceKey = ''
  _client = null
}

// Is there a usable token stored for the active vault? (Cheap storage read — no
// client construction; safe for the route guard's render path.)
export function hasToken(): boolean {
  const s = getSurface()
  return s != null && s.oauth.getToken(s.vaultName) != null
}

// Was the stored token obtained via OAuth (has refresh material) vs pasted?
// Drives only the sign-out confirm wording.
export function isOAuthToken(): boolean {
  const s = getSurface()
  return s != null && s.oauth.getToken(s.vaultName)?.refreshToken != null
}
