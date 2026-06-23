// Vault connection compatibility shim.
//
// Auth + transport now live in `surface.ts` (the `@openparachute/surface-client`
// adoption — see that file). This module keeps the small surface the rest of the
// app still reads:
//   - `getConfig().origin` — the stable per-vault identity the offline outbox
//     keys queued mutations on (and the agent:read flow discovers against).
//   - `hasConfig()` — the route guard / sync-engine gate.
//   - `isOAuth()` / `clearConfig()` — the sign-out flow.
//   - `DEFAULT_VAULT_URL` — the connect-screen prefill.
// The token itself is no longer hand-stored here — it lives in the library's
// token-storage, read through the surface.

import {
  DEFAULT_VAULT_URL,
  getStoredVaultUrl,
  hasToken,
  isOAuthToken,
  disconnect,
} from './surface'

export { DEFAULT_VAULT_URL }

export interface VaultConfig {
  origin: string
  token: string
}

// The active vault's identity. `origin` is the full vault URL the operator
// entered (the outbox's per-vault key). `token` is intentionally empty — callers
// no longer need the raw bearer (the VaultClient owns token custody); the field
// is retained so the `{ origin, token }` shape callers destructure stays stable.
export function getConfig(): VaultConfig | null {
  const origin = getStoredVaultUrl()
  if (!origin) return null
  return { origin, token: '' }
}

export function isOAuth(): boolean {
  return isOAuthToken()
}

export function clearConfig(): void {
  disconnect()
}

// Signed in to a vault (a vault URL + a usable token are both present).
export function hasConfig(): boolean {
  return getStoredVaultUrl() !== null && hasToken()
}
