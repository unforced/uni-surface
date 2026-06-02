import { useEffect, useMemo, useRef, useState } from 'react'
import {
  createEntity,
  entityPath,
  linkCapture,
  resolveProposal,
  searchCaptures,
} from '../vault/api'
import type { Note } from '../vault/types'
import { ENTITY_TYPES, entityTypeOf, type EntityType } from '../vault/types'
import { useEntityIndex } from '../vault/EntityIndex'
import { entityName, formatDayHeading, dayKey } from '../vault/util'
import { LinkIcon, PlusIcon } from './icons'
import {
  proposalEntityType,
  proposalConfidence,
} from '../routes/Proposals'

const RELATIONSHIPS = ['relates-to', 'mentions', 'at', 'part-of', 'practices', 'uses', 'references']

const TYPE_FOLDER: Record<EntityType, string> = {
  project: 'Projects',
  person: 'People',
  place: 'Places',
  thread: 'Threads',
  practice: 'Practices',
  tool: 'Tools',
  reference: 'References',
  organization: 'Organizations',
  seed: 'Seeds',
}

function suggestRel(type: EntityType): string {
  switch (type) {
    case 'person': return 'mentions'
    case 'place': return 'at'
    case 'thread': return 'part-of'
    case 'practice': return 'practices'
    case 'tool': return 'uses'
    case 'reference': return 'references'
    case 'project': return 'relates-to'
    default: return 'relates-to'
  }
}

// One supporting capture, with its selected/deselected state.
interface CaptureRow {
  note: Note
  selected: boolean
}

