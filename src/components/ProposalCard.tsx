import { useEffect, useMemo, useRef, useState } from 'react'
import {
  addAlias,
  createEntity,
  dedupeAliases,
  fetchCapturesByIds,
  getNote,
  linkCapture,
  resolveProposal,
  resolveProposalWithSpec,
  searchCaptures,
} from '../vault/api'
import type { Note } from '../vault/types'
import { ENTITY_TYPES, entityTypeOf, type EntityType } from '../vault/types'
import { useEntityIndex } from '../vault/EntityIndex'
import {
  entityName,
  entityAliases,
  findExistingEntity,
  formatDayHeading,
  dayKey,
  mentionSnippet,
  previewText,
} from '../vault/util'
import {
  parseProposalSpec,
  suggestRel,
  TYPE_FOLDER,
  withName,
  withType,
  PROJECT_STATUSES,
  PERSON_RELATIONS,
  PLACE_KINDS,
  REFERENCE_KINDS,
  type ProposalSpec,
} from '../vault/proposalSpec'
import { LinkIcon, PlusIcon } from './icons'

const RELATIONSHIPS = ['relates-to', 'mentions', 'at', 'part-of', 'practices', 'uses', 'references']

// One supporting capture, with its selected/deselected state.
interface CaptureRow {
  note: Note
  selected: boolean
}

