import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { getNote, listSurfaces } from '../vault/api'
import { useAsync } from '../vault/useAsync'
import { openCapture, CAPTURE_CREATED_EVENT } from '../App'
import { SurfaceCard } from './SurfaceCard'
import { Seed } from './icons'

// The morning surface on Today: the AI's open prompts + reflections as
// answerable cards — the front-end of the conversational loop. Pulls live from
// the `surface/*` notes the Weaver tends; answering/resolving drops a card. The
// fuller history (and resolved items) lives on the For You inbox.
export function MorningCard() {
  const surfaces = useAsync(() => listSurfaces(), [])
  const now = useAsync(() => getNote('Now').catch(() => null), [])

  // Re-pull when a capture lands or syncs, so an answered prompt drops away.
  useEffect(() => {
    const reload = () => surfaces.reload()
    window.addEventListener(CAPTURE_CREATED_EVENT, reload)
    window.addEventListener('pv:capture-synced', reload)
    return () => {
      window.removeEventListener(CAPTURE_CREATED_EVENT, reload)
      window.removeEventListener('pv:capture-synced', reload)
    }
    // reload is stable from useAsync; run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const all = surfaces.data ?? []
  const open = all.filter((s) => (s.metadata?.state ?? 'open') === 'open')
  const resolvedCount = all.length - open.length
  const hasNow = Boolean(now.data)

  // Nothing to show until we know there are surfaces (graceful before first weave).
  if (!surfaces.loading && all.length === 0 && !hasNow) return null

  return (
    <section className="morning-card">
      <div className="morning-head">
        <span className="morning-glyph"><Seed size={18} /></span>
        <h2>This morning</h2>
        <Link className="morning-all" to="/inbox">
          For You →
        </Link>
      </div>

      {open.length > 0 ? (
        <div className="morning-questions">
          {open.map((s) => (
            <SurfaceCard key={s.id} surface={s} onChanged={() => surfaces.reload()} />
          ))}
        </div>
      ) : surfaces.loading ? (
        <p className="morning-quiet">Gathering this morning's prompts…</p>
      ) : (
        <p className="morning-quiet">All clear — nothing waiting. The next weave will pose fresh prompts.</p>
      )}

      <div className="morning-foot">
        <button className="morning-respond" onClick={() => openCapture()}>
          Capture something else
        </button>
        {resolvedCount > 0 && (
          <Link className="morning-now" to="/inbox">
            {resolvedCount} resolved →
          </Link>
        )}
        {hasNow && (
          <Link className="morning-now" to="/note/Now">
            What's alive now →
          </Link>
        )}
        <Link className="morning-now" to="/note/The%20Arc">
          The arc of your life →
        </Link>
      </div>
    </section>
  )
}
