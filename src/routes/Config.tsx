import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ping } from '../vault/api'
import { setConfig, getConfig } from '../vault/config'
import { Seed } from '../components/icons'

// First-run (and "change vault") screen. Nothing is hardcoded.
export function Config() {
  const existing = getConfig()
  const [origin, setOrigin] = useState(existing?.origin ?? '')
  const [token, setToken] = useState(existing?.token ?? '')
  const [status, setStatus] = useState<'idle' | 'testing'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState(false)
  const nav = useNavigate()

  async function connect(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setOk(false)
    const o = origin.trim().replace(/\/+$/, '')
    const t = token.trim()
    if (!o || !t) {
      setError('Both the vault origin and a token are needed.')
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
          Connect once — it stays in this browser.
        </p>

        {error && <div className="config-err">{error}</div>}
        {ok && <div className="config-ok">Connected. Opening your vault…</div>}

        <form onSubmit={connect}>
          <div className="config-field">
            <label htmlFor="origin">Vault origin</label>
            <input
              id="origin"
              value={origin}
              onChange={(e) => setOrigin(e.target.value)}
              placeholder="https://parachute.taildf9ce2.ts.net/vault/default"
              autoComplete="off"
              spellCheck={false}
            />
            <div className="hint">
              The base URL of your vault. Local test:
              {' '}
              <code>http://127.0.0.1:1940/vault/default</code>
            </div>
          </div>

          <div className="config-field">
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

          <button className="btn" type="submit" disabled={status === 'testing'} style={{ width: '100%', marginTop: 6 }}>
            {status === 'testing' ? 'Connecting…' : 'Connect to vault'}
          </button>
        </form>
      </div>
    </div>
  )
}
