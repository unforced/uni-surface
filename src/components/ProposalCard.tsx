import { useEffect, useMemo, useRef, useState } from 'react'
import {
  addAlias,
  createEntity,
  dedupeAliases,
  entityPath,
  fetchCapturesByIds,
  linkCapture,
  resolveProposal,
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
} from '../vault/util'
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
  onPartial,
}: {
  proposal: Note
  onResolved: (id: string, msg: string) => void
  // Capability C: report work done WITHOUT resolving (proposal stays pending).
  onPartial: (id: string, msg: string) => void
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
  // Capability B: editable aliases for "create new" (comma-separated input).
  const [aliasesText, setAliasesText] = useState('')
  // Capability B: when re-targeting, also add the original name as an alias.
  const [addNameAsAlias, setAddNameAsAlias] = useState(true)

  // ── Re-target: link to an EXISTING entity instead of creating one ──
  const [target, setTarget] = useState<Note | null>(null) // chosen existing entity
  const [entityQuery, setEntityQuery] = useState('')

  // ── Supporting captures (the evidence) ──
  // Curated path: when the proposal carries metadata.capture_ids, THOSE captures
  // are the supporting set (pre-checked) — not a name search. The search box then
  // becomes an "add more captures" affordance that merges extra captures in.
  // Fallback path (older proposals, no capture_ids): search by entity_name as
  // before, with the search box replacing the list on each query.
  const curatedIds = useMemo<string[]>(() => {
    const raw = meta.capture_ids
    if (!Array.isArray(raw)) return []
    return raw.map((id) => String(id)).filter((id) => id.trim() !== '')
  }, [meta.capture_ids])
  const hasCurated = curatedIds.length > 0

  // In curated mode the search box starts empty (we're NOT name-searching);
  // in fallback mode it seeds with the entity name (the legacy behavior).
  const [searchTerm, setSearchTerm] = useState(hasCurated ? '' : baseName)
  const [rows, setRows] = useState<CaptureRow[]>([])
  const [loadingCaps, setLoadingCaps] = useState(true)
  const [capError, setCapError] = useState<string | null>(null)
  const debounce = useRef<number | undefined>(undefined)

  // ── Execution ──
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Capability C: a running log of split actions done while keeping the card open,
  // plus the ids of captures already linked (so they don't get re-linked).
  const [splitLog, setSplitLog] = useState<string[]>([])
  const [linkedIds, setLinkedIds] = useState<Set<string>>(new Set())

  // Curated path: on mount, load exactly the captures in metadata.capture_ids,
  // pre-checked (except any already linked in a prior split pass). This is the
  // default supporting set — NOT a name search. Runs once for curated proposals;
  // fallback proposals skip it and rely on the search effect below.
  useEffect(() => {
    if (!hasCurated) return
    let cancelled = false
    // All setState happens inside the async block (loadingCaps already starts
    // true), so the effect body stays free of synchronous setState.
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
    // Mount-only for this proposal: curatedIds/hasCurated are derived from the
    // immutable proposal; linkedIds omitted so a split pass doesn't refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Search effect. In FALLBACK mode the term seeds with the entity name and the
  // results REPLACE the list (legacy behavior). In CURATED mode the term starts
  // empty and search results are MERGED in as additional captures — the curated
  // set is never wiped — so the box acts as an "add more captures" affordance.
  useEffect(() => {
    window.clearTimeout(debounce.current)
    const term = searchTerm.trim()
    debounce.current = window.setTimeout(async () => {
      if (!term) {
        // Curated: keep the curated rows in place; only the fallback list clears.
        if (!hasCurated) setRows([])
        setLoadingCaps(false)
        return
      }
      setLoadingCaps(true)
      setCapError(null)
      try {
        const found = await searchCaptures(term)
        if (hasCurated) {
          // Merge: add any captures not already present (curated or previously
          // added), pre-checked, without disturbing existing rows/selection.
          setRows((prev) => {
            const have = new Set(prev.map((r) => r.note.id))
            const additions = found
              .filter((n) => !have.has(n.id))
              .map((n) => ({ note: n, selected: !linkedIds.has(n.id) }))
            return additions.length ? [...prev, ...additions] : prev
          })
        } else {
          // default: all on, EXCEPT captures already linked in a prior split pass.
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
    // linkedIds intentionally omitted: re-running on every link would refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm])

  const selectedCount = useMemo(() => rows.filter((r) => r.selected).length, [rows])

  function toggleRow(id: string) {
    setRows((rs) => rs.map((r) => (r.note.id === id ? { ...r, selected: !r.selected } : r)))
  }
  function setAll(on: boolean) {
    setRows((rs) => rs.map((r) => ({ ...r, selected: on })))
  }

  // Existing-entity picker results (reuse the in-memory entity index). Searches
  // name, summary, AND aliases so the user can find by an alias (e.g. "Sandhiji").
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

  // Capability A: does this proposal's name likely already exist as an entity?
  // Only surfaced when we're still in "create new" mode (no manual re-target yet).
  const duplicate = useMemo(() => {
    if (target) return null
    const match = findExistingEntity(baseName, entities, baseType)
    return (match as Note) ?? null
  }, [baseName, baseType, entities, target])

  // The path the captures will be linked to: an existing target, or the
  // (possibly revised) name/type that Accept will create.
  const willCreate = target === null
  const effectiveType = target ? (entityTypeOf(target) ?? type) : type
  const effectivePath = target ? target.path : entityPath(type, name)
  const effectiveName = target ? entityName(target) : name.trim()
  const effectiveRel = relationship || suggestRel(effectiveType as EntityType)

  // Shared worker: create (maybe) + link selected captures. Returns a summary
  // string + the ids linked. Does NOT resolve the proposal — callers decide.
  async function doCreateAndLink(): Promise<{ summary: string; linked: string[] }> {
    const selected = rows.filter((r) => r.selected)
    if (willCreate) {
      if (!name.trim()) throw new Error('Give the entity a name before accepting.')
      setProgress(`Creating ${type} “${name.trim()}”…`)
      const aliasList = dedupeAliases(aliasesText.split(','))
      await createEntity(type, name.trim(), summary, aliasList)
      reloadEntities()
    } else if (addNameAsAlias && baseName.trim()) {
      // Capability B: re-targeting → optionally add the original name as an alias.
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

  // ── Primary Accept: create (maybe) + link + RESOLVE the proposal ──
  async function accept() {
    setBusy(true)
    setError(null)
    try {
      const { summary: msg } = await doCreateAndLink()
      setProgress('Resolving proposal…')
      await resolveProposal(proposal.id, 'approved')
      onResolved(proposal.id, `${msg} 🌿`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
      setProgress(null)
    }
  }

  // ── Capability A: one-click "this already exists" — link selected captures to
  // the existing entity, add the proposal's name as an alias, resolve approved. ──
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

  // ── Capability C: "Link selected & keep open" — do the create/link for the
  // SELECTED captures but DON'T resolve. Proposal stays pending so the user can
  // revise the name (e.g. second Miranda), pick the remaining captures, repeat. ──
  async function linkAndKeepOpen() {
    setBusy(true)
    setError(null)
    try {
      const { summary: msg, linked } = await doCreateAndLink()
      // Remember what we linked so those rows stay off on the next search.
      setLinkedIds((s) => {
        const next = new Set(s)
        linked.forEach((id) => next.add(id))
        return next
      })
      // Reflect immediately: deselect the just-linked rows.
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

      {summary && !revising && <p className="pc-summary">{summary}</p>}

      {evidence && (
        <p className="pc-why">
          <span className="pc-why-label">Why</span> {evidence}
        </p>
      )}

      {/* ── Capability A: duplicate detection — surfaced prominently ── */}
      {duplicate && !revising && (
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
            Still pending — revise the name &amp; pick the remaining captures, or Accept &amp; close.
          </span>
        </div>
      )}

      {/* ── Revise: edit name / type / summary / aliases, or re-target ── */}
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
            {/* Capability B: aliases for a newly-created entity. */}
            <input
              placeholder="Aliases (comma-separated, e.g. Sandhiji, Ji)"
              value={aliasesText}
              onChange={(e) => setAliasesText(e.target.value)}
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
              {/* Capability B: add the proposal's original name as an alias on retarget. */}
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
          ) : (
            <>
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
                <span className="pc-cap-preview">{r.note.preview?.trim() || entityName(r.note)}</span>
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
          onClick={() => setRevising((v) => !v)}
          disabled={busy}
        >
          {revising ? 'Done revising' : 'Revise'}
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
