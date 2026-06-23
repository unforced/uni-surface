import { useState } from 'react'
import type { TurnState } from '../vault/turnEvents'

// The live "watch it work" view for the in-flight turn: streaming assistant text
// plus each tool call as an expandable row (name → args; result → ok/err badge +
// preview). Purely presentational over the folded TurnState; the SSE feeds it.
// Renders nothing when there's nothing to show, so it's safe to always mount.
export function TurnStream({ turn }: { turn: TurnState }) {
  const [open, setOpen] = useState<Set<number>>(new Set())
  const toggle = (i: number) =>
    setOpen((prev) => {
      const next = new Set(prev)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })

  if (!turn.text && turn.tools.length === 0) return null

  return (
    <div className="turn-stream">
      {turn.tools.map((t, i) => {
        const isOpen = open.has(i)
        const expandable = Boolean(t.input || t.preview)
        return (
          <div key={i} className="ts-tool">
            <button
              className="ts-tool-head"
              onClick={() => expandable && toggle(i)}
              disabled={!expandable}
            >
              <span className="ts-tool-mark">{t.done ? (t.ok === false ? '✕' : '✓') : '⋯'}</span>
              <span className="ts-tool-name">{t.tool}</span>
              {t.done && t.ok === false && <span className="ts-tool-badge err">error</span>}
              {expandable && <span className="ts-tool-caret">{isOpen ? '▾' : '▸'}</span>}
            </button>
            {isOpen && (
              <div className="ts-tool-body">
                {t.input && (
                  <div className="ts-block">
                    <div className="ts-block-k">input</div>
                    <pre className="ts-pre">{t.input}</pre>
                  </div>
                )}
                {t.preview && (
                  <div className="ts-block">
                    <div className="ts-block-k">result{t.ok === false ? ' (error)' : ''}</div>
                    <pre className="ts-pre">{t.preview}</pre>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
      {turn.text && <div className="ts-text">{turn.text}</div>}
    </div>
  )
}
