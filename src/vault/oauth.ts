/**
 * OAuth 2.1 + PKCE + Dynamic Client Registration for this SPA.
 *
 * Ported from Parachute Notes / surface-client (discovery.ts, oauth.ts,
 * storage.ts) and collapsed into one self-contained module — no npm oauth
 * dependency. This is the same flow Parachute Notes uses:
 *
 *   1. discoverAuthServer(vaultUrl) — GET <vaultUrl>/.well-known/oauth-
 *      authorization-server. The discovered issuer + endpoints may live on a
 *      different origin than the entered vault URL (e.g. discovered via
 *      http://127.0.0.1:1940/vault/default but issuer is the tailnet host).
 *      So: discover from the entered vault URL, do the OAuth dance against the
 *      discovered endpoints, but make DATA calls against the entered vault URL.
 *   2. registerClient(registration_endpoint) — RFC 7591 DCR, public client
 *      (PKCE-only, no secret). credentials:"include" so a hub session cookie
 *      can auto-approve. Result client_id is cached per (issuer, redirectUri).
 *   3. beginOAuth — PKCE verifier/challenge + state stashed in sessionStorage,
 *      returns the authorize URL to top-level-redirect to.
 *   4. completeOAuth — verify state, POST token endpoint with the code +
 *      verifier, get back {access_token, refresh_token, expires_in}.
 *   5. refreshAccessToken — refresh_token grant (rotates the refresh token).
 */

import { deriveCodeChallenge, generateCodeVerifier, generateState } from './pkce'

export const CLIENT_NAME = 'My Vault UI'
// Scope vocabulary per parachute-patterns/oauth-scopes.md. The hub maps these
// onto the concrete vault when it mints the token.
export const DEFAULT_SCOPE = 'vault:read vault:write'

const REDIRECT_PATH = 'oauth/callback'

// ---- types ----

export interface AuthorizationServerMetadata {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  registration_endpoint: string
  response_types_supported?: string[]
  code_challenge_methods_supported?: string[]
  grant_types_supported?: string[]
  token_endpoint_auth_methods_supported?: string[]
  scopes_supported?: string[]
}

export interface ClientRegistration {
  client_id: string
  client_name?: string
  redirect_uris?: string[]
}

export interface TokenResponse {
  access_token: string
  token_type?: string
  scope?: string
  vault?: string
  refresh_token?: string
  expires_in?: number
}

export interface PendingOAuthState {
  vaultUrl: string
  issuer: string
  tokenEndpoint: string
  clientId: string
  codeVerifier: string
  state: string
  redirectUri: string
  scope: string
  startedAt: string
}

// Raised when the token endpoint says the app still needs approval in the hub.
export class PendingApprovalError extends Error {
  approveUrl: string
  constructor(approveUrl: string) {
    super('This app needs to be approved in your hub before it can sign in.')
    this.name = 'PendingApprovalError'
    this.approveUrl = approveUrl
  }
}

// ---- redirect URI ----

// redirect_uri = <origin><BASE_URL>oauth/callback
//   prod: https://unforced.github.io/my-vault-ui/oauth/callback
//   dev:  http://localhost:5173/my-vault-ui/oauth/callback
// Must exactly match what was registered via DCR (the hub binds client_id to
// redirect_uri). BASE_URL already carries a trailing slash from vite `base`.
export function redirectUri(origin: string = window.location.origin): string {
  return `${origin.replace(/\/$/, '')}${import.meta.env.BASE_URL}${REDIRECT_PATH}`
}

// ---- normalization ----

export function normalizeVaultUrl(input: string): string {
  return input.trim().replace(/\/+$/, '')
}

function normalizeIssuerKey(issuer: string): string {
  return issuer.replace(/\/+$/, '')
}

// ---- storage: pending PKCE (sessionStorage) + DCR cache (localStorage) ----

const PENDING_OAUTH_KEY = 'pv.oauth.pending'
const DCR_PREFIX = 'pv.dcr:'

