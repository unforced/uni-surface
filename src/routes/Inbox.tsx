import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { listSurfaces, listPendingProposals } from '../vault/api'
import { listOutboundMessages, tsOf, senderOf } from '../vault/channels'
import { parseProposalSpec } from '../vault/proposalSpec'
import type { Note } from '../vault/types'
import { useAsync } from '../vault/useAsync'
import { CAPTURE_CREATED_EVENT } from '../App'
import { PROPOSAL_RESOLVED_EVENT } from './Weave'
import { Markdown } from '../components/Markdown'
import { SenderChip } from '../components/ChannelMessageCard'
import { RespondMenu } from '../components/RespondMenu'
import { Loading, ErrorBanner } from '../components/common'
import { formatRelative } from '../vault/util'
import { dismissFeedItem, restoreFeedItem, dismissedFeedIds } from '../vault/feedDismissed'

// The For You feed — the membrane of the proactive system (Uni/Design/The
// Uni-native surface → "The For You feed"). Everything the system surfaces for
// Aaron's attention, as named cards: open `surface`s, pending `proposal`s, and
// `report`-kind messages carrying asks. (Noticings will arrive on this same
// path — they render as surfaces.) Two actions per item: **Dismiss** (drop it,
// locally + reversibly) and **Respond** (drop into conversation with Uni, or a
// chosen agent, carrying the item as context). Calm by default — named cards,
// never an opaque counter; quiet when nothing's waiting.

type FeedKind = 'surface' | 'proposal' | 'report'
interface FeedItem {
  kind: FeedKind
  ts: string
  note: Note
}

const reportAsks = (n: Note) => Number(n.metadata?.asks ?? 0)

// A one-line, human gloss of a proposal — what the Weaver wants to do — without
// the heavy editor (that lives in Weave). Falls back gracefully.
function proposalGloss(note: Note): string {
  try {
    const spec = parseProposalSpec(note)
    const name = spec.entity?.name?.trim()
    if (spec.kind === 'update_entity') return name ? `Update ${name}` : 'Update an entity'
    if (spec.kind === 'link') return name ? `Link captures to ${name}` : 'Link captures'
    if (spec.kind === 'add_alias') return name ? `Add an alias for ${name}` : 'Add an alias'
    return name ? `Create ${spec.entity?.type ?? 'entity'} “${name}”` : 'Create an entity'
  } catch {
    return 'A proposal from the Weaver'
  }
}

const KIND_LABEL: Record<FeedKind, string> = {
  surface: 'noticing',
  proposal: 'proposal',
  report: 'report',
}

// One feed item as a calm card: a kind accent, a glanceable header, the body,
// and the two actions (Respond + Dismiss). The respond target carries the item's
// path as `?ref=`, so the reply threads back to it in the graph.
function FeedCard({ item, onDismiss }: { item: FeedItem; onDismiss: (id: string) => void }) {
  const { kind, note } = item
  const when = tsOf(note)
  const domain = kind === 'surface' && note.metadata?.domain ? String(note.metadata.domain) : null
  const surfaceKind = kind === 'surface' ? String(note.metadata?.surface_kind ?? '') : ''

  return (
    <article className={`fy-card fy-${kind}`}>
      <div className="fy-head">
        <span className="fy-kind">{surfaceKind && surfaceKind !== 'inquiry' ? surfaceKind : KIND_LABEL[kind]}</span>
        {kind === 'report' && <SenderChip sender={senderOf(note)} />}
        {kind === 'report' && reportAsks(note) > 0 && (
          <span className="fy-asks">{reportAsks(note)} ask{reportAsks(note) === 1 ? '' : 's'}</span>
        )}
        {domain && <span className="fy-domain">{domain}</span>}
        <span className="fy-spacer" />
        {when && <span className="fy-when">{formatRelative(when)}</span>}
      </div>

      <div className="fy-body">
        {kind === 'proposal' ? (
          <>
            <div className="fy-prop-title">{proposalGloss(note)}</div>
            {note.metadata?.evidence && (
              <p className="fy-prop-why">{String(note.metadata.evidence)}</p>
            )}
          </>
        ) : (
          <Markdown content={note.content ?? ''} />
        )}
      </div>

      <div className="fy-actions">
        <RespondMenu notePath={note.path} />
        {kind === 'proposal' && (
          <Link className="fy-review" to="/weave" title="Review and approve in Weave">
            review in Weave →
          </Link>
        )}
        <span className="fy-spacer" />
        <button className="fy-dismiss" onClick={() => onDismiss(note.id)} title="Drop this from the feed">
          Dismiss
        </button>
      </div>
    </article>
  )
}

