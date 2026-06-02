import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { listNotes } from '../vault/api'
import type { Note } from '../vault/types'
import { entityTypeOf } from '../vault/types'
import { useAsync } from '../vault/useAsync'
import {
  captureGlyph,
} from '../components/icons'
import { captureKindOf } from '../vault/types'
import { CaptureCard } from '../components/CaptureCard'
import { Loading, ErrorBanner, EmptyState, EntityChip, Toast } from '../components/common'
import { WeaveEditor } from '../components/WeaveEditor'
import {
  groupByDay,
  formatDayHeading,
  todayKey,
  dayKey,
  entityHref,
  entityName,
  linkedEntities,
  previewText,
  formatRelative,
} from '../vault/util'

const RECENT_LIMIT = 60
const WEAVE_LIMIT = 12

export function Today() {
  const [showDormant, setShowDormant] = useState(false)
  const [weaving, setWeaving] = useState<Note | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [wovenIds, setWovenIds] = useState<Set<string>>(new Set())

  // Recent captures with links + content (for the spine + "touching today").
  const captures = useAsync(
    () =>
      listNotes({
        tag: 'capture',
        sort: 'desc',
        limit: RECENT_LIMIT,
        includeLinks: true,
        includeContent: true,
      }),
    [],
  )

  // Active board: all entities (projects + threads), metadata for status/active.
  const entities = useAsync(
    () => listNotes({ tag: 'entity', includeMetadata: true, limit: 1000, sort: 'asc' }),
    [],
  )

  // To-weave: recent unwoven captures.
  const unwoven = useAsync(
    () =>
      listNotes({
        tag: 'capture',
        hasLinks: false,
        sort: 'desc',
        limit: WEAVE_LIMIT,
        includeContent: true,
      }),
    [],
  )

  const days = useMemo(
    () => (captures.data ? groupByDay(captures.data) : []),
    [captures.data],
  )

  // "What you're touching today" — entities linked from today's captures.
  const touching = useMemo(() => {
    if (!captures.data) return null
    const tk = todayKey()
    const today = captures.data.filter((c) => dayKey(c.createdAt) === tk)
    const seen = new Map<string, { ref: ReturnType<typeof linkedEntities>[number]['ref']; type: string; n: number }>()
    for (const c of today) {
      for (const l of linkedEntities(c)) {
        const cur = seen.get(l.ref.id)
        if (cur) cur.n++
        else seen.set(l.ref.id, { ref: l.ref, type: l.type ?? '', n: 1 })
      }
    }
    const all = [...seen.values()].sort((a, b) => b.n - a.n)
    const grouped: Record<string, typeof all> = {}
    for (const x of all) {
      const t = x.type || 'other'
      ;(grouped[t] ??= []).push(x)
    }
    return { count: today.length, grouped, total: all.length }
  }, [captures.data])

  // Board rail: active/incubating projects + active threads.
  const board = useMemo(() => {
    const all = entities.data ?? []
    const projects = all.filter((e) => entityTypeOf(e) === 'project')
    const threads = all.filter((e) => entityTypeOf(e) === 'thread')
    const activeProjects = projects.filter(
      (p) => p.metadata?.status === 'active' || p.metadata?.status === 'incubating',
    )
    const dormantProjects = projects.filter(
      (p) => p.metadata?.status === 'dormant' || p.metadata?.status === 'archived',
    )
    const activeThreads = threads.filter((t) => t.metadata?.active === true || t.metadata?.active === undefined)
    return { activeProjects, dormantProjects, activeThreads }
  }, [entities.data])

  const trayItems = useMemo(
    () => (unwoven.data ?? []).filter((c) => !wovenIds.has(c.id)),
    [unwoven.data, wovenIds],
  )

  function onWoven(updated: Note) {
    setWovenIds((s) => new Set(s).add(updated.id))
    setWeaving(null)
    setToast('Woven into the graph 🌿')
    setTimeout(() => setToast(null), 2200)
    captures.reload()
  }

  return (
    <div className="page">
      <div className="page-head">
        <div className="kicker">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
        <h1>Today</h1>
        <p className="sub">What's alive in your vault, newest first — and what's still waiting to be woven.</p>
      </div>

      <div className="today-grid">
        {/* ── Main column: timeline spine ── */}
        <div>
          {captures.loading && <Loading label="Reading your recent captures…" />}
          {Boolean(captures.error) && <ErrorBanner error={captures.error} onRetry={captures.reload} />}
          {captures.data && days.length === 0 && (
            <EmptyState art="🌱" title="No captures yet">
              Once you start journaling into your vault, they'll bloom here.
            </EmptyState>
          )}
          {days.map((d) => (
            <div className="day-group" key={d.key}>
              <h2 className="day-heading">
                {formatDayHeading(d.key)}
                <span className="count">{d.items.length} capture{d.items.length > 1 ? 's' : ''}</span>
              </h2>
              <div className="spine">
                {d.items.map((c) => (
                  <CaptureCard key={c.id} note={c} />
                ))}
              </div>
            </div>
          ))}

          {/* ── To-weave tray (the one loud thing) ── */}
          <div className="weave-tray">
            <div className="weave-head">
              <h2>To weave</h2>
              {trayItems.length > 0 && <span className="weave-badge">{trayItems.length}</span>}
            </div>
            <p className="weave-sub">
              Recent captures with no links yet. Open one to connect it to your projects, people, and threads.
            </p>
            {unwoven.loading && <Loading label="Finding loose threads…" />}
            {Boolean(unwoven.error) && <ErrorBanner error={unwoven.error} onRetry={unwoven.reload} />}
            {unwoven.data && trayItems.length === 0 && (
              <div className="weave-empty">Everything recent is woven. The garden is tended. 🌾</div>
            )}
            <div className="weave-list">
              {trayItems.map((c) => {
                const kind = captureKindOf(c)
                return (
                  <button key={c.id} className="weave-item" onClick={() => setWeaving(c)}>
                    <span className="wi-glyph">{captureGlyph(kind)}</span>
                    <span className="wi-text">
                      <div className="wi-preview">{previewText(c, 200) || '(no text)'}</div>
                      <div className="wi-time">{formatRelative(c.createdAt)}</div>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* ── Rail ── */}
        <aside className="rail">
          {/* What you're touching today */}
          <div className="touching">
            <h3>What you're touching today</h3>
            <p className="lead">
              Drawn live from {touching?.count ?? 0} capture{touching?.count === 1 ? '' : 's'} today.
            </p>
            {!touching || touching.total === 0 ? (
              <p className="touching-empty">Nothing linked yet today. Weave a capture and it'll surface here.</p>
            ) : (
              Object.entries(touching.grouped).map(([type, items]) => (
                <div className="touching-group" key={type}>
                  <div className="label">{type}s</div>
                  <div className="chips">
                    {items.map((x) => (
                      <EntityChip key={x.ref.id} entity={x.ref} />
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Board rail */}
          <div className="board-card">
            {entities.loading && <Loading label="…" />}
            {Boolean(entities.error) && <ErrorBanner error={entities.error} onRetry={entities.reload} />}
            {entities.data && (
              <>
                <div className="board-group">
                  <div className="label">Active projects</div>
                  {board.activeProjects.length === 0 && <p className="touching-empty">None active.</p>}
                  {board.activeProjects.map((p) => (
                    <Link key={p.id} to={entityHref(p)} className="board-item">
                      <div className="bi-name">
                        <span className={`status-dot status-${p.metadata?.status ?? 'active'}`} />
                        {entityName(p)}
                      </div>
                      {p.metadata?.summary && <div className="bi-sum">{String(p.metadata.summary)}</div>}
                    </Link>
                  ))}
                </div>

                {board.activeThreads.length > 0 && (
                  <div className="board-group">
                    <div className="label">Living threads</div>
                    {board.activeThreads.map((t) => (
                      <Link key={t.id} to={entityHref(t)} className="board-item">
                        <div className="bi-name">
                          <span className="status-dot status-active" style={{ background: 'var(--plum)', boxShadow: '0 0 0 3px color-mix(in srgb, var(--plum) 18%, transparent)' }} />
                          {entityName(t)}
                        </div>
                        {t.metadata?.summary && <div className="bi-sum">{String(t.metadata.summary)}</div>}
                      </Link>
                    ))}
                  </div>
                )}

                {board.dormantProjects.length > 0 && (
                  <div className="toggle-row">
                    <button className="text-toggle" onClick={() => setShowDormant((v) => !v)}>
                      {showDormant ? 'Hide' : `Show ${board.dormantProjects.length} dormant`}
                    </button>
                    {showDormant && (
                      <div className="board-group" style={{ marginTop: 8 }}>
                        {board.dormantProjects.map((p) => (
                          <Link key={p.id} to={entityHref(p)} className="board-item">
                            <div className="bi-name">
                              <span className={`status-dot status-${p.metadata?.status ?? 'dormant'}`} />
                              {entityName(p)}
                            </div>
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </aside>
      </div>

      {weaving && (
        <WeaveEditor capture={weaving} onClose={() => setWeaving(null)} onWoven={onWoven} />
      )}
      {toast && <Toast message={toast} />}
    </div>
  )
}
