import { useMemo, useState } from 'react'
import { addAlias, deleteNote, getNote, linkCapture, patchNote, searchAllNotes } from '../vault/api'
import type { Note } from '../vault/types'
import { entityTypeOf } from '../vault/types'
import { useEntityIndex } from '../vault/EntityIndex'
import { entityName, entityLeaf, entityAliases } from '../vault/util'
import { CloseIcon } from './icons'

// Merge this entity (the source, B) INTO another (the survivor, A) — for two
// nodes that are the same thing, whether they always were or they converged. We
// fold B into A: re-point B's inbound/outbound links to A, add B's name + aliases
// as A's aliases, rewrite `[[B path]]` references to A, optionally bring B's note
// across, then delete B. Reversible from vault history.
export function MergeEntity({
  entity,
  onClose,
  onMerged,
}: {
  entity: Note
  onClose: () => void
  onMerged: (targetPath: string) => void
}) {
  const { entities, reload } = useEntityIndex()
  const [query, setQuery] = useState('')
  const [target, setTarget] = useState<Note | null>(null)
  const bodyLen = (entity.content ?? '').replace(/^#[^\n]*\n?/, '').trim().length
  const [bringContent, setBringContent] = useState(bodyLen > 40)
  const [applying, setApplying] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    return entities
      .filter((e) => e.id !== entity.id)
      .filter(
        (e) =>
          !q ||
          entityName(e).toLowerCase().includes(q) ||
          String(e.metadata?.summary ?? '').toLowerCase().includes(q),
      )
      .slice(0, 10)
  }, [query, entities, entity.id])

  const linkCount = (entity.links ?? []).filter(
    (l) => l.relationship !== 'wikilink' && (l.targetId === entity.id || l.sourceId === entity.id),
  ).length

  async function merge() {
    if (!target) return
    setApplying(true)
    setError(null)
    const A = target
    const B = entity
    try {
      // 1. Aliases: B's name + aliases become A's aliases. Use the literal leaf
      // (not the display name, which may resolve to the parent folder).
      setProgress('Folding aliases…')
      for (const a of [entityLeaf(B), ...entityAliases(B)]) await addAlias(A.id, a)

      // 2. Re-point B's links to A (wikilink edges follow the reference rewrite).
      setProgress('Re-pointing links…')
      for (const l of B.links ?? []) {
        if (l.relationship === 'wikilink') continue
        if (l.targetId === B.id && l.sourceId) {
          await linkCapture(l.sourceId, A.path, l.relationship).catch(() => {})
        } else if (l.sourceId === B.id && l.targetNote?.path) {
          await patchNote(A.id, {
            links: { add: [{ target: l.targetNote.path, relationship: l.relationship }] },
          }).catch(() => {})
        }
      }

      // 3. Rewrite [[B.path]] references → [[A.path]] in any note that holds them.
      setProgress('Rewriting references…')
      const refs = await searchAllNotes(entityLeaf(B)).catch(() => [] as Note[])
      for (const n of refs) {
        if (n.id === B.id || n.id === A.id) continue
        const c = n.content ?? ''
        if (!c.includes('[[' + B.path)) continue
        const fixed = c.split('[[' + B.path).join('[[' + A.path)
        if (fixed !== c) await patchNote(n.id, { content: fixed }).catch(() => {})
      }

      // 4. Optionally bring B's note body across.
      if (bringContent && (B.content ?? '').trim()) {
        setProgress('Bringing the note across…')
        const aFull = await getNote(A.id)
        const body = (B.content ?? '').replace(/^#[^\n]*\n?/, '').trim()
        const merged = `${aFull.content ?? ''}\n\n---\n*Merged from ${entityLeaf(B)}:*\n\n${body}\n`
        await patchNote(A.id, { content: merged })
      }

      // 5. Remove the merged node.
      setProgress('Removing the merged node…')
      await deleteNote(B.id)
      reload()
      onMerged(A.path)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setApplying(false)
      setProgress(null)
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <h3>Merge “{entityName(entity)}” into…</h3>
          <button className="icon-btn x" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>
        <div className="panel-body">
          {!target ? (
            <>
              <p className="field-label">Search for the entity to merge into (the one that survives)</p>
              <input
                className="search-box"
                autoFocus
                placeholder="The surviving entity…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <div className="result-list">
                {results.map((e) => (
                  <button
                    key={e.id}
                    className={`result-row t-${entityTypeOf(e) ?? ''}`}
                    onClick={() => setTarget(e)}
                  >
                    <span className="rr-type">{entityTypeOf(e)}</span>
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <div className="rr-name">{entityName(e)}</div>
                      {e.metadata?.summary ? <div className="rr-sum">{String(e.metadata.summary)}</div> : null}
                    </span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="merge-summary">
                <strong>{entityName(entity)}</strong> <span className="merge-arrow">→</span>{' '}
                <strong>{entityName(target)}</strong>
                <button className="text-toggle" onClick={() => setTarget(null)} style={{ marginLeft: 'auto' }}>
                  change
                </button>
              </div>
              <p className="merge-note">
                Moves {entityName(entity)}'s ~{linkCount} link{linkCount === 1 ? '' : 's'} (captures,
                connections) onto {entityName(target)}, adds “{entityName(entity)}” + its aliases as
                aliases, rewrites <code>[[…]]</code> references, then removes {entityName(entity)}.
                Reversible from history.
              </p>
              <label className="merge-check">
                <input
                  type="checkbox"
                  checked={bringContent}
                  onChange={(e) => setBringContent(e.target.checked)}
                />
                Append {entityName(entity)}'s note into {entityName(target)}
              </label>
              {error && <div className="config-err" style={{ marginTop: 12 }}>{error}</div>}
              <div className="btn-row">
                <button className="btn-ghost btn" onClick={onClose} disabled={applying}>
                  Cancel
                </button>
                <div className="spacer" />
                <button className="btn" onClick={merge} disabled={applying}>
                  {applying ? (progress ?? 'Merging…') : `Merge into ${entityName(target)}`}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