function read<T>(storage: Storage, key: string): T | null {
  try {
    const raw = storage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function write(storage: Storage, key: string, value: unknown): void {
  try {
    storage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage unavailable — best-effort only */
  }
}

export function loadPendingOAuth(): PendingOAuthState | null {
  return read<PendingOAuthState>(sessionStorage, PENDING_OAUTH_KEY)
}

function savePendingOAuth(state: PendingOAuthState): void {
  write(sessionStorage, PENDING_OAUTH_KEY, state)
}

export function clearPendingOAuth(): void {
  try {
    sessionStorage.removeItem(PENDING_OAUTH_KEY)
  } catch {
    /* best-effort */
  }
}

interface CachedClientRegistration {
  clientId: string
  redirectUri: string
  registeredAt: string
}

// DCR client_id is cached per (issuer, redirectUri) so we register at most once
// per browser per issuer. Re-register when the redirect URI changes — the hub
// binds client_id to redirect_uri and would reject the authorize otherwise.
export function loadCachedClientId(issuer: string, redirect: string): string | null {
  const cached = read<CachedClientRegistration>(localStorage, DCR_PREFIX + normalizeIssuerKey(issuer))
  if (!cached) return null
  if (cached.redirectUri !== redirect) return null
  return cached.clientId
}

export function saveCachedClientId(issuer: string, redirect: string, clientId: string): void {
  write(localStorage, DCR_PREFIX + normalizeIssuerKey(issuer), {
    clientId,
    redirectUri: redirect,
    registeredAt: new Date().toISOString(),
  } satisfies CachedClientRegistration)
}

// ---- discovery (RFC 8414) ----

const REQUIRED_FIELDS: (keyof AuthorizationServerMetadata)[] = [
  'issuer',
  'authorization_endpoint',
  'token_endpoint',
  'registration_endpoint',
]

export async function discoverAuthServer(
  vaultUrl: string,
  fetchImpl: typeof fetch = fetch.bind(globalThis),
): Promise<AuthorizationServerMetadata> {
  const metadataUrl = `${vaultUrl.replace(/\/$/, '')}/.well-known/oauth-authorization-server`
  let res: Response
  try {
    res = await fetchImpl(metadataUrl, { headers: { Accept: 'application/json' } })
  } catch (err) {
    throw new Error(`Could not reach the vault at ${vaultUrl}: ${(err as Error).message}`)
  }
  if (!res.ok) {
    throw new Error(`Discovery failed (${res.status}). Is this a Parachute vault URL? Tried ${metadataUrl}`)
  }
  const data = (await res.json()) as AuthorizationServerMetadata
  for (const field of REQUIRED_FIELDS) {
    if (typeof data[field] !== 'string' || !data[field]) {
      throw new Error(`Discovery response missing ${field}`)
    }
  }
  if (!data.code_challenge_methods_supported?.includes('S256')) {
    throw new Error('Vault does not advertise S256 PKCE — cannot complete OAuth safely')
  }
  return data
}

// ---- DCR (RFC 7591) ----

export async function registerClient(
  registrationEndpoint: string,
  redirect: string,
  fetchImpl: typeof fetch = fetch.bind(globalThis),
): Promise<ClientRegistration> {
  const res = await fetchImpl(registrationEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    // Sends the hub session cookie so the owner signing in auto-approves
    // (hub same-hub auto-trust). CORS on this endpoint reflects the github.io
    // origin + Access-Control-Allow-Credentials: true.
    credentials: 'include',
    body: JSON.stringify({
      client_name: CLIENT_NAME,
      redirect_uris: [redirect],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Client registration failed (${res.status}): ${text}`)
  }
  const data = (await res.json()) as ClientRegistration
  if (!data.client_id) {
    throw new Error('Registration response missing client_id')
  }
  return data
}

// ---- begin / complete / refresh ----

/**
 * Begin the OAuth flow against a vault URL: discover the AS, reuse or register
 * a client_id (DCR), stash PKCE state, and return the authorize URL the caller
 * should top-level redirect to.
 */
export async function beginOAuth(
  vaultInput: string,
  scope: string = DEFAULT_SCOPE,
  fetchImpl: typeof fetch = fetch.bind(globalThis),
): Promise<{ authorizeUrl: string; pending: PendingOAuthState }> {
  const vaultUrl = normalizeVaultUrl(vaultInput)
  const redirect = redirectUri()

  const metadata = await discoverAuthServer(vaultUrl, fetchImpl)

  let clientId = loadCachedClientId(metadata.issuer, redirect)
  if (!clientId) {
    const registration = await registerClient(metadata.registration_endpoint, redirect, fetchImpl)
    clientId = registration.client_id
    saveCachedClientId(metadata.issuer, redirect, clientId)
  }

  const codeVerifier = generateCodeVerifier()
  const codeChallenge = await deriveCodeChallenge(codeVerifier)
  const state = generateState()

  const pending: PendingOAuthState = {
    vaultUrl,
    issuer: metadata.issuer,
    tokenEndpoint: metadata.token_endpoint,
    clientId,
    codeVerifier,
    state,
    redirectUri: redirect,
    scope,
    startedAt: new Date().toISOString(),
  }
  savePendingOAuth(pending)

  const authorizeUrl = new URL(metadata.authorization_endpoint)
  authorizeUrl.searchParams.set('response_type', 'code')
  authorizeUrl.searchParams.set('client_id', clientId)
  authorizeUrl.searchParams.set('redirect_uri', redirect)
  authorizeUrl.searchParams.set('code_challenge', codeChallenge)
  authorizeUrl.searchParams.set('code_challenge_method', 'S256')
  authorizeUrl.searchParams.set('state', state)
  authorizeUrl.searchParams.set('scope', scope)

  return { authorizeUrl: authorizeUrl.toString(), pending }
}

function safeApproveUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw.length === 0) return undefined
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return undefined
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined
  return raw
}

function parsePendingApproval(text: string): { approveUrl: string } | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const body = parsed as Record<string, unknown>
  if (body.error !== 'invalid_client') return null
  const approveUrl = safeApproveUrl(body.approve_url)
  if (!approveUrl) return null
  return { approveUrl }
}

/**
 * Complete the flow: verify state, POST the code + PKCE verifier to the token
 * endpoint, clear pending state. Returns the pending context (so the caller
 * knows which vault URL the token is for) and the token response.
 */
export async function completeOAuth(
  code: string,
  state: string,
  fetchImpl: typeof fetch = fetch.bind(globalThis),
): Promise<{ pending: PendingOAuthState; token: TokenResponse }> {
  const pending = loadPendingOAuth()
  if (!pending) {
    throw new Error('No pending sign-in. Start again from the connect screen.')
  }
  if (pending.state !== state) {
    clearPendingOAuth()
    throw new Error('Sign-in state mismatch. The flow was interrupted — please try again.')
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
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    credentials: 'include',
    body: body.toString(),
  })

  if (!res.ok) {
    const text = await res.text()
    clearPendingOAuth()
    const pendingApproval = parsePendingApproval(text)
    if (pendingApproval) {
      throw new PendingApprovalError(pendingApproval.approveUrl)
    }
    throw new Error(`Token exchange failed (${res.status}): ${text}`)
  }

  const token = (await res.json()) as TokenResponse
  if (!token.access_token) {
    clearPendingOAuth()
    throw new Error('Token response missing access_token')
  }

  clearPendingOAuth()
  return { pending, token }
}

export interface RefreshContext {
  tokenEndpoint: string
  clientId: string
  refreshToken: string
}

/**
 * Exchange a refresh_token for a fresh access (+ rotated refresh) token. The
 * hub rotates the refresh token per RFC 6749 §6 — the caller MUST persist the
 * returned refresh_token or the next refresh will fail.
 */
export async function refreshAccessToken(
  ctx: RefreshContext,
  fetchImpl: typeof fetch = fetch.bind(globalThis),
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: ctx.refreshToken,
    client_id: ctx.clientId,
  })

  const res = await fetchImpl(ctx.tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Token refresh failed (${res.status}): ${text}`)
  }

  const token = (await res.json()) as TokenResponse
  if (!token.access_token) {
    throw new Error('Refresh response missing access_token')
  }
  return token
}
