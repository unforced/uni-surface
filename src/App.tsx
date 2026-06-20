import { useEffect, useState } from 'react'
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { clearConfig, hasConfig, isOAuth } from './vault/config'
import { listUnwovenCaptures, listPendingProposals } from './vault/api'
import { PROPOSAL_RESOLVED_EVENT } from './routes/Weave'
import { EntityIndexProvider } from './vault/EntityIndex'
import { useTheme } from './components/useTheme'
import { SearchPalette } from './components/SearchPalette'
import { Capture } from './components/Capture'
import { Toast } from './components/common'
import { UpdateBanner } from './components/UpdateBanner'
import { SyncBadge } from './components/SyncBadge'
import type { Note } from './vault/types'
import { Seed, SearchIcon, PlusIcon } from './components/icons'

// Broadcast so the active route (e.g. Today) can refresh after a capture lands,
// without threading a callback through the router.
export const CAPTURE_CREATED_EVENT = 'pv:capture-created'
// Routes fire this to open the global capture modal hosted in the shell.
export const OPEN_CAPTURE_EVENT = 'pv:open-capture'

// A surface a capture is answering — threads the reply back via `responds-to`.
// `resolveOnReply` auto-resolves that surface once the reply syncs (the default
// for inquiry prompts: answering it clears it from the morning view).
export type ReplyTarget = { id: string; label: string; resolveOnReply?: boolean }

// Helper for routes to request the capture modal. Pass a reply target to open
// it in "reply" mode — the resulting capture links `responds-to` that surface.
export function openCapture(replyTo?: ReplyTarget) {
  window.dispatchEvent(new CustomEvent(OPEN_CAPTURE_EVENT, { detail: replyTo ?? null }))
}

// Guard: require a configured vault, else send to the config screen.
export function RequireConfig() {
  if (!hasConfig()) return <Navigate to="/connect" replace />
  return (
    <EntityIndexProvider>
      <Shell />
    </EntityIndexProvider>
  )
}