export function Inbox() {
  const surfaces = useAsync(() => listSurfaces(), [])
  const proposals = useAsync(() => listPendingProposals(), [])
  const messages = useAsync(() => listOutboundMessages(), [])
  const [dismissed, setDismissed] = useState<Set<string>>(() => dismissedFeedIds())
  const [showDismissed, setShowDismissed] = useState(false)

  // Re-pull when a capture lands/syncs (answers drop surfaces) or a proposal is
  // decided elsewhere (Weave).
  useEffect(() => {
    const r = () => {
      surfaces.reload()
      proposals.reload()
    }
    window.addEventListener(CAPTURE_CREATED_EVENT, r)
    window.addEventListener('pv:capture-synced', r)
    window.addEventListener(PROPOSAL_RESOLVED_EVENT, r)
    return () => {
      window.removeEventListener(CAPTURE_CREATED_EVENT, r)
      window.removeEventListener('pv:capture-synced', r)
      window.removeEventListener(PROPOSAL_RESOLVED_EVENT, r)
    }
    // reload fns are stable from useAsync; run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function dismiss(id: string) {
    dismissFeedItem(id)
    setDismissed((s) => new Set(s).add(id))
  }
  function restore(id: string) {
    restoreFeedItem(id)
    setDismissed((s) => {
      const next = new Set(s)
      next.delete(id)
      return next
    })
  }

  // The candidate items, before the dismiss filter: open surfaces, pending
  // proposals, report-messages carrying asks. Newest first.
  const allItems = useMemo<FeedItem[]>(() => {
    const items: FeedItem[] = []
    for (const s of surfaces.data ?? []) {
      if ((s.metadata?.state ?? 'open') === 'open') {
        items.push({ kind: 'surface', ts: tsOf(s), note: s })
      }
    }
    for (const p of proposals.data ?? []) {
      if ((p.metadata?.status ?? 'pending') === 'pending') {
        items.push({ kind: 'proposal', ts: tsOf(p), note: p })
      }
    }
    for (const m of messages.data ?? []) {
      if (String(m.metadata?.kind ?? '') === 'report' && reportAsks(m) > 0) {
        items.push({ kind: 'report', ts: tsOf(m), note: m })
      }
    }
    return items.sort((a, b) => b.ts.localeCompare(a.ts))
  }, [surfaces.data, proposals.data, messages.data])

  const live = allItems.filter((it) => !dismissed.has(it.note.id))
  const dismissedItems = allItems.filter((it) => dismissed.has(it.note.id))

  const loading = surfaces.loading || proposals.loading || messages.loading
  const firstError = surfaces.error ?? proposals.error ?? messages.error
  const reloadAll = () => {
    surfaces.reload()
    proposals.reload()
    messages.reload()
  }

  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <div className="page-head">
        <div className="kicker">A living conversation</div>
        <h1>For You</h1>
        <p className="sub">
          What Uni and the agents are holding for you. Respond to drop into a conversation, or
          dismiss to let it rest.
        </p>
      </div>

      {loading && live.length === 0 && <Loading label="Gathering what's for you…" />}
      {Boolean(firstError) && live.length === 0 && <ErrorBanner error={firstError} onRetry={reloadAll} />}

      {!loading && live.length === 0 && !firstError && (
        <div className="fy-quiet">
          <span className="fy-quiet-art">🌾</span>
          <div className="fy-quiet-title">Nothing needs you</div>
          <p className="fy-quiet-sub">
            When Uni notices something, poses a reflection, or an agent reports back with a
            question, it lands here.
          </p>
        </div>
      )}

      {live.length > 0 && (
        <div className="fy-feed">
          {live.map((it) => (
            <FeedCard key={it.note.id} item={it} onDismiss={dismiss} />
          ))}
        </div>
      )}

      {dismissedItems.length > 0 && (
        <div className="fy-dismissed">
          <button className="text-toggle" onClick={() => setShowDismissed((v) => !v)}>
            {showDismissed ? 'Hide' : `Show ${dismissedItems.length} dismissed`}
          </button>
          {showDismissed && (
            <div className="fy-feed fy-feed-dim" style={{ marginTop: 12 }}>
              {dismissedItems.map((it) => (
                <article key={it.note.id} className={`fy-card fy-${it.kind} fy-card-dim`}>
                  <div className="fy-head">
                    <span className="fy-kind">{KIND_LABEL[it.kind]}</span>
                    <span className="fy-spacer" />
                    <button className="fy-restore" onClick={() => restore(it.note.id)}>
                      Restore
                    </button>
                  </div>
                  <div className="fy-body fy-body-dim">
                    {it.kind === 'proposal' ? (
                      <div className="fy-prop-title">{proposalGloss(it.note)}</div>
                    ) : (
                      <Markdown content={(it.note.content ?? '').slice(0, 240)} />
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
