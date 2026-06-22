import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { listSurfaces, listPendingProposals } from '../vault/api'
import type { Note } from '../vault/types'
import { useAsync } from '../vault/useAsync'
import { CAPTURE_CREATED_EVENT } from '../App'
import { PROPOSAL_RESOLVED_EVENT } from './Weave'
import { MorningCard } from '../components/MorningCard'
import { SurfaceCard } from '../components/SurfaceCard'
import { ProposalCard } from '../components/ProposalCard'
import { ChannelMessageCard, ReportCard } from '../components/ChannelMessageCard'
import { Loading, ErrorBanner, EmptyState, Toast } from '../components/common'
import { formatRelative } from '../vault/util'
import {
  type Agent,
  tsOf,
  senderOf,
  senderLabel,
  fetchAgentRoster,
  listOutboundMessages,
  lastOutboundByChannel,
  seenMap,
} from '../vault/channels'

// One item in the merged stream, tagged with which organ it came from.
type FeedKind = 'surface' | 'proposal' | 'message' | 'report'
interface FeedItem {
  kind: FeedKind
  ts: string
  note: Note
}

type Filter = 'all' | 'foryou' | 'weave' | 'channels'
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'foryou', label: 'For You' },
  { id: 'weave', label: 'Weave' },
  { id: 'channels', label: 'Channels' },
]

const reportAsks = (n: Note) => Number(n.metadata?.asks ?? 0)

