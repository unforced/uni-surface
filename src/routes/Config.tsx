import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ping } from '../vault/api'
import { setConfig, getConfig, DEFAULT_VAULT_URL } from '../vault/config'
import { beginOAuth } from '../vault/oauth'
import { InsecureContextError } from '../vault/pkce'
import { Seed } from '../components/icons'

// First-run (and "change vault") screen.
// PRIMARY path: enter the vault URL and Sign in → OAuth 2.1 + PKCE + DCR.
// SECONDARY path: paste a Bearer token (the original flow), kept as an
// advanced fallback.
export function Config() {
  const existing = getConfig()
  const [origin, setOrigin] = useState(existing?.origin ?? DEFAULT_VAULT_URL)
  const [token, setToken] = useState(existing?.token ?? '')
  const [status, setStatus] = useState<'idle' | 'signing' | 'testing'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState(false)
  const [showPaste, setShowPaste] = useState(false)
  const nav = useNavigate()

  // Primary: OAuth sign-in. Discover → DCR → top-level redirect to the hub.
  async function signIn(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setOk(false)
    const o = origin.trim().replace(/\/+$/, '')
    if (!o) {
      setError('Enter your vault URL first.')
      return
    }
    setStatus('signing')
    try {
      const { authorizeUrl } = await beginOAuth(o)
      // Top-level redirect — no CORS needed for the authorize step.
      window.location.assign(authorizeUrl)
    } catch (err) {
      setStatus('idle')
      setError(
        err instanceof InsecureContextError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err),
      )
    }
  }

  // Secondary: paste a token (the original flow), unchanged behavior.
  async function connectWithToken(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setOk(false)
    const o = origin.trim().replace(/\/+$/, '')
    const t = token.trim()
    if (!o || !t) {
      setError('Both the vault URL and a token are needed.')
      return
    }
    setStatus('testing')
    try {
      await ping(o, t)
      setConfig({ origin: o, token: t })
      setOk(true)
      setTimeout(() => nav('/'), 450)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setStatus('idle')
    }
  }

  return (
    <div className="config-wrap">
      <div className="config-card">
        <div className="seed-big">
          <Seed size={46} />
        </div>
        <h1>Your Vault</h1>
        <p className="tagline">
          A quiet garden for your captures, projects, people, and threads.
          Enter your vault URL and sign in — it stays in this browser.
        </p>

        {error && <div className="config-err">{error}</div>}
        {ok && <div className="config-ok">Connected. Opening your vault…</div>}

        <form onSubmit={signIn}>
          <div className="config-field">
            <label htmlFor="origin">Vault URL</label>
            <input
              id="origin"
              value={origin}
              onChange={(e) => setOrigin(e.target.value)}
              placeholder="https://parachute.taildf9ce2.ts.net/vault/default"
              autoComplete="off"
              spellCheck={false}
            />
            <div className="hint">
              The base URL of your vault. Local test:{' '}
              <code>http://127.0.0.1:1940/vault/default</code>. You&apos;ll sign
              in at your hub — no token to copy.
            </div>
          </div>

          <button
            className="btn"
            type="submit"
            disabled={status !== 'idle'}
            style={{ width: '100%', marginTop: 6 }}
          >
            {status === 'signing' ? 'Redirecting to your hub…' : 'Sign in'}
          </button>
        </form>

        <div className="config-alt">
          {!showPaste ? (
            <button className="link-btn" onClick={() => setShowPaste(true)}>
              Paste a token instead
            </button>
          ) : (
            <form onSubmit={connectWithToken}>
              <div className="config-field" style={{ marginTop: 8 }}>
                <label htmlFor="token">Access token</label>
                <textarea
                  id="token"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="paste a Bearer token (JWT)"
                  spellCheck={false}
                />
                <div className="hint">
                  Mint one with{' '}
                  <code>parachute auth mint-token --scope vault:default:write --ephemeral</code>.
                  Sent as <code>Authorization: Bearer …</code>, stored only in this browser.
                </div>
              </div>
              <button
                className="btn-ghost"
                type="submit"
                disabled={status !== 'idle'}
                style={{ width: '100%' }}
              >
                {status === 'testing' ? 'Connecting…' : 'Connect with token'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
