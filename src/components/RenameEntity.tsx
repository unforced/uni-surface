import { useEffect, useState } from 'react'
import {
  renameNotePath,
  searchAllNotes,
  patchNote,
  linkCapture,
  addAlias,
  getNote,
} from '../vault/api'
import type { Note } from '../vault/types'
import { isCapture } from '../vault/types'
import { entityName } from '../vault/util'
import { CloseIcon } from './icons'

// Rename an entity AND propagate the correction. The display name is the path
// leaf, so rename = PATCH the note's path (id is stable → links survive). Then
// every other note that mentions the OLD name is found, the text is corrected,
// and (if a capture) linked to the entity — so a misspelling gets *fixed*
// everywhere, not enshrined as an alias.

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
// Case-insensitive, whole-phrase matcher for a proper noun.
function phraseRe(name: string): RegExp {
  return new RegExp(escapeRegex(name), 'gi')
}
function countMatches(content: string, name: string): number {
  return (content.match(phraseRe(name)) ?? []).length
}
function snippet(content: string, name: string): string {
  const m = phraseRe(name).exec(content)
  if (!m) return ''
  const start = Math.max(0, m.index - 40)
  const end = Math.min(content.length, m.index + name.length + 40)
  return (start > 0 ? '…' : '') + content.slice(start, end).replace(/\n/g, ' ') + (end < content.length ? '…' : '')
}

interface Hit {
  note: Note
  count: number
  checked: boolean
}

export function RenameEntity({
  entity,
  onClose,
  onRenamed,
}: {
  entity: Note
  onClose: () => void
  onRenamed: (newPath: string) => void
}) {
  const oldName = entityName(entity)
  const slash = entity.path.lastIndexOf('/')
  const folder = slash >= 0 ? entity.path.slice(0, slash) : ''

  const [newName, setNewName] = useState(oldName)
  const [hits, setHits] = useState<Hit[] | null>(null)
  const [scanning, setScanning] = useState(true)
  const [keepAlias, setKeepAlias] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // On open, find every OTHER note that mentions the current name.
  useEffect(() => {
    let live = true
    ;(async () => {
      try {
        const raw = await searchAllNotes(oldName)
        // search is token-based; keep only true whole-phrase matches, and fetch
        // content where the lean result omitted it.
        const withContent = await Promise.all(
          raw.map((n) => (n.content != null ? Promise.resolve(n) : getNote(n.id).catch(() => n))),
        )
        const matches = withContent
          .filter((n) => n.id !== entity.id && (n.content ?? '').length > 0)
          .map((n) => ({ note: n, count: countMatches(n.content ?? '', oldName), checked: true }))
          .filter((h) => h.count > 0)
          .sort((a, b) => b.count - a.count)
        if (live) {
          setHits(matches)
          setScanning(false)
        }
      } catch (e) {
        if (live) {
          setError(e instanceof Error ? e.message : String(e))
          setScanning(false)
        }
      }
    })()
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const trimmed = newName.trim()
  const changed = trimmed.length > 0 && trimmed !== oldName
  const selectedCount = (hits ?? []).filter((h) => h.checked).length

  function toggle(i: number) {
    setHits((hs) => (hs ? hs.map((h, j) => (j === i ? { ...h, checked: !h.checked } : h)) : hs))
  }

  async function apply() {
    if (!changed) return
    setApplying(true)
    setError(null)
    try {
      const newPath = folder ? `${folder}/${trimmed}` : trimmed
      // 1. rename the entity (id stable → links survive)
      await renameNotePath(entity.id, newPath)
      // 2. fix the entity's own content (H1 / self-references)
      if (entity.content && countMatches(entity.content, oldName) > 0) {
        await patchNote(entity.id, { content: entity.content.replace(phraseRe(oldName), trimmed) })
      }
      // 3. correct every checked mention; link the captures to the entity
      for (const h of (hits ?? []).filter((x) => x.checked)) {
        const fixed = (h.note.content ?? '').replace(phraseRe(oldName), trimmed)
        await patchNote(h.note.id, { content: fixed })
        if (isCapture(h.note)) {
          try {
            await linkCapture(h.note.id, newPath, 'mentions')
          } catch {
            /* already linked / non-fatal */
          }
        }
      }
      // 4. optionally keep the old name as a legitimate alias (off by default)
      if (keepAlias) await addAlias(entity.id, oldName)
      onRenamed(newPath)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(
        /409|conflict/i.test(msg)
          ? `An entity named "${trimmed}" already exists. (Merging isn't supported yet.)`
          : msg,
      )
      setApplying(false)
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="panel rename-panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <h3>Rename &amp; correct</h3>
          <button className="icon-btn x" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>
        <div className="panel-body">
          <label className="rename-label">New name</label>
          <input
            className="rename-input"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            autoFocus
            spellCheck={false}
          />
          <div className="rename-from">
            was <span className="rename-old">{oldName}</span>
          </div>

          {error && <div className="config-err" style={{ marginTop: 12 }}>{error}</div>}

          <div className="rename-mentions">
            {scanning ? (
              <p className="rename-scan">Scanning for “{oldName}” across your notes…</p>
            ) : (hits ?? []).length === 0 ? (
              <p className="rename-scan">No other notes mention “{oldName}”. Just the rename, then.</p>
            ) : (
              <>
                <div className="rename-mentions-head">
                  Fix this spelling in {selectedCount} of {hits!.length} note
                  {hits!.length === 1 ? '' : 's'} that mention it:
                </div>
                <div className="rename-list">
                  {hits!.map((h, i) => (
                    <label className="rename-row" key={h.note.id}>
                      <input type="checkbox" checked={h.checked} onChange={() => toggle(i)} />
                      <span className="rename-row-body">
                        <span className="rename-row-title">
                          {h.note.path.split('/').pop()}
                          {h.count > 1 && <span className="rename-count"> ×{h.count}</span>}
                        </span>
                        <span className="rename-row-snippet">{snippet(h.note.content ?? '', oldName)}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>

          <label className="rename-alias">
            <input type="checkbox" checked={keepAlias} onChange={(e) => setKeepAlias(e.target.checked)} />
            Keep “{oldName}” as an alias
            <span className="rename-alias-hint"> — only if it's a real alternate name, not a misspelling</span>
          </label>

          <div className="btn-row">
            <button className="btn-ghost btn" onClick={onClose}>
              Cancel
            </button>
            <div className="spacer" />
            <button className="btn" onClick={apply} disabled={!changed || applying || scanning}>
              {applying
                ? 'Applying…'
                : selectedCount > 0
                  ? `Rename & fix ${selectedCount}`
                  : 'Rename'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
