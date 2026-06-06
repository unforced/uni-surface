import { useEffect, useState } from 'react'
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { clearConfig, hasConfig, isOAuth } from './vault/config'
import { listNotes, listPendingProposals } from './vault/api'
import { PROPOSAL_RESOLVED_EVENT } from './routes/Weave'
import { EntityIndexProvider } from './vault/EntityIndex'
import { useTheme } from './components/useTheme'
import { SearchPalette } from './components/SearchPalette'
import { Capture } from './components/Capture'
import { WeaveEditor } from './components/WeaveEditor'
import { Toast } from './components/common'
import { UpdateBanner } from './components/UpdateBanner'
import { SyncBadge } from './components/SyncBadge'
import type { Note } from './vault/types'
import { Seed, SearchIcon, SunIcon, MoonIcon, PlusIcon } from './components/icons'

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
  const [capturing, setCapturing] = useState(false)
  // When capture is opened in reply mode, the surface being answered.
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null)
  // After a capture lands, offer to weave it (links) right away.
  const [weaveNew, setWeaveNew] = useState<Note | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  // Combined "to tend" count for the Weave nav badge: pending proposals +
  // unwoven captures.
  const [weaveCount, setWeaveCount] = useState<number | null>(null)
  const nav = useNavigate()
  const loc = useLocation()

  // Live combined count (pending proposals + unwoven captures) for the Weave nav
  // badge. Refresh on mount and whenever an item is resolved anywhere in the app.
  useEffect(() => {
    let live = true
    const load = () => {
      Promise.all([
        listPendingProposals(),
        listNotes({ tag: 'capture', hasLinks: false, limit: 200 }),
      ])
        .then(([ps, caps]) => { if (live) setWeaveCount(ps.length + caps.length) })
        .catch(() => { if (live) setWeaveCount(null) })
    }
    load()
    window.addEventListener(PROPOSAL_RESOLVED_EVENT, load)
    window.addEventListener(CAPTURE_CREATED_EVENT, load)
    return () => {
      live = false
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
    // Offer to weave it immediately (needs a synced, server-side note).
    setWeaveNew(note)
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
            <NavLink to="/" end>Today</NavLink>
            <NavLink to="/inbox">For You</NavLink>
            <NavLink to="/dev">Dev</NavLink>
            <NavLink to="/writing">Writing</NavLink>
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
          <button className="icon-btn" onClick={toggle} aria-label="Toggle theme" title="Toggle light/dark">
            {theme === 'light' ? <MoonIcon /> : <SunIcon />}
          </button>
          <button className="icon-btn" onClick={signOut} aria-label="Change vault" title="Change vault / sign out">
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
            </svg>
          </button>
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
      {weaveNew && (
        <WeaveEditor
          capture={weaveNew}
          onClose={() => {
            setWeaveNew(null)
            flash('Captured 🌱')
          }}
          onWoven={() => {
            setWeaveNew(null)
            flash('Woven into the graph 🌿')
          }}
        />
      )}
      {toast && <Toast message={toast} />}
    </div>
  )
}
