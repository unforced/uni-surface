import { useMemo, useState } from 'react'
import { suggestRel } from '../vault/proposalSpec'
import type { Note } from '../vault/types'
import { entityTypeOf, RELATIONSHIP_LABELS } from '../vault/types'
import {
  entityMatchTerms,
  entityName,
  mentionSnippet,
  type MentionSnippet,
} from '../vault/util'
import { useEntityIndex } from '../vault/EntityIndex'

// The mirror of "Unlinked mentions" (entity→captures): here we go capture→
// entities. When a capture is opened to weave, scan its content against the
// already-in-memory entity index and surface the entities it names — by full
// name, bare first name, or any alias — that aren't already linked, each with a
// one-click Link (and Link all). No fetch, no AI: matching ~dozens of entities
// against one capture string is trivial, so it runs on open.

// A detected entity: the entity + its located snippet + the relationship a Link
// would create (derived from the entity's type).
interface Detection {
  entity: Note
  snippet: MentionSnippet
  rel: string
}

export function DetectedEntities({
  capture,
  alreadyLinkedIds,
  excludeIds,
  onLink,
}: {
  capture: Note
  // Entity ids already linked to this capture (excluded from detection).
  alreadyLinkedIds: Set<string>
  // Entity ids to also hide (e.g. ones the user has staged manually) — optional.
  excludeIds?: Set<string>
  // Called with the entity once a Link succeeds (parent stages/saves the edge).
  onLink: (entity: Note, rel: string) => Promise<void> | void
}) {
  const { entities } = useEntityIndex()
  const content = capture.content ?? ''

  // ids linked in THIS session — hidden immediately so the row drops out.
  const [linked, setLinked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null) // entity id, or '*' for all
  const [error, setError] = useState<string | null>(null)

  // Scan the capture content against every entity: a hit when any match term
  // (name + first word + aliases) appears whole-word in the text. mentionSnippet
  // does the whole-word, case-insensitive match AND returns the located snippet,
  // so detection + snippet are one pass. Already-linked entities are excluded.
  const detections = useMemo<Detection[]>(() => {
    if (!content.trim()) return []
    const out: Detection[] = []
    for (const e of entities) {
      if (alreadyLinkedIds.has(e.id)) continue
      if (excludeIds?.has(e.id)) continue
      const terms = entityMatchTerms(e)
      if (terms.length === 0) continue
      const snippet = mentionSnippet(content, terms)
      if (!snippet) continue // no whole-word mention
      out.push({ entity: e, snippet, rel: suggestRel(entityTypeOf(e) ?? 'project') })
    }
    return out
  }, [content, entities, alreadyLinkedIds, excludeIds])

  const visible = useMemo(
    () => detections.filter((d) => !linked.has(d.entity.id)),
    [detections, linked],
  )

  async function link(d: Detection) {
    setBusy(d.entity.id)
    setError(null)
    try {
      await onLink(d.entity, d.rel)
      setLinked((prev) => new Set(prev).add(d.entity.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not link.')
    } finally {
      setBusy(null)
    }
  }

  async function linkAll() {
    if (visible.length === 0) return
    setBusy('*')
    setError(null)
    const done = new Set(linked)
    try {
      for (const d of visible) {
        await onLink(d.entity, d.rel)
        done.add(d.entity.id)
      }
      setLinked(done)
    } catch (e) {
      setLinked(done) // keep whatever did link
      setError(e instanceof Error ? e.message : 'Could not link all.')
    } finally {
      setBusy(null)
    }
  }

  // Nothing detected — render a quiet line so the manual search still reads as
  // the way to add entities the scan didn't catch.
  if (visible.length === 0) {
    if (linked.size > 0) return null // they were all linked just now
    return (
      <p className="detected-empty">
        No entities detected — search below to add one.
      </p>
    )
  }

  return (
    <div className="detected">
      <p className="field-label detected-head">
        Detected entities
        <span className="detected-count">{visible.length}</span>
      </p>
      <p className="detected-lead">
        Named in this capture — a shared name can surface someone else, so skim
        the snippet before linking.
      </p>

      {error && <p className="detected-error">{error}</p>}

      <div className="detected-list">
        {visible.map((d) => {
          const type = entityTypeOf(d.entity)
          const relLabel = RELATIONSHIP_LABELS[d.rel] ?? d.rel
          return (
            <div className={`detected-row t-${type ?? ''}`} key={d.entity.id}>
              <div className="detected-text">
                <div className="detected-name-row">
                  <span className="detected-name">{entityName(d.entity)}</span>
                  <span className="detected-type">{type}</span>
                  <span className="detected-rel">{relLabel}</span>
                </div>
                <span className="pc-cap-preview detected-snippet">
                  {d.snippet.before}
                  <mark className="pc-cap-hit">{d.snippet.match}</mark>
                  {d.snippet.after}
                </span>
              </div>
              <button
                className="btn detected-link-btn"
                onClick={() => link(d)}
                disabled={busy !== null}
              >
                {busy === d.entity.id ? 'Linking…' : 'Link'}
              </button>
            </div>
          )
        })}
      </div>

      {visible.length > 1 && (
        <div className="detected-actions">
          <button className="btn btn-ghost" onClick={linkAll} disabled={busy !== null}>
            {busy === '*' ? 'Linking all…' : `Link all (${visible.length})`}
          </button>
        </div>
      )}
    </div>
  )
}
