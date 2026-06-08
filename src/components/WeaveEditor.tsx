import { useMemo, useState } from 'react'
import { patchNote, createNote, linkCapture, type LinkAdd } from '../vault/api'
import type { Note } from '../vault/types'
import { ENTITY_TYPES, entityTypeOf, type EntityType } from '../vault/types'
import { useEntityIndex } from '../vault/EntityIndex'
import { entityName, previewText } from '../vault/util'
import { DetectedEntities } from './DetectedEntities'
import { CloseIcon, LinkIcon, PlusIcon } from './icons'

const RELATIONSHIPS = ['relates-to', 'mentions', 'develops', 'at', 'part-of', 'practices', 'uses', 'references']

// Default path folder per type (matches the vault's layout).
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

// Suggest a relationship from the target entity's type.
function suggestRel(type: EntityType | null): string {
  switch (type) {
    case 'person': return 'mentions'
    case 'place': return 'at'
    case 'thread': return 'part-of'
    case 'practice': return 'practices'
    case 'tool': return 'uses'
    case 'reference': return 'references'
    default: return 'relates-to'
  }
}

interface Pending { entity: Note; relationship: string }

export function WeaveEditor({
  capture,
  onClose,
  onWoven,
  onLinked,
}: {
  capture: Note
  onClose: () => void
  onWoven: (updated: Note) => void
  // Called after a Detected-entities link is written directly (the editor stays
  // open). Lets the parent refresh its "Woven into" display without closing.
  onLinked?: () => void
}) {
  const { entities, reload: reloadEntities } = useEntityIndex()
  const [query, setQuery] = useState('')
  const [pending, setPending] = useState<Pending[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  // Entity ids linked directly from the Detected-entities scan this session.
  // Excluded everywhere (detection, search, count) and folded into "already
  // linked" so they can't be re-staged.
  const [directLinked, setDirectLinked] = useState<Set<string>>(new Set())

  // new-entity form
  const [newType, setNewType] = useState<EntityType>('person')
  const [newName, setNewName] = useState('')
  const [newSummary, setNewSummary] = useState('')

  const alreadyLinkedIds = useMemo(() => {
    const s = new Set<string>()
    for (const l of capture.links ?? []) if (l.targetId) s.add(l.targetId)
    for (const id of directLinked) s.add(id)
    return s
  }, [capture, directLinked])

  // Write a detected entity's link immediately (mirror of Unlinked mentions),
  // then mark it linked so its row drops and the manual search excludes it.
  async function linkDetected(entity: Note, rel: string) {
    await linkCapture(capture.id, entity.path, rel)
    setDirectLinked((prev) => new Set(prev).add(entity.id))
    onLinked?.()
  }

  const pendingIds = useMemo(
    () => new Set(pending.map((p) => p.entity.id)),
    [pending],
  )

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    const pool = entities.filter(
      (e) => !alreadyLinkedIds.has(e.id) && !pendingIds.has(e.id),
    )
    if (!q) {
      // show a calm default: a spread of types
      return pool.slice(0, 8)
    }
    return pool
      .filter((e) => {
        const name = entityName(e).toLowerCase()
        const sum = String(e.metadata?.summary ?? '').toLowerCase()
        return name.includes(q) || sum.includes(q)
      })
      .slice(0, 12)
  }, [query, entities, pendingIds, alreadyLinkedIds])

  function addPending(entity: Note) {
    setPending((p) => [...p, { entity, relationship: suggestRel(entityTypeOf(entity)) }])
    setQuery('')
  }
  function removePending(id: string) {
    setPending((p) => p.filter((x) => x.entity.id !== id))
  }
  function setRel(id: string, rel: string) {
    setPending((p) => p.map((x) => (x.entity.id === id ? { ...x, relationship: rel } : x)))
  }

  async function save() {
    if (pending.length === 0) return
    setSaving(true)
    setError(null)
    try {
      const add: LinkAdd[] = pending.map((p) => ({
        target: p.entity.path,
        relationship: p.relationship,
      }))
      const updated = await patchNote(capture.id, { links: { add } })
      onWoven(updated)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSaving(false)
    }
  }

  async function createAndStage() {
    const name = newName.trim()
    if (!name) return
    setSaving(true)
    setError(null)
    try {
      const path = `${TYPE_FOLDER[newType]}/${name}`
      const created = await createNote({
        path,
        content: `# ${name}\n`,
        tags: [newType],
        metadata: newSummary.trim() ? { summary: newSummary.trim() } : {},
      })
      reloadEntities()
      setPending((p) => [...p, { entity: created, relationship: suggestRel(newType) }])
      setShowCreate(false)
      setNewName('')
      setNewSummary('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <span style={{ color: 'var(--clay)' }}>
            <LinkIcon />
          </span>
          <h3>Weave this capture</h3>
          <button className="icon-btn x" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>
        <div className="panel-body">
          <div className="panel-quote">{previewText(capture, 600) || '(no text)'}</div>

          {/* Auto-suggested links: entities this capture names (capture→entity,
              the mirror of an entity's Unlinked mentions). Excludes already-
              linked + already-staged so it never offers a duplicate. */}
          <DetectedEntities
            capture={capture}
            alreadyLinkedIds={alreadyLinkedIds}
            excludeIds={pendingIds}
            onLink={linkDetected}
          />

          {pending.length > 0 && (
            <>
              <p className="field-label">Links to add</p>
              <div className="added-links">
                {pending.map((p) => (
                  <span key={p.entity.id} className={`added-pill t-${entityTypeOf(p.entity) ?? ''}`}>
                    <span className="dot" style={{ width: 7, height: 7, borderRadius: 9, background: 'var(--tc)' }} />
                    {entityName(p.entity)}
                    <button className="rm" onClick={() => removePending(p.entity.id)} aria-label="Remove">×</button>
                  </span>
                ))}
              </div>
              {pending.map((p) => (
                <div key={p.entity.id} style={{ marginBottom: 6 }}>
                  <div className="rel-row">
                    <span style={{ fontSize: 12.5, color: 'var(--ink-soft)', alignSelf: 'center', marginRight: 4 }}>
                      {entityName(p.entity)}:
                    </span>
                    {RELATIONSHIPS.map((r) => (
                      <button
                        key={r}
                        className={`rel-pick ${p.relationship === r ? 'sel' : ''}`}
                        onClick={() => setRel(p.entity.id, r)}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}

          {!showCreate && (
            <>
              <p className="field-label" style={{ marginTop: pending.length ? 18 : 0 }}>
                Find an entity to link
              </p>
              <input
                className="search-box"
                autoFocus
                placeholder="Search projects, people, threads, places…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <div className="result-list">
                {results.map((e) => (
                  <button key={e.id} className={`result-row t-${entityTypeOf(e) ?? ''}`} onClick={() => addPending(e)}>
                    <span className="rr-type">{entityTypeOf(e)}</span>
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <div className="rr-name">{entityName(e)}</div>
                      {e.metadata?.summary ? <div className="rr-sum">{String(e.metadata.summary)}</div> : null}
                    </span>
                  </button>
                ))}
                {query && results.length === 0 && (
                  <div style={{ padding: 12, color: 'var(--ink-faint)', fontSize: 13.5 }}>
                    No matches — create a new entity below.
                  </div>
                )}
              </div>

              <div className="divider-or">or</div>
              <button className="btn-ghost btn" style={{ width: '100%' }} onClick={() => setShowCreate(true)}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <PlusIcon /> Create a new entity
                </span>
              </button>
            </>
          )}

          {showCreate && (
            <>
              <p className="field-label">New entity</p>
              <div className="inline-create">
                <select value={newType} onChange={(e) => setNewType(e.target.value as EntityType)}>
                  {ENTITY_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t} → {TYPE_FOLDER[t]}/…
                    </option>
                  ))}
                </select>
                <input
                  placeholder="Name (e.g. Adam Elfers)"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  autoFocus
                />
                <input
                  placeholder="One-line summary (optional)"
                  value={newSummary}
                  onChange={(e) => setNewSummary(e.target.value)}
                />
              </div>
              <div className="btn-row">
                <button className="btn-ghost btn" onClick={() => setShowCreate(false)}>
                  Cancel
                </button>
                <div className="spacer" />
                <button className="btn" disabled={!newName.trim() || saving} onClick={createAndStage}>
                  {saving ? 'Creating…' : 'Create & stage link'}
                </button>
              </div>
            </>
          )}

          {error && <div className="config-err" style={{ marginTop: 16 }}>{error}</div>}

          {!showCreate && (
            <div className="btn-row">
              <button className="btn-ghost btn" onClick={onClose}>
                Later
              </button>
              <div className="spacer" />
              <button className="btn" disabled={pending.length === 0 || saving} onClick={save}>
                {saving
                  ? 'Weaving…'
                  : pending.length
                    ? `Weave ${pending.length} link${pending.length > 1 ? 's' : ''}`
                    : 'Weave'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
