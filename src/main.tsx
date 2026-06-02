import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import './styles.css'
import { RequireConfig } from './App'
import { Config } from './routes/Config'
import { OAuthCallback } from './routes/OAuthCallback'
import { Today } from './routes/Today'
import { Weave } from './routes/Weave'
import { Proposals } from './routes/Proposals'
import { Browse } from './routes/Browse'
import { EntityDetail } from './routes/EntityDetail'
import { CaptureDetail } from './routes/CaptureDetail'

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
        { index: true, element: <Today /> },
        { path: 'weave', element: <Weave /> },
        // Back-compat: the old Proposals route now redirects into Weave.
        { path: 'proposals', element: <Proposals /> },
        { path: 'browse', element: <Browse /> },
        { path: 'entity/:path', element: <EntityDetail /> },
        { path: 'capture/:id', element: <CaptureDetail /> },
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
