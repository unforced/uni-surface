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
  setJobEnabled,
  updateJobSchedule,
  createAgentJob,
  updateAgentPrompt,
  setAgentStatus,
  isValidCron,
  isValidTz,
  isValidJobId,
  listOutboundMessages,
  lastOutboundByChannel,
  statusDotClass,
  agentHref,
  isRead,
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
  // Schedule editing: which job is open in the inline editor, its draft fields,
  // and which job has a write in flight (disables its buttons).
  const [editJob, setEditJob] = useState<string | null>(null)
  const [editCron, setEditCron] = useState('')
  const [editTz, setEditTz] = useState('')
  const [busyJob, setBusyJob] = useState<string | null>(null)
  const [schedErr, setSchedErr] = useState<string | null>(null)
  // Create-schedule: which agent's form is open, its draft fields, error, busy.
  const [addingFor, setAddingFor] = useState<string | null>(null)
  const [newJobId, setNewJobId] = useState('')
  const [newCron, setNewCron] = useState('')
  const [newTz, setNewTz] = useState('America/Denver')
  const [newMsg, setNewMsg] = useState('')
  const [addErr, setAddErr] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  // Definition editing: which agent's prompt is open in the editor, its draft.
  const [editDef, setEditDef] = useState<string | null>(null)
  const [defDraft, setDefDraft] = useState('')
  const [savingDef, setSavingDef] = useState(false)
  const [defErr, setDefErr] = useState<string | null>(null)

  async function toggleJob(j: AgentJob) {
    setBusyJob(j.id)
    try {
      await setJobEnabled(j.id, !j.enabled)
      await jobs.reload()
    } finally {
      setBusyJob(null)
    }
  }
  function startEditJob(j: AgentJob) {
    setEditJob(j.id)
    setEditCron(j.cron)
    setEditTz(j.tz)
    setSchedErr(null)
  }
  async function saveEditJob(j: AgentJob) {
    // Gate client-side: a direct vault write skips the daemon's validateJob, so a
    // bad cron/tz would be silently dropped by the runner.
    if (!isValidCron(editCron)) {
      setSchedErr('cron must be 5 numeric fields: min hour day-of-month month day-of-week')
      return
    }
    if (!isValidTz(editTz)) {
      setSchedErr('unknown timezone — use an IANA name like America/Denver (or leave blank)')
      return
    }
    setSchedErr(null)
    setBusyJob(j.id)
    try {
      await updateJobSchedule(j.id, editCron, editTz)
      setEditJob(null)
      await jobs.reload()
    } finally {
      setBusyJob(null)
    }
  }
  function startAddJob(agentName: string) {
    setAddingFor(agentName)
    setNewJobId('')
    setNewCron('')
    setNewTz('America/Denver')
    setNewMsg('')
    setAddErr(null)
  }
  async function submitAddJob(agentName: string) {
    if (!isValidJobId(newJobId)) {
      setAddErr('id: letters, numbers, dash, underscore only')
      return
    }
    if ((jobsBy.get(agentName) ?? []).some((j) => j.jobId === newJobId.trim())) {
      setAddErr('a schedule with that id already exists for this agent')
      return
    }
    if (!isValidCron(newCron)) {
      setAddErr('cron must be 5 numeric fields: min hour day-of-month month day-of-week')
      return
    }
    if (!isValidTz(newTz)) {
      setAddErr('unknown timezone — use an IANA name like America/Denver (or leave blank)')
      return
    }
    if (!newMsg.trim()) {
      setAddErr('message: the text the runner delivers to the agent each fire')
      return
    }
    setAddErr(null)
    setCreating(true)
    try {
      await createAgentJob({
        agent: agentName,
        jobId: newJobId,
        cron: newCron,
        tz: newTz,
        message: newMsg,
      })
      setAddingFor(null)
      await jobs.reload()
    } catch (e) {
      setAddErr(e instanceof Error ? e.message : String(e))
    } finally {
      setCreating(false)
    }
  }
  function startEditDef(a: Agent) {
    setOpenPrompt(a.defId)
    setEditDef(a.defId)
    setDefDraft(a.prompt)
    setDefErr(null)
  }
  async function saveDef(a: Agent) {
    if (!defDraft.trim()) {
      setDefErr('prompt cannot be empty')
      return
    }
    if (
      !confirm(
        `Edit ${a.name}'s system prompt?\n\nThis changes how the agent behaves on its next run.`,
      )
    )
      return
    setSavingDef(true)
    setDefErr(null)
    try {
      await updateAgentPrompt(a.defId, defDraft)
      setEditDef(null)
      await roster.reload()
    } catch (e) {
      setDefErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSavingDef(false)
    }
  }
  async function toggleStatus(a: Agent) {
    const next = a.status === 'enabled' ? 'disabled' : 'enabled'
    if (!confirm(`Set ${a.name} to ${next}?`)) return
    await setAgentStatus(a.defId, next)
    await roster.reload()
  }

  const lastBy = useMemo(() => lastOutboundByChannel(outbound.data ?? []), [outbound.data])
  const jobsBy = useMemo(() => jobsByAgent(jobs.data ?? []), [jobs.data])

  // channel → count of outbound messages not yet read (vault-backed read-state,
  // so the badge is honest across devices — set when Aaron opens the thread).
  const unreadBy = useMemo(() => {
    const counts = new Map<string, number>()
    for (const n of outbound.data ?? []) {
      if (isRead(n)) continue
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
                  {a.defId && a.status && (
                    <button className="arm-tag arm-tag-btn" onClick={() => toggleStatus(a)}>
                      {a.status === 'enabled' ? 'disable' : 'enable'}
                    </button>
                  )}
                </div>
                {promptOpen && (
                  <div className="arm-prompt">
                    {editDef === a.defId ? (
                      <div className="arm-prompt-edit">
                        <textarea
                          className="arm-prompt-textarea"
                          value={defDraft}
                          onChange={(e) => setDefDraft(e.target.value)}
                          rows={Math.min(28, Math.max(8, defDraft.split('\n').length + 1))}
                          spellCheck
                          aria-label={`${a.name} system prompt`}
                        />
                        {defErr && <span className="arm-sched-err">{defErr}</span>}
                        <div className="arm-sched-add-row">
                          <button
                            className="arm-sched-btn"
                            disabled={savingDef}
                            onClick={() => saveDef(a)}
                          >
                            {savingDef ? 'saving…' : 'save prompt'}
                          </button>
                          <button
                            className="arm-sched-btn ghost"
                            disabled={savingDef}
                            onClick={() => {
                              setEditDef(null)
                              setDefErr(null)
                            }}
                          >
                            cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <Markdown content={a.prompt} />
                        <button className="arm-prompt-editbtn" onClick={() => startEditDef(a)}>
                          edit prompt
                        </button>
                      </>
                    )}
                  </div>
                )}
                {sched.length > 0 && (
                  <div className="arm-sched">
                    {sched.map((j) => {
                      const editing = editJob === j.id
                      const working = busyJob === j.id
                      return (
                        <div key={j.id} className="arm-sched-row" title={j.cron}>
                          {editing ? (
                            <span className="arm-sched-edit">
                              <input
                                className="arm-sched-input"
                                value={editCron}
                                onChange={(e) => setEditCron(e.target.value)}
                                placeholder="min hr dom mon dow"
                                aria-label="cron expression"
                              />
                              <input
                                className="arm-sched-input tz"
                                value={editTz}
                                onChange={(e) => setEditTz(e.target.value)}
                                placeholder="America/Denver"
                                aria-label="timezone"
                              />
                              <button
                                className="arm-sched-btn"
                                disabled={working}
                                onClick={() => saveEditJob(j)}
                              >
                                {working ? '…' : 'save'}
                              </button>
                              <button
                                className="arm-sched-btn ghost"
                                disabled={working}
                                onClick={() => {
                                  setEditJob(null)
                                  setSchedErr(null)
                                }}
                              >
                                cancel
                              </button>
                              {schedErr && <span className="arm-sched-err">{schedErr}</span>}
                            </span>
                          ) : (
                            <>
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
                              <button
                                className="arm-sched-btn"
                                disabled={working}
                                onClick={() => toggleJob(j)}
                              >
                                {working ? '…' : j.enabled ? 'pause' : 'resume'}
                              </button>
                              <button
                                className="arm-sched-btn ghost"
                                disabled={working}
                                onClick={() => startEditJob(j)}
                              >
                                edit
                              </button>
                            </>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
                {addingFor === a.channel ? (
                  <div className="arm-sched-add">
                    <div className="arm-sched-add-fields">
                      <input
                        className="arm-sched-input id"
                        value={newJobId}
                        onChange={(e) => setNewJobId(e.target.value)}
                        placeholder="id (e.g. weave)"
                        aria-label="job id"
                      />
                      <input
                        className="arm-sched-input"
                        value={newCron}
                        onChange={(e) => setNewCron(e.target.value)}
                        placeholder="min hr dom mon dow"
                        aria-label="cron expression"
                      />
                      <input
                        className="arm-sched-input tz"
                        value={newTz}
                        onChange={(e) => setNewTz(e.target.value)}
                        placeholder="America/Denver"
                        aria-label="timezone"
                      />
                    </div>
                    <textarea
                      className="arm-sched-msg"
                      value={newMsg}
                      onChange={(e) => setNewMsg(e.target.value)}
                      placeholder="message the runner delivers to the agent each fire…"
                      rows={2}
                      aria-label="scheduled message"
                    />
                    <div className="arm-sched-add-row">
                      <button
                        className="arm-sched-btn"
                        disabled={creating}
                        onClick={() => submitAddJob(a.channel)}
                      >
                        {creating ? '…' : 'create'}
                      </button>
                      <button
                        className="arm-sched-btn ghost"
                        disabled={creating}
                        onClick={() => setAddingFor(null)}
                      >
                        cancel
                      </button>
                      {addErr && <span className="arm-sched-err">{addErr}</span>}
                    </div>
                  </div>
                ) : (
                  <button className="arm-sched-addbtn" onClick={() => startAddJob(a.channel)}>
                    + schedule
                  </button>
                )}
              </div>
              <div className="arm-side">
                <Link className="arm-chan" to={agentHref(a.channel)}>
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
