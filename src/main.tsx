import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom'
import './styles.css'
import { startSyncEngine } from './vault/sync/engine'
import { RequireConfig } from './App'
import { Config } from './routes/Config'
import { OAuthCallback } from './routes/OAuthCallback'
import { Home } from './routes/Home'
import { Uni } from './routes/Uni'
import { Agents } from './routes/Agents'
import { Today } from './routes/Today'
import { Inbox } from './routes/Inbox'
import { Dev } from './routes/Dev'
import { Projects } from './routes/Projects'
import { Writing } from './routes/Writing'
import { Schema } from './routes/Schema'
import { Arc } from './routes/Arc'
import { Time } from './routes/Time'
import { Write } from './routes/Write'
import { Weave } from './routes/Weave'
import { Proposals } from './routes/Proposals'
import { Browse } from './routes/Browse'
import { EntityDetail } from './routes/EntityDetail'
import { CaptureDetail } from './routes/CaptureDetail'
import { NoteView } from './routes/NoteView'

// `base` from vite.config.ts also drives the router basename for GH Pages.
const basename = import.meta.env.BASE_URL.replace(/\/$/, '')

// Restore a deep link that the GitHub Pages 404.html fallback stashed.
const redirect = sessionStorage.getItem('pv.redirect')
if (redirect) {
  sessionStorage.removeItem('pv.redirect')
  if (redirect !== location.pathname + location.search + location.hash) {
    history.replaceState(null, '', redirect)
  }
}

const router = createBrowserRouter(
  [
    { path: '/connect', element: <Config /> },
    { path: '/oauth/callback', element: <OAuthCallback /> },
    {
      path: '/',
      element: <RequireConfig />,
      children: [
        { index: true, element: <Home /> },
        { path: 'uni', element: <Uni /> },
        { path: 'today', element: <Today /> },
        { path: 'projects', element: <Projects /> },
        { path: 'write', element: <Write /> },
        // The demoted admin page lives at /manage; /agents redirects to /uni.
        { path: 'manage', element: <Agents /> },
        { path: 'agents', element: <Navigate to="/uni" replace /> },
        { path: 'arms', element: <Navigate to="/uni" replace /> },
        { path: 'inbox', element: <Inbox /> },
        { path: 'dev', element: <Dev /> },
        { path: 'writing', element: <Writing /> },
        { path: 'schema', element: <Schema /> },
        { path: 'arc', element: <Arc /> },
        { path: 'time/:window', element: <Time /> },
        { path: 'channels', element: <Navigate to="/uni" replace /> },
        { path: 'agent/:name', element: <Uni /> },
        { path: 'weave', element: <Weave /> },
        // Back-compat: the old Proposals route now redirects into Weave.
        { path: 'proposals', element: <Proposals /> },
        { path: 'browse', element: <Browse /> },
        { path: 'entity/:path', element: <EntityDetail /> },
        { path: 'capture/:id', element: <CaptureDetail /> },
        { path: 'note/:id', element: <NoteView /> },
      ],
    },
  ],
  { basename: basename || '/' },
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)

// Drive the offline outbox: drain on load, on reconnect, on focus, and on a tick.
// Idempotent, so StrictMode's double-invoke is harmless.
startSyncEngine()
