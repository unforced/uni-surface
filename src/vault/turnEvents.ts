// The agent daemon's ephemeral "watch it work" stream. Unlike messages and
// thread status (which live in the vault), the chatty turn detail rides the
// daemon's turn-events SSE so it never churns the vault. This is the (d) layer
// of watch-it-work; the (c) "thinking…" pill (thread status) works without it.
//
// Endpoint: <hub>/agent/api/channels/<agent>/turn-events?token=<agent:read jwt>
// (EventSource can't set headers, so the token rides as ?token). Events arrive
// as `event: turn` with JSON data. All kinds are additive — ignore unknowns.

export type TurnEvent =
  | { kind: 'init'; sessionId?: string }
  | { kind: 'text'; text: string } // partial assistant text, streams in
  | { kind: 'tool'; tool: string; input?: string } // input = args JSON, ≤2000 chars
  | { kind: 'tool_result'; tool?: string; ok?: boolean; preview?: string } // preview ≤2000 chars

// A tool call as it unfolds: the call, then its matched result.
export interface TurnTool {
  tool: string
  input?: string
  ok?: boolean
  preview?: string
  done: boolean
}

// The accumulated state of the current turn, for rendering.
export interface TurnState {
  sessionId?: string
  text: string
  tools: TurnTool[]
}

export const emptyTurn = (): TurnState => ({ text: '', tools: [] })

// Fold one event into the running turn. `init` starts a fresh turn so a new
// run doesn't show the previous turn's trail.
export function foldTurn(prev: TurnState, e: TurnEvent): TurnState {
  switch (e.kind) {
    case 'init':
      return { sessionId: e.sessionId, text: '', tools: [] }
    case 'text':
      return { ...prev, text: prev.text + (e.text ?? '') }
    case 'tool':
      return { ...prev, tools: [...prev.tools, { tool: e.tool, input: e.input, done: false }] }
    case 'tool_result': {
      // Attach to the last not-yet-done tool that matches the labeled name (or
      // simply the last open one when unlabeled).
      const tools = [...prev.tools]
      for (let i = tools.length - 1; i >= 0; i--) {
        if (tools[i].done) continue
        if (e.tool && tools[i].tool !== e.tool) continue
        tools[i] = { ...tools[i], ok: e.ok, preview: e.preview, done: true }
        return { ...prev, tools }
      }
      return prev
    }
    default:
      return prev
  }
}

export interface TurnEventHandlers {
  onEvent: (e: TurnEvent) => void
  onOpen?: () => void
  onError?: () => void
}

// Subscribe to an agent's turn-events. `hubOrigin` is the agent daemon / hub
// origin (the OAuth issuer host — carried on the agent:read auth context, which
// can differ from the vault data origin). Returns an unsubscribe.
export function subscribeTurnEvents(
  hubOrigin: string,
  agent: string,
  token: string,
  h: TurnEventHandlers,
): () => void {
  if (typeof EventSource === 'undefined' || !hubOrigin || !token) return () => {}
  const base = hubOrigin.replace(/\/$/, '')
  const url = `${base}/agent/api/channels/${encodeURIComponent(agent)}/turn-events?token=${encodeURIComponent(token)}`
  const es = new EventSource(url)
  es.addEventListener('turn', (e) => {
    try {
      h.onEvent(JSON.parse((e as MessageEvent).data) as TurnEvent)
    } catch {
      /* ignore malformed frames */
    }
  })
  if (h.onOpen) es.onopen = () => h.onOpen?.()
  if (h.onError) es.onerror = () => h.onError?.()
  return () => es.close()
}
