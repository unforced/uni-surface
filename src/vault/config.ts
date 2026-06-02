// Vault connection config — origin + bearer token, stored in localStorage.
// NO hardcoded origin or token anywhere. Aaron pastes these on first run.

const ORIGIN_KEY = 'pv.origin'
const TOKEN_KEY = 'pv.token'

export interface VaultConfig {
  origin: string
  token: string
}

function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, '')
}

export function getConfig(): VaultConfig | null {
  const origin = localStorage.getItem(ORIGIN_KEY)
  const token = localStorage.getItem(TOKEN_KEY)
  if (!origin || !token) return null
  return { origin, token }
}

export function setConfig(cfg: VaultConfig): void {
  localStorage.setItem(ORIGIN_KEY, normalizeOrigin(cfg.origin))
  localStorage.setItem(TOKEN_KEY, cfg.token.trim())
}

export function clearConfig(): void {
  localStorage.removeItem(ORIGIN_KEY)
  localStorage.removeItem(TOKEN_KEY)
}

export function hasConfig(): boolean {
  return getConfig() !== null
}
