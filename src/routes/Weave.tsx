import { useEffect, useMemo, useState } from 'react'
import { listNotes, listPendingProposals } from '../vault/api'
import type { Note } from '../vault/types'
import { type EntityType } from '../vault/types'
import { captureKindOf } from '../vault/types'
import { useAsync } from '../vault/useAsync'
import { Loading, ErrorBanner, EmptyState, Toast } from '../components/common'
import { ProposalCard } from '../components/ProposalCard'
import { CaptureTriage } from '../components/CaptureTriage'
import { captureGlyph } from '../components/icons'
import { previewText, formatRelative } from '../vault/util'
import { parseProposalSpec } from '../vault/proposalSpec'
import { CAPTURE_CREATED_EVENT } from '../App'

// Read a proposal's type/confidence for grouping + sorting. Prefers the JSON
// intent in the note content (the new shape); falls back to metadata.* for
// older proposals (parseProposalSpec handles both transparently).
export function proposalEntityType(p: Note): EntityType {
  return parseProposalSpec(p).entity.type
}
export function proposalConfidence(p: Note): number {
  return parseProposalSpec(p).confidence
}

// Sort: highest confidence first, grouped under entity-type headings.
const TYPE_ORDER: EntityType[] = [
  'person',
  'project',
  'organization',
  'place',
  'thread',
  'practice',
  'tool',
  'reference',
  'seed',
]

// Recent unwoven captures shown on the Unwoven tab.
const UNWOVEN_LIMIT = 50

type Tab = 'proposals' | 'unwoven'

