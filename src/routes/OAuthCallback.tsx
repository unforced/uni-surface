import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { completeOAuth, PendingApprovalError, loadPendingOAuth } from '../vault/oauth'
import { completeAgentOAuth, loadAgentPendingOAuth, persistAgentToken } from '../vault/agentAuth'
import { setAuth, setConfig } from '../vault/config'
import { Seed } from '../components/icons'

// Landing route for the OAuth redirect: /oauth/callback?code=…&state=…
// Exchanges the authorization code for a token, stores it the same way the app
// stores a pasted token (origin + access token), plus the OAuth refresh
// material, then bounces to Today.
export function OAuthCallback() {
  const [params] = useSearchParams()
  const nav = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [approveUrl, setApproveUrl] = useState<string | null>(null)
  const ran = useRef(false)

  useEffect(() => {
    // StrictMode double-invokes effects in dev — the auth code is single-use,
    // so guard against running the exchange twice.
    if (ran.current) return
    ran.current = true

    const code = params.get('code')
    const state = params.get('state')
    const oauthError = params.get('error')

    if (oauthError) {
      setError(params.get('error_description') || `Sign-in was denied (${oauthError}).`)
      return
    }
    if (!code || !state) {
      setError('Missing authorization code. Start the sign-in again from the connect screen.')
      return
    }

    // One callback, two flows. Route by which pending slot owns this `state`.
    // Agent flow (agent:read) is isolated under its own keys; the vault flow is
    // the default. We don't touch the other flow's pending — it stays for retry.
    const agentPending = loadAgentPendingOAuth()
    if (agentPending && agentPending.state === state) {
      completeAgentOAuth(code, state)
        .then(({ pending, token }) => {
          persistAgentToken(pending, token)
          nav('/', { replace: true })
        })
        .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      return
    }

    const vaultPending = loadPendingOAuth()
    if (!vaultPending || vaultPending.state !== state) {
      setError('Sign-in state does not match a pending flow. Start again from the connect screen.')
      return
    }

    completeOAuth(code, state)
      .then(({ pending, token }) => {
        // Data calls go to the entered vault URL, not the issuer origin.
        setConfig({ origin: pending.vaultUrl, token: token.access_token })
        setAuth({
          method: 'oauth',
          issuer: pending.issuer,
          tokenEndpoint: pending.tokenEndpoint,
          clientId: pending.clientId,
          refreshToken: token.refresh_token,
          scope: token.scope ?? pending.scope,
          expiresAt: token.expires_in ? Date.now() + token.expires_in * 1000 : undefined,
        })
        nav('/', { replace: true })
      })
      .catch((err) => {
        if (err instanceof PendingApprovalError) {
          setApproveUrl(err.approveUrl)
          return
        }
        setError(err instanceof Error ? err.message : String(err))
      })
  }, [params, nav])

  return (
    <div className="config-wrap">
      <div className="config-card">
        <div className="seed-big">
          <Seed size={46} />
        </div>
        {approveUrl ? (
          <>
            <h1>Approve this app</h1>
            <p className="tagline">
              Your hub needs you to approve My Vault UI before it can sign in.
              Approve it, then come back and sign in again.
            </p>
            <a className="btn" href={approveUrl} style={{ width: '100%' }}>
              Open approval page
            </a>
            <button
              className="btn-ghost"
              onClick={() => nav('/connect', { replace: true })}
              style={{ width: '100%', marginTop: 10 }}
            >
              Back to connect
            </button>
          </>
        ) : error ? (
          <>
            <h1>Sign-in failed</h1>
            <div className="config-err">{error}</div>
            <button
              className="btn"
              onClick={() => nav('/connect', { replace: true })}
              style={{ width: '100%' }}
            >
              Back to connect
            </button>
          </>
        ) : (
          <>
            <h1>Signing you in…</h1>
            <p className="tagline">Exchanging your authorization with the hub. One moment.</p>
          </>
        )}
      </div>
    </div>
  )
}
