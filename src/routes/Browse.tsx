import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { entityTypeOf, ENTITY_TYPES } from '../vault/types'
import { useEntityIndex } from '../vault/EntityIndex'
import { Loading, ErrorBanner } from '../components/common'
import { entityName, entityHref } from '../vault/util'

const TYPE_LABEL: Record<string, string> = {
  project: 'Projects',
  person: 'People',
  thread: 'Threads',
  place: 'Places',
  practice: 'Practices',
  tool: 'Tools',
  reference: 'References',
  organization: 'Organizations',
  seed: 'Seeds',
}

export function Browse() {
  const { entities, loading, error, reload } = useEntityIndex()
  const [q, setQ] = useState('')
  const [typeFilter, setTypeFilter] = useState<string | null>(null)

  const grouped = useMemo(() => {
    const ql = q.trim().toLowerCase()
    const filtered = entities.filter((e) => {
      const t = entityTypeOf(e)
      if (typeFilter && t !== typeFilter) return false
      if (!ql) return true
      return (
        entityName(e).toLowerCase().includes(ql) ||
        String(e.metadata?.summary ?? '').toLowerCase().includes(ql)
      )
    })
    const out: Record<string, typeof filtered> = {}
    for (const e of filtered) {
      const t = entityTypeOf(e) ?? 'other'
      ;(out[t] ??= []).push(e)
    }
    return out
  }, [entities, q, typeFilter])

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const e of entities) {
      const t = entityTypeOf(e) ?? 'other'
      c[t] = (c[t] ?? 0) + 1
    }
    return c
  }, [entities])

  return (
    <div className="page">
      <div className="page-head">
        <div className="kicker">Your garden, mapped</div>
        <h1>Browse</h1>
        <p className="sub">{entities.length} entities — projects, people, threads, places, and more.</p>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 24, alignItems: 'center' }}>
        <input
          className="search-box"
          style={{ maxWidth: 320 }}
          placeholder="Filter by name or summary…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button className={`rel-pick ${typeFilter === null ? 'sel' : ''}`} onClick={() => setTypeFilter(null)}>
          all
        </button>
        {ENTITY_TYPES.filter((t) => counts[t]).map((t) => (
          <button key={t} className={`rel-pick ${typeFilter === t ? 'sel' : ''}`} onClick={() => setTypeFilter(t)}>
            {t} {counts[t] ? `· ${counts[t]}` : ''}
          </button>
        ))}
      </div>

      {loading && <Loading />}
      {Boolean(error) && <ErrorBanner error={error} onRetry={reload} />}

      {ENTITY_TYPES.map((t) => {
        const list = grouped[t]
        if (!list || list.length === 0) return null
        return (
          <section className="browse-section t-{t}" key={t}>
            <div className="section-title">{TYPE_LABEL[t] ?? t}</div>
            <div className="entity-grid">
              {list
                .slice()
                .sort((a, b) => entityName(a).localeCompare(entityName(b)))
                .map((e) => (
                  <Link key={e.id} to={entityHref(e)} className={`entity-card t-${t}`}>
                    <div className="ec-name">{entityName(e)}</div>
                    {e.metadata?.summary && <div className="ec-sum">{String(e.metadata.summary)}</div>}
                    <div className="ec-foot">
                      {e.metadata?.status ? <span>{String(e.metadata.status)}</span> : null}
                      {e.metadata?.relation ? <span>{String(e.metadata.relation)}</span> : null}
                    </div>
                  </Link>
                ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
