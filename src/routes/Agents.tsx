import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAsync } from '../vault/useAsync'
import { getNote, listNotes } from '../vault/api'
import { Loading, ErrorBanner, EmptyState } from '../components/common'
import { Markdown } from '../components/Markdown'
import { formatRelative } from '../vault/util'
import {
  type Agent,
  type AgentJob,
  fetchAgentRoster,
  fetchAgentJobs,
  jobsByAgent,
  describeCron,
  listOutboundMessages,
  lastOutboundByChannel,
  statusDotClass,
  selectChannel,
  seenMap,
  noteAgentKey,
} from '../vault/channels'

// The window into Uni itself — the system's self-state (Uni/Now), the agent
// roster (every #agent/definition with its config, channel, pulse and unread
// count), and the recent session log. This is mission control: the one place
// that shows the whole octopus at a glance. Read-only — agents are created and
// edited in the agent app; this is the window, not the lever.
export function Agents() {
  const roster = useAsync(() => fetchAgentRoster(), [])
  // ONE query for all outbound messages; per-agent stats are grouped client-side.
  const outbound = useAsync(() => listOutboundMessages(), [])
  // Scheduled jobs (#agent/job), grouped by their target agent. Soft-fail: a
  // missing Schedules layer shouldn't blank the roster.
  const jobs = useAsync(() => fetchAgentJobs().catch(() => [] as AgentJob[]), [])
  // The system's working picture of itself + the recent log — cheap queries
  // (one note by path; a handful by prefix).
  const now = useAsync(() => getNote('Uni/Now'), [])
  const log = useAsync(
    () => listNotes({ pathPrefix: 'Uni/Log/', sort: 'desc', limit: 5, includeMetadata: true }),
    [],
  )
  const [nowOpen, setNowOpen] = useState(false)
  const [openPrompt, setOpenPrompt] = useState<string | null>(null)

  const lastBy = useMemo(() => lastOutboundByChannel(outbound.data ?? []), [outbound.data])
  const jobsBy = useMemo(() => jobsByAgent(jobs.data ?? []), [jobs.data])

  // channel → outbound messages Aaron hasn't seen yet (Home/Channels mark seen).
  const unreadBy = useMemo(() => {
    const seen = seenMap()
    const counts = new Map<string, number>()
    for (const n of outbound.data ?? []) {
      if (seen[n.id]) continue
      const c = noteAgentKey(n)
      if (!c) continue
      counts.set(c, (counts.get(c) ?? 0) + 1)
    }
    return counts
  }, [outbound.data])

  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <div className="page-head">
        <div className="kicker">the octopus</div>
        <h1>Uni</h1>
        <p className="sub">What Uni is up to — its self-state, every agent with its config and channel, and the recent log.</p>
      </div>

      {now.data && (
        <div className="uni-now">
          <button className="uni-now-head" onClick={() => setNowOpen((o) => !o)}>
            <span className="uni-now-title">Uni / Now</span>
            <span className="uni-now-meta">
              tended {formatRelative(now.data.updatedAt ?? now.data.createdAt)} · {nowOpen ? 'fold' : 'unfold'}
            </span>
          </button>
          {nowOpen && (
            <div className="uni-now-body">
              <Markdown content={now.data.content ?? ''} />
              <Link className="uni-now-open" to={`/note/${encodeURIComponent(now.data.path ?? now.data.id)}`}>
                open as note ↗
              </Link>
            </div>
          )}
        </div>
      )}

      {roster.loading && <Loading label="Reading the roster…" />}
      {Boolean(roster.error) && <ErrorBanner error={roster.error} onRetry={roster.reload} />}
      {roster.data && roster.data.length === 0 && (
        <EmptyState art="🐙" title="No agents yet">
          When <code>#agent/definition</code> notes land under <code>Agents/</code>, they'll gather here.
        </EmptyState>
      )}

      <div className="arms-list">
        {(roster.data ?? []).map((a: Agent) => {
          const last = lastBy.get(a.channel)
          const unread = unreadBy.get(a.channel) ?? 0
          const promptOpen = openPrompt === a.defId
          const sched = jobsBy.get(a.channel) ?? []
          return (
            <div key={a.defId || a.channel} className="arm-row">
              <div className="arm-main">
                <div className="arm-name">
                  <span className={`status-dot ${statusDotClass(a.status)}`} />
                  {a.name}
                  {a.status && <span className="arm-status">{a.status}</span>}
                </div>
                {a.summary && <div className="arm-summary">{a.summary}</div>}
                <div className="arm-config">
                  {a.backend && <span className="arm-tag">{a.backend}</span>}
                  {a.mode && <span className="arm-tag">{a.mode}</span>}
                  {a.model && <span className="arm-tag">{a.model}</span>}
                  {a.prompt && (
                    <button className="arm-tag arm-tag-btn" onClick={() => setOpenPrompt(promptOpen ? null : a.defId)}>
                      {promptOpen ? 'hide prompt' : 'prompt'}
                    </button>
                  )}
                </div>
                {promptOpen && (
                  <div className="arm-prompt">
                    <Markdown content={a.prompt} />
                  </div>
                )}
                {sched.length > 0 && (
                  <div className="arm-sched">
                    {sched.map((j) => (
                      <div key={j.id} className="arm-sched-row" title={j.cron}>
                        <span className="arm-sched-cron">
                          ⏱ {describeCron(j.cron)}
                          {j.tz && <span className="arm-sched-tz"> · {j.tz}</span>}
                        </span>
                        <span className={`arm-sched-state ${j.enabled ? 'on' : 'off'}`}>
                          {j.enabled ? 'enabled' : 'paused'}
                        </span>
                        {j.lastStatus && (
                          <span
                            className={`arm-sched-last ${j.lastStatus.startsWith('error') ? 'err' : 'ok'}`}
                          >
                            last: {j.lastStatus}
                            {j.lastRunAt && ` · ${formatRelative(j.lastRunAt)}`}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="arm-side">
                <Link className="arm-chan" to="/channels" onClick={() => selectChannel(a.channel)}>
                  #{a.channel}
                  {unread > 0 && <span className="arm-unread">{unread}</span>}
                </Link>
                <span className="arm-last">
                  {last ? `last spoke ${formatRelative(last)}` : 'no messages yet'}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {(log.data?.length ?? 0) > 0 && (
        <div className="uni-log">
          <div className="uni-log-head">Recent log</div>
          {(log.data ?? []).map((n) => (
            <Link
              key={n.id}
              className="uni-log-row"
              to={`/note/${encodeURIComponent(n.path ?? n.id)}`}
            >
              <span className="uni-log-title">{(n.path ?? '').replace(/^Uni\/Log\//, '')}</span>
              {typeof n.metadata?.summary === 'string' && (
                <span className="uni-log-sum">{n.metadata.summary}</span>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