export function ProposalCard({
  proposal,
  onResolved,
  onPartial,
}: {
  proposal: Note
  onResolved: (id: string, msg: string) => void
  // Capability C: report work done WITHOUT resolving (proposal stays pending).
  onPartial: (id: string, msg: string) => void
}) {
  // The Weaver intent: parsed from the note's JSON content, or rebuilt from
  // metadata.* for older proposals (transition safety). This is the seed for
  // the editable form; every edit updates a LOCAL copy (`spec`) — the note is
  // only written on Accept.
  const baseSpec = useMemo(() => parseProposalSpec(proposal), [proposal])
  const [spec, setSpec] = useState<ProposalSpec>(baseSpec)

  // Convenience reads off the live (edited) spec.
  const type = spec.entity.type
  const name = spec.entity.name
  const summary = spec.entity.summary
  const aliases = spec.entity.aliases
  const fields = spec.entity.fields
  const relationship = spec.links.relationship
  const evidence = spec.evidence
  const confidence = spec.confidence
  // The proposal's ORIGINAL name (for dedup matching + alias-on-retarget),
  // independent of any edits the human makes to the name field.
  const baseName = baseSpec.entity.name

  // Terms to look for inside each supporting capture's text: the full entity
  // name, its first word, and any aliases. Drives the highlighted mention
  // snippet per row so the human can verify the link before accepting.
  const matchTerms = useMemo<string[]>(() => {
    const out: string[] = []
    const n = name.trim()
    if (n) {
      out.push(n)
      const first = n.split(/\s+/)[0]
      if (first && first !== n) out.push(first)
    }
    for (const a of aliases) {
      const v = a.trim()
      if (v) out.push(v)
    }
    return out
  }, [name, aliases])

  const { entities, reload: reloadEntities } = useEntityIndex()

  // ── Edit mode: reveal the friendly form ──
  const [editing, setEditing] = useState(false)
  // Chip input draft for a new alias.
  const [aliasDraft, setAliasDraft] = useState('')

  // ── Re-target: link to an EXISTING entity instead of creating one ──
  const [target, setTarget] = useState<Note | null>(null) // chosen existing entity
  const [entityQuery, setEntityQuery] = useState('')
  // When re-targeting, also add the original name as an alias.
  const [addNameAsAlias, setAddNameAsAlias] = useState(true)

  // ── Supporting captures (the evidence) ──
  // Curated path: the spec's links.captures ARE the supporting set (pre-checked).
  // The search box then becomes an "add more captures" affordance. Fallback path
  // (no captures in the spec): search by entity_name, results replace the list.
  const curatedIds = useMemo<string[]>(
    () => spec.links.captures.filter((id) => id.trim() !== ''),
    // captures come from the immutable proposal via baseSpec; safe to memo on it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [baseSpec],
  )
  const hasCurated = curatedIds.length > 0

  const [searchTerm, setSearchTerm] = useState(hasCurated ? '' : baseName)
  const [rows, setRows] = useState<CaptureRow[]>([])
  const [content, setContent] = useState<Record<string, string | null>>({})
  const [loadingCaps, setLoadingCaps] = useState(true)
  const [capError, setCapError] = useState<string | null>(null)
  const debounce = useRef<number | undefined>(undefined)

  // ── Execution ──
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Capability C: split log + ids already linked.
  const [splitLog, setSplitLog] = useState<string[]>([])
  const [linkedIds, setLinkedIds] = useState<Set<string>>(new Set())

  // Curated path: on mount, load exactly the spec's captures, pre-checked.
  useEffect(() => {
    if (!hasCurated) return
    let cancelled = false
    ;(async () => {
      try {
        const found = await fetchCapturesByIds(curatedIds)
        if (cancelled) return
        setRows(found.map((n) => ({ note: n, selected: !linkedIds.has(n.id) })))
      } catch (e) {
        if (cancelled) return
        setCapError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoadingCaps(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // Mount-only for this proposal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Search effect — fallback: results REPLACE; curated: results MERGE in.
  useEffect(() => {
    window.clearTimeout(debounce.current)
    const term = searchTerm.trim()
    debounce.current = window.setTimeout(async () => {
      if (!term) {
        if (!hasCurated) setRows([])
        setLoadingCaps(false)
        return
      }
      setLoadingCaps(true)
      setCapError(null)
      try {
        const found = await searchCaptures(term)
        if (hasCurated) {
          setRows((prev) => {
            const have = new Set(prev.map((r) => r.note.id))
            const additions = found
              .filter((n) => !have.has(n.id))
              .map((n) => ({ note: n, selected: !linkedIds.has(n.id) }))
            return additions.length ? [...prev, ...additions] : prev
          })
        } else {
          setRows(found.map((n) => ({ note: n, selected: !linkedIds.has(n.id) })))
        }
      } catch (e) {
        setCapError(e instanceof Error ? e.message : String(e))
        if (!hasCurated) setRows([])
      } finally {
        setLoadingCaps(false)
      }
    }, term ? 250 : 0)
    return () => window.clearTimeout(debounce.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm])

  // Lazily fetch note content for search-added rows (for snippet extraction).
  useEffect(() => {
    const missing = rows
      .filter((r) => r.note.content == null && !(r.note.id in content))
      .map((r) => r.note.id)
    if (missing.length === 0) return
    let cancelled = false
    ;(async () => {
      const settled = await Promise.allSettled(missing.map((id) => getNote(id)))
      if (cancelled) return
      setContent((prev) => {
        const next = { ...prev }
        missing.forEach((id, i) => {
          const r = settled[i]
          next[id] = r.status === 'fulfilled' ? (r.value.content ?? null) : null
        })
        return next
      })
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows])

  const selectedCount = useMemo(() => rows.filter((r) => r.selected).length, [rows])

  function toggleRow(id: string) {
    setRows((rs) => rs.map((r) => (r.note.id === id ? { ...r, selected: !r.selected } : r)))
  }
  function setAll(on: boolean) {
    setRows((rs) => rs.map((r) => ({ ...r, selected: on })))
  }

  // ── Spec editors (each updates the local spec copy) ──
  function setName(v: string) {
    setSpec((s) => withName(s, v))
  }
  function setType(v: EntityType) {
    setSpec((s) => withType(s, v))
  }
  function setSummary(v: string) {
    setSpec((s) => ({ ...s, entity: { ...s.entity, summary: v } }))
  }
  function setRelationship(v: string) {
    setSpec((s) => ({ ...s, links: { ...s.links, relationship: v } }))
  }
  function setField(key: string, v: unknown) {
    setSpec((s) => ({ ...s, entity: { ...s.entity, fields: { ...s.entity.fields, [key]: v } } }))
  }
  function addAliasChip() {
    const v = aliasDraft.trim()
    if (!v) return
    setSpec((s) => {
      const next = dedupeAliases([...s.entity.aliases, v])
      return { ...s, entity: { ...s.entity, aliases: next } }
    })
    setAliasDraft('')
  }
  function removeAliasChip(a: string) {
    setSpec((s) => ({
      ...s,
      entity: { ...s.entity, aliases: s.entity.aliases.filter((x) => x !== a) },
    }))
  }

  // Existing-entity picker (reuse the in-memory index; search name/summary/alias).
  const entityResults = useMemo(() => {
    const q = entityQuery.trim().toLowerCase()
    if (!q) return [] as Note[]
    return entities
      .filter((e) => {
        const n = entityName(e).toLowerCase()
        const s = String(e.metadata?.summary ?? '').toLowerCase()
        const al = entityAliases(e).some((a) => a.toLowerCase().includes(q))
        return n.includes(q) || s.includes(q) || al
      })
      .slice(0, 8)
  }, [entityQuery, entities])

  // Capability A: does this proposal's name already exist as an entity?
  const duplicate = useMemo(() => {
    if (target) return null
    const match = findExistingEntity(baseName, entities, baseSpec.entity.type)
    return (match as Note) ?? null
  }, [baseName, entities, target, baseSpec])

  // The path the captures will be linked to: an existing target, or the
  // (possibly edited) spec's path that Accept will create.
  const willCreate = target === null
  const effectiveType = target ? (entityTypeOf(target) ?? type) : type
  const effectivePath = target ? target.path : spec.entity.path
  const effectiveName = target ? entityName(target) : name.trim()
  const effectiveRel = relationship || suggestRel(effectiveType as EntityType)

  // Shared worker: create (maybe) + link selected captures. Does NOT resolve.
  async function doCreateAndLink(): Promise<{ summary: string; linked: string[] }> {
    const selected = rows.filter((r) => r.selected)
    if (willCreate) {
      if (!name.trim()) throw new Error('Give the entity a name before accepting.')
      setProgress(`Creating ${type} “${name.trim()}”…`)
      await createEntity(type, name.trim(), summary, aliases, fields)
      reloadEntities()
    } else if (addNameAsAlias && baseName.trim()) {
      setProgress(`Adding “${baseName.trim()}” as an alias of ${effectiveName}…`)
      await addAlias(target!.id, baseName.trim())
      reloadEntities()
    }

    let linked = 0
    const linkedNow: string[] = []
    for (const r of selected) {
      setProgress(`Linking captures… (${linked + 1}/${selected.length})`)
      await linkCapture(r.note.id, effectivePath, effectiveRel)
      linkedNow.push(r.note.id)
      linked++
    }
    const where = willCreate ? `Created ${effectiveName}` : `Linked to ${effectiveName}`
    return { summary: `${where}, linked ${linked} capture${linked === 1 ? '' : 's'}`, linked: linkedNow }
  }

  // The edited spec to persist on resolve: reflects the current selected captures
  // so the audit record matches what was executed.
  function executedSpec(linkedNow: string[]): ProposalSpec {
    return {
      ...spec,
      entity: { ...spec.entity, path: effectivePath },
      links: {
        ...spec.links,
        relationship: effectiveRel,
        captures: linkedNow.length ? linkedNow : rows.filter((r) => r.selected).map((r) => r.note.id),
      },
    }
  }

  // ── Primary Accept: create (maybe) + link + persist edited spec + RESOLVE ──
  async function accept() {
    setBusy(true)
    setError(null)
    try {
      const { summary: msg, linked } = await doCreateAndLink()
      setProgress('Resolving proposal…')
      await resolveProposalWithSpec(proposal.id, JSON.stringify(executedSpec(linked)), 'approved')
      onResolved(proposal.id, `${msg} 🌿`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
      setProgress(null)
    }
  }

  // ── Capability A: one-click "this already exists" ──
  async function acceptAsDuplicate(existing: Note) {
    setBusy(true)
    setError(null)
    try {
      const selected = rows.filter((r) => r.selected)
      const rel = suggestRel((entityTypeOf(existing) ?? 'reference') as EntityType)
      setProgress(`Adding “${baseName}” as an alias of ${entityName(existing)}…`)
      await addAlias(existing.id, baseName)
      reloadEntities()
      let linked = 0
      for (const r of selected) {
        setProgress(`Linking captures… (${linked + 1}/${selected.length})`)
        await linkCapture(r.note.id, existing.path, rel)
        linked++
      }
      setProgress('Resolving proposal…')
      await resolveProposal(proposal.id, 'approved')
      onResolved(
        proposal.id,
        `Linked ${linked} capture${linked === 1 ? '' : 's'} to ${entityName(existing)} · added “${baseName}” as alias 🌿`,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
      setProgress(null)
    }
  }

  // ── Capability C: "Link selected & keep open" — link a subset, DON'T resolve ──
  async function linkAndKeepOpen() {
    setBusy(true)
    setError(null)
    try {
      const { summary: msg, linked } = await doCreateAndLink()
      setLinkedIds((s) => {
        const next = new Set(s)
        linked.forEach((id) => next.add(id))
        return next
      })
      setRows((rs) =>
        rs.map((r) => (linked.includes(r.note.id) ? { ...r, selected: false } : r)),
      )
      setSplitLog((l) => [...l, msg])
      setProgress(null)
      setBusy(false)
      onPartial(proposal.id, `${msg} — still open to split further`)
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
  const hasSplit = splitLog.length > 0
  const acceptLabel = hasSplit
    ? selectedCount > 0
      ? `Accept & close · ${willCreate ? 'create + link' : `link ${selectedCount}`}`
      : 'Accept & close'
    : willCreate
      ? `Accept · create + link ${selectedCount}`
      : `Accept · link ${selectedCount} to ${effectiveName}`

  // Human-readable summary of a type-specific field for the read view.
  const fieldSummary = useMemo(() => {
    const parts: string[] = []
    if (type === 'project') {
      if (fields.status) parts.push(String(fields.status))
      if (fields.role) parts.push(String(fields.role))
    } else if (type === 'person' && fields.relation) {
      parts.push(String(fields.relation))
    } else if ((type === 'place' || type === 'reference') && fields.kind) {
      parts.push(String(fields.kind))
    }
    return parts.join(' · ')
  }, [type, fields])

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
        <span className="pc-type-tag">{effectiveType}</span>
        <span className="pc-conf" title="Weaver confidence">{confPct}%</span>
      </div>

      {/* Read view (when not editing): summary, type-specific facets, evidence. */}
      {!editing && summary && <p className="pc-summary">{summary}</p>}
      {!editing && willCreate && (fieldSummary || aliases.length > 0) && (
        <p className="pc-facets">
          <span className="pc-facets-path">{spec.entity.path}</span>
          {fieldSummary && <span className="pc-facet">{fieldSummary}</span>}
          {aliases.length > 0 && (
            <span className="pc-facet pc-facet-aliases">aka {aliases.join(', ')}</span>
          )}
        </p>
      )}

      {evidence && (
        <p className="pc-why">
          <span className="pc-why-label">Why</span> {evidence}
        </p>
      )}

      {/* ── Capability A: duplicate detection — surfaced prominently ── */}
      {duplicate && !editing && (
        <div className="pc-dup">
          <div className="pc-dup-text">
            Looks like <strong>{duplicate.path}</strong> — link &amp; add “{baseName}” as alias?
          </div>
          <button
            className="btn pc-dup-btn"
            onClick={() => acceptAsDuplicate(duplicate)}
            disabled={busy || loadingCaps}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <LinkIcon />
              Link to {entityName(duplicate)} &amp; add alias
            </span>
          </button>
        </div>
      )}

      {/* ── Capability C: log of split passes done so far ── */}
      {hasSplit && (
        <div className="pc-splitlog">
          <span className="pc-splitlog-label">Done so far</span>
          <ul>
            {splitLog.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
          <span className="pc-splitlog-hint">
            Still pending — edit the entity &amp; pick the remaining captures, or Accept &amp; close.
          </span>
        </div>
      )}

      {/* ── The friendly edit form (NO raw JSON) ── */}
      {editing && (
        <div className="pc-form">
          {!target ? (
            <>
              <div className="pc-field">
                <label className="field-label">Name</label>
                <input
                  className="search-box"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Entity name"
                />
                <span className="pc-field-hint">Saves to {spec.entity.path}</span>
              </div>

              <div className="pc-field">
                <label className="field-label">Type</label>
                <select
                  className="pc-select"
                  value={type}
                  onChange={(e) => setType(e.target.value as EntityType)}
                >
                  {ENTITY_TYPES.map((t) => (
                    <option key={t} value={t}>{t} → {TYPE_FOLDER[t]}/…</option>
                  ))}
                </select>
              </div>

              <div className="pc-field">
                <label className="field-label">Summary</label>
                <textarea
                  className="pc-textarea"
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  placeholder="One-line summary"
                  rows={3}
                />
              </div>

              <div className="pc-field">
                <label className="field-label">Aliases</label>
                <div className="pc-chips">
                  {aliases.map((a) => (
                    <span key={a} className="pc-chip">
                      {a}
                      <button
                        type="button"
                        className="pc-chip-x"
                        onClick={() => removeAliasChip(a)}
                        aria-label={`Remove ${a}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  <input
                    className="pc-chip-input"
                    value={aliasDraft}
                    onChange={(e) => setAliasDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ',') {
                        e.preventDefault()
                        addAliasChip()
                      } else if (e.key === 'Backspace' && !aliasDraft && aliases.length) {
                        removeAliasChip(aliases[aliases.length - 1])
                      }
                    }}
                    onBlur={addAliasChip}
                    placeholder={aliases.length ? 'Add another…' : 'Add an alias…'}
                  />
                </div>
              </div>

              {/* ── Type-specific fields ── */}
              {type === 'project' && (
                <div className="pc-field-row">
                  <div className="pc-field">
                    <label className="field-label">Status</label>
                    <select
                      className="pc-select"
                      value={String(fields.status ?? 'active')}
                      onChange={(e) => setField('status', e.target.value)}
                    >
                      {PROJECT_STATUSES.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                  <div className="pc-field">
                    <label className="field-label">Role</label>
                    <input
                      className="search-box"
                      value={String(fields.role ?? '')}
                      onChange={(e) => setField('role', e.target.value)}
                      placeholder="Your role (optional)"
                    />
                  </div>
                </div>
              )}
              {type === 'person' && (
                <div className="pc-field">
                  <label className="field-label">Relation</label>
                  <select
                    className="pc-select"
                    value={String(fields.relation ?? 'friend')}
                    onChange={(e) => setField('relation', e.target.value)}
                  >
                    {PERSON_RELATIONS.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </div>
              )}
              {type === 'place' && (
                <div className="pc-field">
                  <label className="field-label">Kind</label>
                  <select
                    className="pc-select"
                    value={String(fields.kind ?? 'venue')}
                    onChange={(e) => setField('kind', e.target.value)}
                  >
                    {PLACE_KINDS.map((k) => (
                      <option key={k} value={k}>{k}</option>
                    ))}
                  </select>
                </div>
              )}
              {type === 'reference' && (
                <div className="pc-field">
                  <label className="field-label">Kind</label>
                  <select
                    className="pc-select"
                    value={String(fields.kind ?? 'book')}
                    onChange={(e) => setField('kind', e.target.value)}
                  >
                    {REFERENCE_KINDS.map((k) => (
                      <option key={k} value={k}>{k}</option>
                    ))}
                  </select>
                </div>
              )}
            </>
          ) : (
            <div className="pc-target">
              <span className={`chip t-${entityTypeOf(target) ?? ''}`}>
                <span className="dot" />
                <span className="name">{entityName(target)}</span>
              </span>
              <button className="text-toggle" onClick={() => { setTarget(null); setEntityQuery('') }}>
                clear · create new instead
              </button>
              {baseName.trim() && (
                <label className="pc-alias-check">
                  <input
                    type="checkbox"
                    checked={addNameAsAlias}
                    onChange={(e) => setAddNameAsAlias(e.target.checked)}
                  />
                  also add “{baseName}” as an alias
                </label>
              )}
            </div>
          )}

          {/* ── Re-target to an existing entity ── */}
          {!target && (
            <div className="pc-field" style={{ marginTop: 4 }}>
              <label className="field-label">…or link these captures to an existing entity</label>
              <input
                className="search-box"
                placeholder="Search existing — name, summary, or alias…"
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
            </div>
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
            {hasCurated ? 'Curated captures' : 'Supporting captures'} — this will link{' '}
            {selectedCount} of {rows.length}
          </span>
          {rows.length > 0 && (
            <span className="pc-cap-actions">
              <button className="text-toggle" onClick={() => setAll(true)}>all</button>
              <span>·</span>
              <button className="text-toggle" onClick={() => setAll(false)}>none</button>
            </span>
          )}
        </div>

        {hasCurated && (
          <p className="pc-cap-curated-note">
            The judge confirmed these {curatedIds.length} capture
            {curatedIds.length === 1 ? '' : 's'} for this entity — pre-selected. Search below to
            add more.
          </p>
        )}

        <div className="pc-cap-search">
          <span className="pc-cap-search-label">{hasCurated ? 'Add' : 'Search'}</span>
          <input
            className="search-box"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={
              hasCurated
                ? 'Add more captures — search by name, alias, or topic…'
                : 'Search by any term — name, alias, or topic…'
            }
          />
        </div>

        {loadingCaps && <div className="pc-cap-loading">Finding captures…</div>}
        {capError && <div className="config-err">{capError}</div>}
        {!loadingCaps && rows.length === 0 && !capError && (
          <div className="pc-cap-empty">
            {searchTerm.trim()
              ? `No captures match “${searchTerm.trim()}”.`
              : 'No captures to show — search above to add some.'}
          </div>
        )}

        <div className="pc-cap-list">
          {rows.map((r) => (
            <label key={r.note.id} className={`pc-cap-row ${r.selected ? 'on' : 'off'} ${linkedIds.has(r.note.id) ? 'linked' : ''}`}>
              <input
                type="checkbox"
                checked={r.selected}
                onChange={() => toggleRow(r.note.id)}
              />
              <span className="pc-cap-text">
                <CaptureMention
                  note={r.note}
                  content={r.note.content ?? content[r.note.id] ?? null}
                  terms={matchTerms}
                />
                <span className="pc-cap-date">
                  {formatDayHeading(dayKey(r.note.createdAt))}
                  {linkedIds.has(r.note.id) && <span className="pc-cap-linked"> · linked</span>}
                </span>
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
          onClick={() => setEditing((v) => !v)}
          disabled={busy}
        >
          {editing ? 'Done editing' : 'Edit'}
        </button>
        {/* Capability C: secondary action — link a subset, keep the card open. */}
        <button
          className="btn-ghost btn pc-keepopen"
          onClick={linkAndKeepOpen}
          disabled={busy || loadingCaps || selectedCount === 0}
          title="Link the selected captures now but leave this proposal open to split into another entity"
        >
          Link selected &amp; keep open
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

// One capture row's text: the sentence-ish slice where the proposed entity is
// actually named, with the matched term highlighted. Falls back to a plain
// preview when content hasn't loaded or contains no literal mention.
function CaptureMention({
  note,
  content,
  terms,
}: {
  note: Note
  content: string | null
  terms: string[]
}) {
  const snippet = useMemo(
    () => (content ? mentionSnippet(content, terms) : null),
    [content, terms],
  )
  if (snippet) {
    return (
      <span className="pc-cap-preview">
        {snippet.before}
        <mark className="pc-cap-hit">{snippet.match}</mark>
        {snippet.after}
      </span>
    )
  }
  const text = previewText(note) || note.preview?.trim() || entityName(note)
  return (
    <span className="pc-cap-preview pc-cap-preview-fallback" title="No literal name match — showing a preview">
      {text}
    </span>
  )
}
