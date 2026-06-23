import { useState } from 'react'
import { patchNote, renameNotePath, deleteNote } from '../vault/api'
import { RespondMenu } from './RespondMenu'
import type { Note } from '../vault/types'

// Reusable note plumbing: the path + id (copyable, so the structure is legible
// even though it's mostly invisible), plus inline Edit, move (path), and Delete.
// Captures are "sacred" only with respect to the *AI* — Aaron can hand-edit his
// own notes.
//
// Edits content via PATCH and (optionally) moves the note by changing its path —
// the id is stable, so links survive. `onChanged` reloads the host; `onMoved`
// fires after a path change so a host reached *by path* can re-navigate;
// `onDeleted` navigates away. Set `allowPathEdit={false}` where a richer rename
// exists (entities use rename-with-propagation instead).
export function NoteControls({
  note,
  onChanged,
  onDeleted,
  onMoved,
  allowPathEdit = true,
}: {
  note: Note
  onChanged: () => void
  onDeleted: () => void
  onMoved?: (newPath: string) => void
  allowPathEdit?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(note.content ?? '')
  const [draftPath, setDraftPath] = useState(note.path)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [copied, setCopied] = useState<'path' | 'id' | null>(null)

  function copy(kind: 'path' | 'id', text: string) {
    void navigator.clipboard?.writeText(text)
    setCopied(kind)
    setTimeout(() => setCopied((c) => (c === kind ? null : c)), 1200)
  }

  async function save() {
    setSaving(true)
    setErr(null)
    const newPath = draftPath.trim()
    const moving = allowPathEdit && newPath.length > 0 && newPath !== note.path
    try {
      if (draft !== (note.content ?? '')) await patchNote(note.id, { content: draft })
      if (moving) await renameNotePath(note.id, newPath)
      setEditing(false)
      if (moving && onMoved) onMoved(newPath)
      else onChanged()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (
      !confirm(
        `Delete this note?\n\n${note.path}\n\nThis removes the note and its links, and can't be undone.`,
      )
    )
      return
    setDeleting(true)
    setErr(null)
    try {
      await deleteNote(note.id)
      onDeleted()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setDeleting(false)
    }
  }

  return (
    <section className="note-controls">
      <div className="nc-meta">
        <button className="nc-field" onClick={() => copy('path', note.path)} title="Copy path">
          <span className="nc-k">path</span>
          <span className="nc-v">{note.path}</span>
          <span className="nc-copy">{copied === 'path' ? 'copied' : '⧉'}</span>
        </button>
        <button className="nc-field" onClick={() => copy('id', note.id)} title="Copy id">
          <span className="nc-k">id</span>
          <span className="nc-v">{note.id}</span>
          <span className="nc-copy">{copied === 'id' ? 'copied' : '⧉'}</span>
        </button>
      </div>

      {editing ? (
        <div className="nc-edit">
          {allowPathEdit && (
            <label className="nc-path-edit">
              <span className="nc-k">path</span>
              <input
                className="nc-path-input"
                value={draftPath}
                onChange={(e) => setDraftPath(e.target.value)}
                spellCheck={false}
              />
            </label>
          )}
          <textarea
            className="nc-textarea"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={Math.min(24, Math.max(6, draft.split('\n').length + 1))}
            autoFocus
            spellCheck
          />
          {err && <div className="config-err" style={{ marginTop: 8 }}>{err}</div>}
          <div className="btn-row">
            <button
              className="btn-ghost btn"
              onClick={() => {
                setEditing(false)
                setDraft(note.content ?? '')
                setDraftPath(note.path)
                setErr(null)
              }}
            >
              Cancel
            </button>
            <div className="spacer" />
            <button className="btn" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      ) : (
        <div className="nc-actions">
          <button className="nc-btn" onClick={() => { setDraft(note.content ?? ''); setEditing(true) }}>
            Edit
          </button>
          <RespondMenu notePath={note.path} label="Reference" className="nc-respond" />
          <button className="nc-btn nc-danger" onClick={remove} disabled={deleting}>
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
          {err && <span className="config-err" style={{ marginLeft: 10 }}>{err}</span>}
        </div>
      )}
    </section>
  )
}
