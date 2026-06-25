import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { capturePath } from '../vault/util'
import { enqueue } from '../vault/sync/outbox'
import { newLocalId } from '../vault/sync/db'
import { runOnce } from '../vault/sync/engine'
import { CAPTURE_CREATED_EVENT } from '../App'

// Morning pages — a large, simple, distraction-free writing canvas (Aaron's
// recurring ask). Just you and the page: a spacious serif field, the draft
// autosaved to localStorage so nothing is ever lost, and a quiet save that drops
// the writing into the vault as an ordinary text capture (same pipeline as the
// capture modal — offline-safe via the outbox). No modal, no chrome — the whole
// screen is the page.

const DRAFT_KEY = 'pv.morningDraft'

export function Write() {
  const [text, setText] = useState(() => {
    try {
      return localStorage.getItem(DRAFT_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const [saving, setSaving] = useState(false)
  const [justSaved, setJustSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const nav = useNavigate()

  // Autosave the draft locally (debounced) so a reload / nav-away never loses it.
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, text)
      } catch {
        /* storage unavailable — non-fatal */
      }
    }, 400)
    return () => clearTimeout(id)
  }, [text])

  useEffect(() => {
    taRef.current?.focus()
  }, [])

  const words = text.trim() ? text.trim().split(/\s+/).length : 0

  async function save() {
    const content = text.trim()
    if (!content || saving) return
    setSaving(true)
    setError(null)
    try {
      const localId = newLocalId()
      const path = capturePath('text')
      // A plain text capture — flows into the same stream as any other note,
      // queued offline-first and drained by the sync engine.
      await enqueue({ kind: 'create-note', localId, path, content, tags: ['capture/text'], metadata: {} })
      void runOnce()
      try {
        localStorage.removeItem(DRAFT_KEY)
      } catch {
        /* ignore */
      }
      setText('')
      setJustSaved(true)
      setTimeout(() => setJustSaved(false), 4000)
      window.dispatchEvent(new CustomEvent(CAPTURE_CREATED_EVENT))
      taRef.current?.focus()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="write-page">
      <div className="write-bar">
        <button className="write-back" onClick={() => nav('/today')} title="Back to Today">
          ← Today
        </button>
        <div className="write-date">
          {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
        </div>
        <div className="write-bar-right">
          <span className="write-count">
            {words} word{words === 1 ? '' : 's'}
            {justSaved && <span className="write-saved"> · captured 🌱</span>}
          </span>
          <button className="btn" onClick={save} disabled={!text.trim() || saving}>
            {saving ? 'Saving…' : 'Save to vault'}
          </button>
        </div>
      </div>

      {error && <div className="config-err write-err">{error}</div>}

      <textarea
        ref={taRef}
        className="write-canvas"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Begin…  Your words autosave as you write. (⌘↵ to save to the vault)"
        spellCheck
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault()
            void save()
          }
        }}
      />
    </div>
  )
}
