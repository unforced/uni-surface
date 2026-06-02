import { useEffect, useState } from 'react'
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { clearConfig, hasConfig, isOAuth } from './vault/config'
import { listPendingProposals } from './vault/api'
import { PROPOSAL_RESOLVED_EVENT } from './routes/Proposals'
import { EntityIndexProvider } from './vault/EntityIndex'
import { useTheme } from './components/useTheme'
import { SearchPalette } from './components/SearchPalette'
import { Capture } from './components/Capture'
import { WeaveEditor } from './components/WeaveEditor'
import { Toast } from './components/common'
import type { Note } from './vault/types'
import { Seed, SearchIcon, SunIcon, MoonIcon, PlusIcon } from './components/icons'

// Broadcast so the active route (e.g. Today) can refresh after a capture lands,
// without threading a callback through the router.
export const CAPTURE_CREATED_EVENT = 'pv:capture-created'
// Routes fire this to open the global capture modal hosted in the shell.
export const OPEN_CAPTURE_EVENT = 'pv:open-capture'

// Helper for routes to request the capture modal.
export function openCapture() {
  window.dispatchEvent(new CustomEvent(OPEN_CAPTURE_EVENT))
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
  // After a capture lands, offer to weave it (links) right away.
  const [weaveNew, setWeaveNew] = useState<Note | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [proposalCount, setProposalCount] = useState<number | null>(null)
  const nav = useNavigate()
  const loc = useLocation()

  // Live count of pending Weaver proposals for the nav badge. Refresh on mount
  // and whenever a proposal is resolved anywhere in the app.
  useEffect(() => {
    let live = true
    const load = () => {
      listPendingProposals()
        .then((ps) => { if (live) setProposalCount(ps.length) })
        .catch(() => { if (live) setProposalCount(null) })
    }
    load()
    window.addEventListener(PROPOSAL_RESOLVED_EVENT, load)
    return () => {
      live = false
      window.removeEventListener(PROPOSAL_RESOLVED_EVENT, load)
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
    // Offer to weave it immediately.
    setWeaveNew(note)
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
  useEffect(() => {
    const onOpen = () => setCapturing(true)
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
            <NavLink to="/proposals" className={({ isActive }) => (isActive ? 'active nav-proposals' : 'nav-proposals')}>
              Proposals
              {proposalCount ? <span className="nav-badge">{proposalCount}</span> : null}
            </NavLink>
            <NavLink to="/browse">Browse</NavLink>
          </nav>
          <div className="topbar-spacer" />
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

      {search && <SearchPalette onClose={() => setSearch(false)} />}
      {capturing && <Capture onClose={() => setCapturing(false)} onCreated={onCaptured} />}
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
