/**
 * Second OAuth audience: `agent:read`.
 *
 * The agent daemon (reverse-proxied by the hub at <hub>/agent/*) rejects a
 * vault-scoped token — a token carrying any vault scope resolves to aud:vault.
 * So we run a SECOND, isolated OAuth flow scoped to `agent:read` ALONE; with no
 * vault scope the hub's inferAudience mints an aud:agent token (iss = the hub
 * public origin, which is also the agent API origin — so we derive the SSE base
 * from the issuer).
 *
 * This mirrors the vault flow in ./oauth.ts but with isolated storage keys and
 * its own pending slot, so the two never collide. Discovery, DCR (client_id),
 * PKCE and refresh are shared with the vault flow — they're audience-agnostic.
 * Pattern reference: @openparachute/surface-client moduleAuth (#133).
 */

import {
  discoverAuthServer,
  registerClient,
  loadCachedClientId,
  saveCachedClientId,
  redirectUri,
  normalizeVaultUrl,
  refreshAccessToken,
  type TokenResponse,
} from './oauth'
import { deriveCodeChallenge, generateCodeVerifier, generateState } from './pkce'

export const AGENT_SCOPE = 'agent:read'

// Isolated storage — distinct from the vault flow's pv.oauth.pending / pv.auth.
const AGENT_PENDING_KEY = 'pv.agent.oauth.pending'
const AGENT_TOKEN_KEY = 'pv.agent.token'
const AGENT_AUTH_KEY = 'pv.agent.auth'

export interface AgentPendingOAuthState {
  issuer: string
  tokenEndpoint: string
  clientId: string
  codeVerifier: string
  state: string
  redirectUri: string
  scope: string
  startedAt: string
}

export interface AgentAuth {
  issuer: string // full issuer URL — its origin is the agent API / hub base
  tokenEndpoint: string
  clientId: string
  refreshToken?: string
  scope: string
  expiresAt?: number
}

