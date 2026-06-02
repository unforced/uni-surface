import { useEffect, useState } from 'react'
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { clearConfig, hasConfig } from './vault/config'
import { EntityIndexProvider } from './vault/EntityIndex'
import { useTheme } from './components/useTheme'
import { SearchPalette } from './components/SearchPalette'
import { Seed, SearchIcon, SunIcon, MoonIcon } from './components/icons'

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
  const nav = useNavigate()
  const loc = useLocation()

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

  function signOut() {
    if (confirm('Disconnect this vault? You can paste a new origin + token after.')) {
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
            <NavLink to="/browse">Browse</NavLink>
          </nav>
          <div className="topbar-spacer" />
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
    </div>
  )
}
