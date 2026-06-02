import { useMemo, useState } from 'react'
import { listPendingProposals } from '../vault/api'
import type { Note } from '../vault/types'
import { type EntityType } from '../vault/types'
import { useAsync } from '../vault/useAsync'
import { Loading, ErrorBanner, EmptyState, Toast } from '../components/common'
import { ProposalCard } from '../components/ProposalCard'

// Read a proposal's Weaver metadata with sane fallbacks.
export function proposalEntityType(p: Note): EntityType {
  return (p.metadata?.entity_type as EntityType) ?? 'reference'
}
export function proposalConfidence(p: Note): number {
  const c = Number(p.metadata?.confidence)
  return Number.isFinite(c) ? c : 0
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

export function Proposals() {
  const proposals = useAsync(() => listPendingProposals(), [])
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(new Set())
  const [toast, setToast] = useState<string | null>(null)

  function flash(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2600)
  }

  // Pull a card from the list the moment it's resolved (optimistic), then
  // refresh from the vault so counts stay true.
  function onResolved(id: string, msg: string) {
    setResolvedIds((s) => new Set(s).add(id))
    flash(msg)
    proposals.reload()
    // Let Today's badge refresh too.
    window.dispatchEvent(new CustomEvent(PROPOSAL_RESOLVED_EVENT, { detail: id }))
  }

  const pending = useMemo(
    () => (proposals.data ?? []).filter((p) => !resolvedIds.has(p.id)),
    [proposals.data, resolvedIds],
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

  return (
    <div className="page">
      <div className="page-head">
        <div className="kicker">Weaver</div>
        <h1>Proposals to review</h1>
        <p className="sub">
          Each one creates an entity and links the captures behind it. Nothing happens until you
          accept — review the evidence, trim the captures, then weave it in.
        </p>
      </div>

      {proposals.loading && <Loading label="Gathering the Weaver's proposals…" />}
      {Boolean(proposals.error) && <ErrorBanner error={proposals.error} onRetry={proposals.reload} />}
      {proposals.data && pending.length === 0 && (
        <EmptyState art="🌾" title="No proposals waiting">
          The Weaver has nothing pending. When it surfaces new entities, they'll gather here for
          your review.
        </EmptyState>
      )}

      {pending.length > 0 && (
        <p className="proposals-count">
          <strong>{pending.length}</strong> proposal{pending.length === 1 ? '' : 's'} pending
        </p>
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
              />
            ))}
          </div>
        </section>
      ))}

      {toast && <Toast message={toast} />}
    </div>
  )
}

// Fired after a proposal is accepted/skipped so other views (Today) refresh.
export const PROPOSAL_RESOLVED_EVENT = 'pv:proposal-resolved'