function read<T>(storage: Storage, key: string): T | null {
  try {
    const raw = storage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

export function loadAgentPendingOAuth(): AgentPendingOAuthState | null {
  return read<AgentPendingOAuthState>(sessionStorage, AGENT_PENDING_KEY)
}

function saveAgentPendingOAuth(s: AgentPendingOAuthState): void {
  try {
    sessionStorage.setItem(AGENT_PENDING_KEY, JSON.stringify(s))
  } catch {
    /* best-effort */
  }
}

export function clearAgentPendingOAuth(): void {
  try {
    sessionStorage.removeItem(AGENT_PENDING_KEY)
  } catch {
    /* best-effort */
  }
}

export function getAgentAuth(): AgentAuth | null {
  return read<AgentAuth>(localStorage, AGENT_AUTH_KEY)
}

export function setAgentAuth(auth: AgentAuth): void {
  try {
    localStorage.setItem(AGENT_AUTH_KEY, JSON.stringify(auth))
  } catch {
    /* best-effort */
  }
}

// The cached agent access token (sync; no refresh here). Empty → null.
export function getAgentToken(): string | null {
  const t = localStorage.getItem(AGENT_TOKEN_KEY)
  return t && t.trim() ? t.trim() : null
}

function setAgentToken(token: string): void {
  try {
    localStorage.setItem(AGENT_TOKEN_KEY, token.trim())
  } catch {
    /* best-effort */
  }
}

export function clearAgentAuth(): void {
  try {
    localStorage.removeItem(AGENT_AUTH_KEY)
    localStorage.removeItem(AGENT_TOKEN_KEY)
  } catch {
    /* best-effort */
  }
}

// The agent API / hub origin — the issuer's origin. SSE + agent calls go here,
// NOT the vault data origin (which can differ). Null until the agent flow runs.
export function getAgentHubOrigin(): string | null {
  const auth = getAgentAuth()
  if (!auth?.issuer) return null
  try {
    return new URL(auth.issuer).origin
  } catch {
    return null
  }
}

export function hasAgentToken(): boolean {
  return getAgentToken() !== null
}

// Begin the agent:read flow: discover, reuse/register the shared client_id,
// stash an isolated pending slot, and return the authorize URL to redirect to.
// `vaultInput` is only used for discovery (the issuer lives on the vault host).
export async function beginAgentOAuth(
  vaultInput: string,
  fetchImpl: typeof fetch = fetch.bind(globalThis),
): Promise<{ authorizeUrl: string; pending: AgentPendingOAuthState }> {
  const vaultUrl = normalizeVaultUrl(vaultInput)
  const redirect = redirectUri()
  const metadata = await discoverAuthServer(vaultUrl, fetchImpl)

  let clientId = loadCachedClientId(metadata.issuer, redirect)
  if (!clientId) {
    const reg = await registerClient(metadata.registration_endpoint, redirect, fetchImpl)
    clientId = reg.client_id
    saveCachedClientId(metadata.issuer, redirect, clientId)
  }

  const codeVerifier = generateCodeVerifier()
  const codeChallenge = await deriveCodeChallenge(codeVerifier)
  const state = generateState()

  const pending: AgentPendingOAuthState = {
    issuer: metadata.issuer,
    tokenEndpoint: metadata.token_endpoint,
    clientId,
    codeVerifier,
    state,
    redirectUri: redirect,
    scope: AGENT_SCOPE,
    startedAt: new Date().toISOString(),
  }
  saveAgentPendingOAuth(pending)

  const authorizeUrl = new URL(metadata.authorization_endpoint)
  authorizeUrl.searchParams.set('response_type', 'code')
  authorizeUrl.searchParams.set('client_id', clientId)
  authorizeUrl.searchParams.set('redirect_uri', redirect)
  authorizeUrl.searchParams.set('code_challenge', codeChallenge)
  authorizeUrl.searchParams.set('code_challenge_method', 'S256')
  authorizeUrl.searchParams.set('state', state)
  // Scope ALONE — no vault scope, so the hub mints an aud:agent token.
  authorizeUrl.searchParams.set('scope', AGENT_SCOPE)

  return { authorizeUrl: authorizeUrl.toString(), pending }
}

// Complete the agent flow against its OWN pending slot. The shared callback
// calls this only when the returned `state` matched the agent pending.
export async function completeAgentOAuth(
  code: string,
  state: string,
  fetchImpl: typeof fetch = fetch.bind(globalThis),
): Promise<{ pending: AgentPendingOAuthState; token: TokenResponse }> {
  const pending = loadAgentPendingOAuth()
  if (!pending) throw new Error('No pending agent sign-in.')
  if (pending.state !== state) {
    clearAgentPendingOAuth()
    throw new Error('Agent sign-in state mismatch — please try again.')
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    code_verifier: pending.codeVerifier,
    client_id: pending.clientId,
    redirect_uri: pending.redirectUri,
  })
  const res = await fetchImpl(pending.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    credentials: 'include',
    body: body.toString(),
  })
  if (!res.ok) {
    clearAgentPendingOAuth()
    throw new Error(`Agent token exchange failed (${res.status}): ${await res.text()}`)
  }
  const token = (await res.json()) as TokenResponse
  if (!token.access_token) {
    clearAgentPendingOAuth()
    throw new Error('Agent token response missing access_token')
  }
  clearAgentPendingOAuth()
  return { pending, token }
}

// Persist a freshly-minted agent token + its refresh material. Called by the
// callback after completeAgentOAuth.
export function persistAgentToken(pending: AgentPendingOAuthState, token: TokenResponse): void {
  setAgentToken(token.access_token)
  setAgentAuth({
    issuer: pending.issuer,
    tokenEndpoint: pending.tokenEndpoint,
    clientId: pending.clientId,
    refreshToken: token.refresh_token,
    scope: token.scope ?? pending.scope,
    expiresAt: token.expires_in ? Date.now() + token.expires_in * 1000 : undefined,
  })
}

// Return a usable agent token: cached if fresh, else refreshed. Returns null if
// there's no auth yet or refresh fails (caller can then trigger beginAgentOAuth).
// Refresh material is shared (audience-agnostic refresh grant).
export async function ensureAgentToken(
  fetchImpl: typeof fetch = fetch.bind(globalThis),
): Promise<string | null> {
  const auth = getAgentAuth()
  const cached = getAgentToken()
  if (!auth) return null
  const fresh = !auth.expiresAt || auth.expiresAt - Date.now() > 60_000
  if (cached && fresh) return cached
  if (!auth.refreshToken) return null
  try {
    const t = await refreshAccessToken(
      { tokenEndpoint: auth.tokenEndpoint, clientId: auth.clientId, refreshToken: auth.refreshToken },
      fetchImpl,
    )
    setAgentToken(t.access_token)
    setAgentAuth({
      ...auth,
      refreshToken: t.refresh_token ?? auth.refreshToken,
      expiresAt: t.expires_in ? Date.now() + t.expires_in * 1000 : undefined,
    })
    return t.access_token
  } catch {
    return null
  }
}