export function ProposalCard({
  proposal,
  onResolved,
}: {
  proposal: Note
  onResolved: (id: string, msg: string) => void
}) {
  const meta = proposal.metadata ?? {}
  const baseType = proposalEntityType(proposal)
  const baseName = String(meta.entity_name ?? entityName(proposal))
  const baseSummary = String(meta.entity_summary ?? '')
  const evidence = String(meta.evidence ?? '')
  const confidence = proposalConfidence(proposal)
  const baseRel = String(meta.relationship ?? suggestRel(baseType))

  const { entities, reload: reloadEntities } = useEntityIndex()

  // ── Revise state (name / type / summary the human can correct) ──
  const [revising, setRevising] = useState(false)
  const [name, setName] = useState(baseName)
  const [type, setType] = useState<EntityType>(baseType)
  const [summary, setSummary] = useState(baseSummary)
  const [relationship, setRelationship] = useState(baseRel)

  // ── Re-target: link to an EXISTING entity instead of creating one ──
  const [target, setTarget] = useState<Note | null>(null) // chosen existing entity
  const [entityQuery, setEntityQuery] = useState('')

  // ── Supporting captures (the evidence) ──
  const [searchTerm, setSearchTerm] = useState(baseName)
  const [rows, setRows] = useState<CaptureRow[]>([])
  const [loadingCaps, setLoadingCaps] = useState(true)
  const [capError, setCapError] = useState<string | null>(null)
  const debounce = useRef<number | undefined>(undefined)

  // ── Execution ──
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Load supporting captures for the current search term (debounced). All state
  // updates happen inside the (async) timeout so the effect body stays free of
  // synchronous setState.
  useEffect(() => {
    window.clearTimeout(debounce.current)
    const term = searchTerm.trim()
    debounce.current = window.setTimeout(async () => {
      if (!term) {
        setRows([])
        setLoadingCaps(false)
        return
      }
      setLoadingCaps(true)
      setCapError(null)
      try {
        const found = await searchCaptures(term)
        // default: all on
        setRows(found.map((n) => ({ note: n, selected: true })))
      } catch (e) {
        setCapError(e instanceof Error ? e.message : String(e))
        setRows([])
      } finally {
        setLoadingCaps(false)
      }
    }, term ? 250 : 0)
    return () => window.clearTimeout(debounce.current)
  }, [searchTerm])

  const selectedCount = useMemo(() => rows.filter((r) => r.selected).length, [rows])

  function toggleRow(id: string) {
    setRows((rs) => rs.map((r) => (r.note.id === id ? { ...r, selected: !r.selected } : r)))
  }
  function setAll(on: boolean) {
    setRows((rs) => rs.map((r) => ({ ...r, selected: on })))
  }

  // Existing-entity picker results (reuse the in-memory entity index).
  const entityResults = useMemo(() => {
    const q = entityQuery.trim().toLowerCase()
    if (!q) return [] as Note[]
    return entities
      .filter((e) => {
        const n = entityName(e).toLowerCase()
        const s = String(e.metadata?.summary ?? '').toLowerCase()
        return n.includes(q) || s.includes(q)
      })
      .slice(0, 8)
  }, [entityQuery, entities])

  // The path the captures will be linked to: an existing target, or the
  // (possibly revised) name/type that Accept will create.
  const willCreate = target === null
  const effectiveType = target ? (entityTypeOf(target) ?? type) : type
  const effectivePath = target ? target.path : entityPath(type, name)
  const effectiveName = target ? entityName(target) : name.trim()
  const effectiveRel = relationship || suggestRel(effectiveType as EntityType)

  // ── The deterministic execution: create (maybe) + link + resolve ──
  async function accept() {
    setBusy(true)
    setError(null)
    const selected = rows.filter((r) => r.selected)
    try {
      // a. Create the entity (skipped when re-targeting an existing one).
      if (willCreate) {
        if (!name.trim()) {
          setError('Give the entity a name before accepting.')
          setBusy(false)
          return
        }
        setProgress(`Creating ${type} “${name.trim()}”…`)
        await createEntity(type, name.trim(), summary)
        reloadEntities()
      }

      // b. Link each SELECTED supporting capture.
      let linked = 0
      for (const r of selected) {
        setProgress(`Linking captures… (${linked + 1}/${selected.length})`)
        await linkCapture(r.note.id, effectivePath, effectiveRel)
        linked++
      }

      // c. Resolve the proposal (audit record).
      setProgress('Resolving proposal…')
      await resolveProposal(proposal.id, 'approved')

      const where = willCreate ? `Created ${effectiveName}` : `Linked to ${effectiveName}`
      onResolved(proposal.id, `${where}, linked ${linked} capture${linked === 1 ? '' : 's'} 🌿`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
      setProgress(null)
    }
  }

  async function skip() {
    setBusy(true)
    setError(null)
    try {
      await resolveProposal(proposal.id, 'rejected')
      onResolved(proposal.id, 'Skipped 🍂')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  const confPct = Math.round(confidence * 100)
  const acceptLabel = willCreate
    ? `Accept · create + link ${selectedCount}`
    : `Accept · link ${selectedCount} to ${effectiveName}`

  return (
    <article className={`proposal-card t-${effectiveType}`}>
      {/* ── Header: the proposed action in plain language ── */}
      <div className="pc-head">
        <span className="pc-dot" />
        <div className="pc-title">
          {willCreate ? (
            <>
              Create {type} <strong>“{name}”</strong>
            </>
          ) : (
            <>
              Link <strong>“{effectiveName}”</strong> <span className="pc-existing">(existing {effectiveType})</span>
            </>
          )}
        </div>
        <span className="pc-conf" title="Weaver confidence">{confPct}%</span>
      </div>

      {summary && !revising && <p className="pc-summary">{summary}</p>}

      {evidence && (
        <p className="pc-why">
          <span className="pc-why-label">Why</span> {evidence}
        </p>
      )}

      {/* ── Revise: edit name / type / summary, or re-target ── */}
      {revising && (
        <div className="pc-revise">
          <p className="field-label">Correct the entity</p>
          <div className="inline-create">
            <select value={type} onChange={(e) => setType(e.target.value as EntityType)} disabled={!!target}>
              {ENTITY_TYPES.map((t) => (
                <option key={t} value={t}>{t} → {TYPE_FOLDER[t]}/…</option>
              ))}
            </select>
            <input
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!!target}
            />
            <input
              placeholder="One-line summary"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              disabled={!!target}
            />
          </div>

          <p className="field-label" style={{ marginTop: 14 }}>
            …or link these captures to an existing entity instead
          </p>
          {target ? (
            <div className="pc-target">
              <span className={`chip t-${entityTypeOf(target) ?? ''}`}>
                <span className="dot" />
                <span className="name">{entityName(target)}</span>
              </span>
              <button className="text-toggle" onClick={() => { setTarget(null); setEntityQuery('') }}>
                clear · create new instead
              </button>
            </div>
          ) : (
            <>
              <input
                className="search-box"
                placeholder="Search existing projects, people, threads…"
                value={entityQuery}
                onChange={(e) => setEntityQuery(e.target.value)}
              />
              {entityResults.length > 0 && (
                <div className="result-list pc-result-list">
                  {entityResults.map((e) => (
                    <button
                      key={e.id}
                      className={`result-row t-${entityTypeOf(e) ?? ''}`}
                      onClick={() => { setTarget(e); setRelationship(suggestRel((entityTypeOf(e) ?? 'reference') as EntityType)) }}
                    >
                      <span className="rr-type">{entityTypeOf(e)}</span>
                      <span style={{ minWidth: 0, flex: 1 }}>
                        <div className="rr-name">{entityName(e)}</div>
                        {e.metadata?.summary ? <div className="rr-sum">{String(e.metadata.summary)}</div> : null}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Relationship (which edge the captures get) ── */}
      <div className="pc-rel">
        <span className="pc-rel-label">Relationship</span>
        <div className="rel-row">
          {RELATIONSHIPS.map((r) => (
            <button
              key={r}
              className={`rel-pick ${effectiveRel === r ? 'sel' : ''}`}
              onClick={() => setRelationship(r)}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* ── Supporting captures (the evidence) ── */}
      <div className="pc-captures">
        <div className="pc-cap-head">
          <span className="field-label" style={{ margin: 0 }}>
            Supporting captures — this will link {selectedCount} of {rows.length}
          </span>
          {rows.length > 0 && (
            <span className="pc-cap-actions">
              <button className="text-toggle" onClick={() => setAll(true)}>all</button>
              <span>·</span>
              <button className="text-toggle" onClick={() => setAll(false)}>none</button>
            </span>
          )}
        </div>

        <div className="pc-cap-search">
          <span className="pc-cap-search-label">Search</span>
          <input
            className="search-box"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Narrow the term if the wrong ones match…"
          />
        </div>

        {loadingCaps && <div className="pc-cap-loading">Finding captures…</div>}
        {capError && <div className="config-err">{capError}</div>}
        {!loadingCaps && rows.length === 0 && !capError && (
          <div className="pc-cap-empty">No captures match “{searchTerm.trim()}”.</div>
        )}

        <div className="pc-cap-list">
          {rows.map((r) => (
            <label key={r.note.id} className={`pc-cap-row ${r.selected ? 'on' : 'off'}`}>
              <input
                type="checkbox"
                checked={r.selected}
                onChange={() => toggleRow(r.note.id)}
              />
              <span className="pc-cap-text">
                <span className="pc-cap-preview">{r.note.preview?.trim() || entityName(r.note)}</span>
                <span className="pc-cap-date">{formatDayHeading(dayKey(r.note.createdAt))}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      {progress && <div className="pc-progress">{progress}</div>}
      {error && <div className="config-err" style={{ marginTop: 12 }}>{error}</div>}

      {/* ── Actions ── */}
      <div className="pc-actions">
        <button
          className="text-toggle pc-skip"
          onClick={skip}
          disabled={busy}
        >
          Skip
        </button>
        <button
          className="btn-ghost btn"
          onClick={() => setRevising((v) => !v)}
          disabled={busy}
        >
          {revising ? 'Done revising' : 'Revise'}
        </button>
        <div className="spacer" />
        <button className="btn pc-accept" onClick={accept} disabled={busy || loadingCaps}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {willCreate ? <PlusIcon /> : <LinkIcon />}
            {busy ? (progress ?? 'Working…') : acceptLabel}
          </span>
        </button>
      </div>
    </article>
  )
}
