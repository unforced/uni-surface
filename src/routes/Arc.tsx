import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { listNotes, getNote } from '../vault/api'
import type { Note } from '../vault/types'
import { useAsync } from '../vault/useAsync'
import { Markdown } from '../components/Markdown'
import { Loading, ErrorBanner } from '../components/common'
import { SectionLenses } from '../components/SectionLenses'

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

function h1(content?: string): string | null {
  const m = (content ?? '').match(/^#\s+(.+)$/m)
  return m ? m[1].trim() : null
}
function bodyAfterH1(content?: string): string {
  return (content ?? '').replace(/^#[^\n]*\n?/, '').trim()
}
function windowOf(n: Note): string {
  return String(n.metadata?.window ?? '')
}
function yearOf(w: string): string {
  return (w.match(/\d{4}/)?.[0]) ?? ''
}
function monthLabel(w: string): string {
  const [y, m] = w.split('-')
  return `${MONTHS[Number(m)] ?? ''} ${y}`.trim()
}
const arcHref = (n: Note) => `/note/${encodeURIComponent(n.path)}`

// The Arc — the life-layer's face. A navigable timeline: eras (chapters) you can
// open into their months and episodes, each leaf one click from the synthesis
// (and the captures beneath). The richest data, finally given a surface.
export function Arc() {
  const nav = useNavigate()
  const arc = useAsync(() => getNote('The Arc').catch(() => null), [])
  const eras = useAsync(() => listNotes({ tag: 'life/era', includeContent: true, limit: 50 }), [])
  const months = useAsync(() => listNotes({ tag: 'life/month', includeMetadata: true, limit: 200 }), [])
  const episodes = useAsync(() => listNotes({ tag: 'life/episode', includeContent: true, limit: 100 }), [])

  const eraList = useMemo(
    () => (eras.data ?? []).slice().sort((a, b) => yearOf(windowOf(b)).localeCompare(yearOf(windowOf(a)))),
    [eras.data],
  )
  const monthsByYear = useMemo(() => {
    const m = new Map<string, Note[]>()
    for (const n of months.data ?? []) {
      const y = yearOf(windowOf(n))
      ;(m.get(y) ?? m.set(y, []).get(y)!).push(n)
    }
    for (const arr of m.values()) arr.sort((a, b) => windowOf(a).localeCompare(windowOf(b)))
    return m
  }, [months.data])
  const episodesByYear = useMemo(() => {
    const m = new Map<string, Note[]>()
    for (const n of episodes.data ?? []) {
      const y = yearOf(windowOf(n))
      ;(m.get(y) ?? m.set(y, []).get(y)!).push(n)
    }
    return m
  }, [episodes.data])

  // Most recent era open by default; the rest collapsed.
  const [open, setOpen] = useState<Set<string>>(new Set())
  const firstYear = eraList[0] ? yearOf(windowOf(eraList[0])) : ''
  const isOpen = (y: string) => (open.size === 0 ? y === firstYear : open.has(y))
  const toggle = (y: string) =>
    setOpen((prev) => {
      const next = new Set(prev.size === 0 ? [firstYear] : prev)
      if (next.has(y)) next.delete(y)
      else next.add(y)
      return next
    })

  const loading = eras.loading || months.loading

  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <SectionLenses active="life" />
      <div className="page-head">
        <div className="kicker">unforced.life</div>
        <h1>The Arc</h1>
        <p className="sub">The work through the life lens — the long view, chapters woven from everything beneath.</p>
        <label className="time-jump arc-jump">
          jump to a day
          <input type="date" onChange={(e) => { if (e.target.value) nav(`/time/${e.target.value}`) }} />
        </label>
      </div>

      {arc.data?.content && (
        <section className="arc-overview">
          <Markdown content={bodyAfterH1(arc.data.content).split('## Eras')[0].trim()} />
          <Link className="arc-overview-link" to="/note/The%20Arc">the full Arc →</Link>
        </section>
      )}

      {loading && <Loading label="Tracing the arc…" />}
      {Boolean(eras.error) && <ErrorBanner error={eras.error} onRetry={eras.reload} />}

      <div className="arc-timeline">
        {eraList.map((era) => {
          const y = yearOf(windowOf(era))
          const opened = isOpen(y)
          const eraMonths = monthsByYear.get(y) ?? []
          const eraEpisodes = episodesByYear.get(y) ?? []
          return (
            <section className={`arc-era${opened ? ' open' : ''}`} key={era.id}>
              <button className="arc-era-head" onClick={() => toggle(y)}>
                <span className="arc-dot" />
                <span className="arc-era-title">{h1(era.content) ?? era.path.split('/').pop()}</span>
                <span className="arc-era-caret">{opened ? '▾' : '▸'}</span>
              </button>
              {opened && (
                <div className="arc-era-body">
                  <div className="arc-era-essence">
                    <Markdown content={bodyAfterH1(era.content)} />
                    <Link className="arc-era-link" to={arcHref(era)}>open this chapter →</Link>
                  </div>

                  {eraEpisodes.length > 0 && (
                    <div className="arc-episodes">
                      {eraEpisodes.map((ep) => (
                        <Link key={ep.id} to={arcHref(ep)} className="arc-episode">
                          ✦ {h1(ep.content) ?? ep.path.split('/').pop()}
                        </Link>
                      ))}
                    </div>
                  )}

                  {eraMonths.length > 0 && (
                    <div className="arc-months">
                      {eraMonths.map((mo) => (
                        <Link key={mo.id} to={`/time/${windowOf(mo)}`} className="arc-month">
                          <span className="arc-month-label">{monthLabel(windowOf(mo))}</span>
                          {mo.metadata?.note_count ? (
                            <span className="arc-month-count">{String(mo.metadata.note_count)}</span>
                          ) : null}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}