function Shell() {
  const { theme, toggle } = useTheme()
  const [search, setSearch] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [capturing, setCapturing] = useState(false)
  // When capture is opened in reply mode, the surface being answered.
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  // Combined "to tend" count for the Weave nav badge: pending proposals +
  // unwoven captures.
  const [weaveCount, setWeaveCount] = useState<number | null>(null)
  const nav = useNavigate()
  const loc = useLocation()

  // Live combined count for the Weave nav badge. Proposals are cheap and load
  // eagerly; the unwoven-captures query is expensive vault-side (a big-tag date
  // scan that blocks the whole API for seconds), so its count comes from a
  // localStorage cache — refreshed here at most every 15 min on a delay, off
  // the critical path, and synced by real Weave-tab visits.
  useEffect(() => {
    let live = true
    const cachedUnwoven = () => Number(localStorage.getItem('pv.unwovenCount') ?? 0)
    const load = () => {
      listPendingProposals()
        .then((ps) => { if (live) setWeaveCount(ps.length + cachedUnwoven()) })
        .catch(() => { if (live) setWeaveCount(null) })
    }
    const refreshUnwoven = () => {
      const at = Number(localStorage.getItem('pv.unwovenCountAt') ?? 0)
      if (Date.now() - at < 15 * 60_000) return
      listUnwovenCaptures()
        .then((caps) => {
          localStorage.setItem('pv.unwovenCount', String(caps.length))
          localStorage.setItem('pv.unwovenCountAt', String(Date.now()))
          load()
        })
        .catch(() => {})
    }
    load()
    const idle = setTimeout(refreshUnwoven, 5000)
    window.addEventListener(PROPOSAL_RESOLVED_EVENT, load)
    window.addEventListener(CAPTURE_CREATED_EVENT, load)
    return () => {
      live = false
      clearTimeout(idle)
      window.removeEventListener(PROPOSAL_RESOLVED_EVENT, load)
      window.removeEventListener(CAPTURE_CREATED_EVENT, load)
    }
  }, [])

  function flash(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2400)
  }

  function onCaptured(note: Note) {
    setCapturing(false)
    // Let any listening route refresh so the capture appears.
    window.dispatchEvent(new CustomEvent(CAPTURE_CREATED_EVENT, { detail: note }))
    // No weave prompt: capture stays frictionless (it never existed for voice
    // anyway) — linking is the Weaver's job. Weave-by-hand lives in the Weave tab.
    flash('Captured 🌱')
  }

  // Offline / not-yet-synced capture: show it optimistically + reassure. No
  // weave offer yet — weaving adds links, which need the note to exist server-side.
  function onQueued(note: Note) {
    setCapturing(false)
    window.dispatchEvent(new CustomEvent(CAPTURE_CREATED_EVENT, { detail: note }))
    flash(navigator.onLine ? 'Captured 🌱 — syncing' : 'Captured 🌱 — will sync when online')
  }

  // ⌘K / Ctrl-K opens search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearch(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // close search on navigation
  useEffect(() => setSearch(false), [loc.pathname])

  // Routes (e.g. Today's affordance) can open the capture modal via an event.
  // The event detail optionally carries a reply target (surface being answered).
  useEffect(() => {
    const onOpen = (e: Event) => {
      const target = (e as CustomEvent).detail as ReplyTarget | null
      setReplyTo(target ?? null)
      setCapturing(true)
    }
    window.addEventListener(OPEN_CAPTURE_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_CAPTURE_EVENT, onOpen)
  }, [])

  function signOut() {
    const msg = isOAuth()
      ? 'Sign out of this vault? Your stored token will be cleared from this browser.'
      : 'Disconnect this vault? You can sign in to a new vault after.'
    if (confirm(msg)) {
      clearConfig()
      nav('/connect')
    }
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="brand">
            <span className="seed"><Seed /></span>
            Vault
          </Link>
          <nav className="nav">
            <NavLink to="/" end>Home</NavLink>
            <NavLink to="/today">Today</NavLink>
            <NavLink to="/inbox">For You</NavLink>
            <NavLink to="/weave" className={({ isActive }) => (isActive ? 'active nav-proposals' : 'nav-proposals')}>
              Weave
              {weaveCount ? <span className="nav-badge">{weaveCount}</span> : null}
            </NavLink>
            <NavLink to="/browse">Browse</NavLink>
          </nav>
          <div className="topbar-spacer" />
          <SyncBadge />
          <button className="capture-trigger" onClick={() => setCapturing(true)} title="New capture">
            <PlusIcon />
            <span>New capture</span>
          </button>
          <button className="search-trigger" onClick={() => setSearch(true)}>
            <SearchIcon />
            <span>Search</span>
            <kbd>⌘K</kbd>
          </button>
          <div className="overflow-menu">
            <button className="icon-btn" onClick={() => setMenuOpen((v) => !v)} aria-label="More" title="More">
              <span style={{ fontSize: 18, lineHeight: 1 }}>⋯</span>
            </button>
            {menuOpen && (
              <>
                <div className="overflow-scrim" onClick={() => setMenuOpen(false)} />
                <div className="overflow-pop">
                  <NavLink to="/dev" className="overflow-item" onClick={() => setMenuOpen(false)}>Dev</NavLink>
                  <NavLink to="/writing" className="overflow-item" onClick={() => setMenuOpen(false)}>Writing</NavLink>
                  <NavLink to="/arc" className="overflow-item" onClick={() => setMenuOpen(false)}>Life · the Arc</NavLink>
                  <NavLink to="/channels" className="overflow-item" onClick={() => setMenuOpen(false)}>Channels · chat</NavLink>
                  <NavLink to="/agents" className="overflow-item" onClick={() => setMenuOpen(false)}>Agents · roster</NavLink>
                  <NavLink to="/schema" className="overflow-item" onClick={() => setMenuOpen(false)}>Tag schema</NavLink>
                  <div className="overflow-sep" />
                  <button className="overflow-item" onClick={() => { toggle(); setMenuOpen(false) }}>
                    {theme === 'light' ? 'Dark mode' : 'Light mode'}
                  </button>
                  <button className="overflow-item" onClick={() => { setMenuOpen(false); signOut() }}>Sign out</button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <main>
        <Outlet />
      </main>

      <UpdateBanner />
      {search && <SearchPalette onClose={() => setSearch(false)} />}
      {capturing && (
        <Capture
          replyTo={replyTo}
          onClose={() => { setCapturing(false); setReplyTo(null) }}
          onCreated={onCaptured}
          onQueued={onQueued}
        />
      )}
      {toast && <Toast message={toast} />}
    </div>
  )
}
