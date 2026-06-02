import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listNotes } from '../vault/api'
import type { Note } from '../vault/types'
import { entityTypeOf, captureKindOf } from '../vault/types'
import { useEntityIndex } from '../vault/EntityIndex'
import { captureGlyph, CloseIcon } from './icons'
import { entityName, entityHref, captureHref, previewText } from '../vault/util'

export function SearchPalette({ onClose }: { onClose: () => void }) {
  const nav = useNavigate()
  const { entities } = useEntityIndex()
  const [q, setQ] = useState('')
  const [captures, setCaptures] = useState<Note[]>([])
  const [searching, setSearching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounce = useRef<number | undefined>(undefined)

  useEffect(() => {
    inputRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Full-text capture search (debounced).
  useEffect(() => {
    window.clearTimeout(debounce.current)
    const term = q.trim()
    if (term.length < 2) {
      setCaptures([])
      setSearching(false)
      return
    }
    setSearching(true)
    debounce.current = window.setTimeout(async () => {
      try {
        const res = await listNotes({
          tag: 'capture',
          search: term,
          includeContent: true,
          limit: 12,
          sort: 'desc',
        })
        setCaptures(res)
      } catch {
        setCaptures([])
      } finally {
        setSearching(false)
      }
    }, 220)
    return () => window.clearTimeout(debounce.current)
  }, [q])

  const entityHits = useMemo(() => {
    const term = q.trim().toLowerCase()
    if (term.length < 1) return []
    return entities
      .filter(
        (e) =>
          entityName(e).toLowerCase().includes(term) ||
          String(e.metadata?.summary ?? '').toLowerCase().includes(term),
      )
      .slice(0, 8)
  }, [q, entities])

  function go(href: string) {
    onClose()
    nav(href)
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="panel cmdk" onClick={(e) => e.stopPropagation()}>
        <div className="cmdk-input-row" style={{ display: 'flex', alignItems: 'center' }}>
          <input
            ref={inputRef}
            className="cmdk-input"
            placeholder="Search captures, projects, people…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button className="icon-btn" onClick={onClose} style={{ marginRight: 8 }} aria-label="Close">
            <CloseIcon />
          </button>
        </div>
        <div className="cmdk-results">
          {q.trim().length === 0 && (
            <div className="cmdk-hint">Type to search across your whole vault.</div>
          )}

          {entityHits.length > 0 && (
            <>
              <div className="cmdk-group-label">Entities</div>
              {entityHits.map((e) => (
                <button key={e.id} className={`result-row t-${entityTypeOf(e) ?? ''}`} onClick={() => go(entityHref(e))}>
                  <span className="rr-type">{entityTypeOf(e)}</span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <div className="rr-name">{entityName(e)}</div>
                    {e.metadata?.summary && <div className="rr-sum">{String(e.metadata.summary)}</div>}
                  </span>
                </button>
              ))}
            </>
          )}

          {(searching || captures.length > 0) && (
            <>
              <div className="cmdk-group-label">Captures{searching ? ' · searching…' : ''}</div>
              {captures.map((c) => (
                <button key={c.id} className="result-row" onClick={() => go(captureHref(c))}>
                  <span style={{ color: 'var(--clay)' }}>{captureGlyph(captureKindOf(c))}</span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <div className="rr-sum" style={{ color: 'var(--ink)' }}>{previewText(c, 120) || '(no text)'}</div>
                  </span>
                </button>
              ))}
            </>
          )}

          {q.trim().length >= 2 && !searching && captures.length === 0 && entityHits.length === 0 && (
            <div className="cmdk-hint">No matches for "{q.trim()}".</div>
          )}
        </div>
      </div>
    </div>
  )
}