export function Weave() {
  const [tab, setTab] = useState<Tab>('proposals')
  const [toast, setToast] = useState<string | null>(null)

  // ── Proposals queue ──
  const proposals = useAsync(() => listPendingProposals(), [])
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(new Set())

  // ── Unwoven captures (the relocated "To weave" tray) ──
  const unwoven = useAsync(
    () =>
      listNotes({
        tag: 'capture',
        hasLinks: false,
        sort: 'desc',
        limit: UNWOVEN_LIMIT,
        includeContent: true,
      }),
    [],
  )
  const [triaging, setTriaging] = useState<Note | null>(null)
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set())

  function flash(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2600)
  }

  // Refresh the unwoven list when a capture lands anywhere in the app.
  useEffect(() => {
    const onCreated = () => unwoven.reload()
    window.addEventListener(CAPTURE_CREATED_EVENT, onCreated)
    return () => window.removeEventListener(CAPTURE_CREATED_EVENT, onCreated)
    // reload fns are stable from useAsync; intentionally run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Pull a card from the list the moment it's resolved (optimistic), then
  // refresh from the vault so counts stay true.
  function onResolved(id: string, msg: string) {
    setResolvedIds((s) => new Set(s).add(id))
    flash(msg)
    proposals.reload()
    // Let the nav badge (and any other view) refresh too.
    window.dispatchEvent(new CustomEvent(PROPOSAL_RESOLVED_EVENT, { detail: id }))
  }

  // Capability C: work was done (captures linked / entity created) but the
  // proposal is INTENTIONALLY left pending so the user can split it further.
  // Flash a note; do NOT remove or re-fetch (that would remount the card and
  // wipe its in-progress split state).
  function onPartial(_id: string, msg: string) {
    flash(msg)
  }

  // ── Triage flow handlers (reused from the old Today tray) ──
  function onTriageChanged() {
    unwoven.reload()
    // Linking a capture can clear a proposal's evidence too; refresh the badge.
    window.dispatchEvent(new CustomEvent(PROPOSAL_RESOLVED_EVENT))
  }
  function onTriageDeleted(id: string) {
    setRemovedIds((s) => new Set(s).add(id))
    flash('Deleted 🍂')
    unwoven.reload()
    window.dispatchEvent(new CustomEvent(PROPOSAL_RESOLVED_EVENT))
  }

  // Belt-and-suspenders: the list must ONLY ever show pending proposals.
  // `listPendingProposals()` already filters by status (the vault ignores the
  // metadata filter server-side, so it filters client-side), and we also drop
  // anything optimistically resolved this session so a card can never linger.
  const pending = useMemo(
    () =>
      (proposals.data ?? []).filter(
        (p) =>
          !resolvedIds.has(p.id) &&
          (p.metadata?.status ?? 'pending') === 'pending',
      ),
    [proposals.data, resolvedIds],
  )

  const trayItems = useMemo(
    () => (unwoven.data ?? []).filter((c) => !removedIds.has(c.id)),
    [unwoven.data, removedIds],
  )

  // Group by entity_type, ordered, each group sorted by confidence desc.
  const groups = useMemo(() => {
    const byType = new Map<EntityType, Note[]>()
    for (const p of pending) {
      const t = proposalEntityType(p)
      ;(byType.get(t) ?? byType.set(t, []).get(t)!).push(p)
    }
    const out: { type: EntityType; items: Note[] }[] = []
    for (const t of TYPE_ORDER) {
      const items = byType.get(t)
      if (items && items.length) {
        items.sort((a, b) => proposalConfidence(b) - proposalConfidence(a))
        out.push({ type: t, items })
      }
    }
    // any unexpected types not in TYPE_ORDER
    for (const [t, items] of byType) {
      if (!TYPE_ORDER.includes(t)) out.push({ type: t, items })
    }
    return out
  }, [pending])

  const proposalCount = pending.length
  const unwovenCount = trayItems.length

  return (
    <div className="page">
      <div className="page-head">
        <div className="kicker">Weaver</div>
        <h1>Weave</h1>
        <p className="sub">
          Tend the graph: review the Weaver's proposed entities, and connect the captures still
          waiting to be woven. Nothing is created until you say so.
        </p>
      </div>

      {/* ── Segmented control: Proposals · Unwoven ── */}
      <div className="weave-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === 'proposals'}
          className={`weave-tab ${tab === 'proposals' ? 'sel' : ''}`}
          onClick={() => setTab('proposals')}
        >
          Proposals
          <span className="weave-tab-count">{proposalCount}</span>
        </button>
        <button
          role="tab"
          aria-selected={tab === 'unwoven'}
          className={`weave-tab ${tab === 'unwoven' ? 'sel' : ''}`}
          onClick={() => setTab('unwoven')}
        >
          Unwoven
          <span className="weave-tab-count">{unwovenCount}</span>
        </button>
      </div>

      {/* ── Proposals tab ── */}
      {tab === 'proposals' && (
        <div className="weave-panel">
          {proposals.loading && <Loading label="Gathering the Weaver's proposals…" />}
          {Boolean(proposals.error) && (
            <ErrorBanner error={proposals.error} onRetry={proposals.reload} />
          )}
          {proposals.data && pending.length === 0 && (
            <EmptyState art="🌾" title="No proposals waiting">
              The Weaver has nothing pending. When it surfaces new entities, they'll gather here for
              your review.
            </EmptyState>
          )}

          {groups.map((g) => (
            <section className="proposal-group" key={g.type}>
              <h2 className="proposal-group-head">
                <span className={`pg-swatch t-${g.type}`} />
                {g.type}
                <span className="count">{g.items.length}</span>
              </h2>
              <div className="proposal-list">
                {g.items.map((p) => (
                  <ProposalCard
                    key={p.id}
                    proposal={p}
                    onResolved={onResolved}
                    onPartial={onPartial}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* ── Unwoven tab (the relocated To-weave tray) ── */}
      {tab === 'unwoven' && (
        <div className="weave-panel">
          <p className="weave-sub">
            Recent captures with no links yet. Open one to connect it to your projects, people, and
            threads.
          </p>
          {unwoven.loading && <Loading label="Finding loose threads…" />}
          {Boolean(unwoven.error) && <ErrorBanner error={unwoven.error} onRetry={unwoven.reload} />}
          {unwoven.data && trayItems.length === 0 && (
            <EmptyState art="🌾" title="Everything recent is woven">
              The garden is tended. When new captures land unlinked, they'll gather here.
            </EmptyState>
          )}
          <div className="weave-list">
            {trayItems.map((c) => {
              const kind = captureKindOf(c)
              return (
                <button key={c.id} className="weave-item" onClick={() => setTriaging(c)}>
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
      )}

      {triaging && (
        <CaptureTriage
          seed={triaging}
          onClose={() => setTriaging(null)}
          onChanged={onTriageChanged}
          onDeleted={onTriageDeleted}
        />
      )}
      {toast && <Toast message={toast} />}
    </div>
  )
}

// Fired after a proposal is accepted/skipped (or a capture is woven) so other
// views (the nav badge) refresh their counts.
export const PROPOSAL_RESOLVED_EVENT = 'pv:proposal-resolved'
