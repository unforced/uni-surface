import { Navigate } from 'react-router-dom'

// The Proposals screen has been folded into the unified Weave screen, where it
// lives as the (default) "Proposals" tab. `/proposals` now redirects to
// `/weave` so existing links/bookmarks keep working.
export function Proposals() {
  return <Navigate to="/weave" replace />
}

// Back-compat re-export: this event used to be defined here and is imported in
// a couple of places (App nav badge, etc.). Its canonical home is now Weave.tsx.
export { PROPOSAL_RESOLVED_EVENT } from './Weave'