// Home — the one stream. Everything that wants Aaron's eyes, merged: open
// surfaces (For You), pending proposals (Weave), and unseen arm messages +
// reports (Channels), needs-you items pinned first, the rest reverse-chron.
// The morning card sits on top (Home absorbs Today; the full Today spine
// stays at /today). Seen channel messages drop out — they live in the thread.
export function Home() {
  const [filter, setFilter] = useState<Filter>('all')
  const [toast, setToast] = useState<string | null>(null)
  // Proposals optimistically pulled from the list the moment they're resolved.
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(new Set())

  // Mount-time clock for the "quiet today" window (stable across re-renders).
  const [now] = useState(() => Date.now())

  const surfaces = useAsync(() => listSurfaces(), [])
  const proposals = useAsync(() => listPendingProposals(), [])
  // Snapshot the seen-map WITH the messages: cards mark themselves seen as they
  // render, but stay visible for this visit (the next load drops them).
  const messages = useAsync(
    async () => ({ msgs: await listOutboundMessages(), seen: seenMap() }),
    [],
  )
  const roster = useAsync(() => fetchAgentRoster().catch(() => [] as Agent[]), [])

  // Re-pull when a capture lands/syncs (answers drop surfaces) or a proposal is
  // decided elsewhere.
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
    // reload fns are stable from useAsync; intentionally run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function flash(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2600)
  }

  function onProposalResolved(id: string, msg: string) {
    setResolvedIds((s) => new Set(s).add(id))
    flash(msg)
    proposals.reload()
    window.dispatchEvent(new CustomEvent(PROPOSAL_RESOLVED_EVENT, { detail: id }))
  }

  const openSurfaces = useMemo(
    () => (surfaces.data ?? []).filter((s) => (s.metadata?.state ?? 'open') === 'open'),
    [surfaces.data],
  )
  const pendingProposals = useMemo(
    () =>
      (proposals.data ?? []).filter(
        (p) => !resolvedIds.has(p.id) && (p.metadata?.status ?? 'pending') === 'pending',
      ),
    [proposals.data, resolvedIds],
  )

  const unseenMsgs = useMemo(
    () => (messages.data?.msgs ?? []).filter((m) => !messages.data?.seen[m.id]),
    [messages.data],
  )

  // ── The merged feed. In 'all', surfaces stay out of the stream — the morning
  // card on top already renders every open surface (no duplicate cards). ──
  const feed = useMemo(() => {
    const items: FeedItem[] = []
    if (filter === 'foryou') {
      for (const s of openSurfaces) items.push({ kind: 'surface', ts: s.createdAt ?? '', note: s })
    }
    if (filter === 'all' || filter === 'weave') {
      for (const p of pendingProposals)
        items.push({ kind: 'proposal', ts: p.createdAt ?? '', note: p })
    }
    if (filter === 'all' || filter === 'channels') {
      for (const m of unseenMsgs) {
        const kind: FeedKind = String(m.metadata?.kind ?? '') === 'report' ? 'report' : 'message'
        items.push({ kind, ts: tsOf(m), note: m })
      }
    }
    // Needs-you pinned first (surfaces, proposals, reports with asks), then
    // everything reverse-chron.
    const needsYou = (it: FeedItem) =>
      it.kind === 'surface' ||
      it.kind === 'proposal' ||
      (it.kind === 'report' && reportAsks(it.note) > 0)
    const byTs = (a: FeedItem, b: FeedItem) => b.ts.localeCompare(a.ts)
    return [...items.filter(needsYou).sort(byTs), ...items.filter((it) => !needsYou(it)).sort(byTs)]
  }, [filter, openSurfaces, pendingProposals, unseenMsgs])

  // ── Attention ledger: what's waiting + who reported last + who's gone quiet. ──
  const ledger = useMemo(() => {
    const outbound = messages.data?.msgs ?? []
    const waiting =
      openSurfaces.length +
      pendingProposals.length +
      unseenMsgs.filter((m) => String(m.metadata?.kind ?? '') === 'report' && reportAsks(m) > 0)
        .length
    let latestReport: Note | null = null
    for (const m of outbound) {
      if (String(m.metadata?.kind ?? '') !== 'report') continue
      if (!latestReport || tsOf(m) > tsOf(latestReport)) latestReport = m
    }
    const lastBy = lastOutboundByChannel(outbound)
    const dayAgo = new Date(now - 24 * 3600000).toISOString()
    const quiet = (roster.data ?? []).filter(
      (a) => a.status === 'enabled' && (lastBy.get(a.channel) ?? '') < dayAgo,
    )
    return { waiting, latestReport, quiet }
  }, [messages.data, openSurfaces, pendingProposals, unseenMsgs, roster.data, now])

  const loading = surfaces.loading || proposals.loading || messages.loading
  const firstError = surfaces.error ?? proposals.error ?? messages.error

  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <div className="page-head">
        <div className="kicker">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
        <h1>Home</h1>
        <p className="sub">One stream — what the vault and the agents are holding for you.</p>
      </div>

      {/* Attention ledger */}
      <div className="hm-ledger">
        <div className="hm-ledger-line">
          <span className="hm-waiting">
            {ledger.waiting > 0
              ? `${ledger.waiting} decision${ledger.waiting === 1 ? '' : 's'} waiting`
              : 'Nothing needs you'}
          </span>
          {ledger.latestReport && (
            <span className="hm-reported">
              · {senderLabel(senderOf(ledger.latestReport))} reported{' '}
              {formatRelative(tsOf(ledger.latestReport))}
            </span>
          )}
          <Link className="hm-agents" to="/agents">agents →</Link>
        </div>
        {ledger.quiet.map((a) => (
          <div key={a.channel} className="hm-quiet">{a.channel}: quiet today</div>
        ))}
      </div>

      {/* Morning prompts (Home absorbs Today's opening ritual) */}
      <MorningCard />

      {/* Filter chips */}
      <div className="hm-chips" role="tablist">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            role="tab"
            aria-selected={filter === f.id}
            className={`hm-chip${filter === f.id ? ' sel' : ''}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading && feed.length === 0 && <Loading label="Gathering the stream…" />}
      {Boolean(firstError) && feed.length === 0 && (
        <ErrorBanner
          error={firstError}
          onRetry={() => {
            surfaces.reload()
            proposals.reload()
            messages.reload()
          }}
        />
      )}
      {!loading && feed.length === 0 && !firstError && (
        <EmptyState art="🌾" title="The stream is clear">
          Nothing new from the agents, no proposals pending. When something wants your eyes, it
          lands here.
        </EmptyState>
      )}

      <div className="hm-feed">
        {feed.map((it) => {
          if (it.kind === 'surface') {
            return <SurfaceCard key={it.note.id} surface={it.note} onChanged={surfaces.reload} />
          }
          if (it.kind === 'proposal') {
            return (
              <ProposalCard
                key={it.note.id}
                proposal={it.note}
                onResolved={onProposalResolved}
                onPartial={(_id, msg) => flash(msg)}
              />
            )
          }
          if (it.kind === 'report') return <ReportCard key={it.note.id} note={it.note} />
          return <ChannelMessageCard key={it.note.id} note={it.note} />
        })}
      </div>

      {toast && <Toast message={toast} />}
    </div>
  )
}
