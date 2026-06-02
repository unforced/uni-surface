import { useState } from 'react'
import { getNote, patchNote, deleteNote } from '../vault/api'
import type { Note } from '../vault/types'
import { captureKindOf } from '../vault/types'
import { useAsync } from '../vault/useAsync'
import { AudioEmbed } from './AudioEmbed'
import { WeaveEditor } from './WeaveEditor'
import { Loading, ErrorBanner, EntityChip } from './common'
import { CloseIcon, captureGlyph, LinkIcon, VoiceGlyph } from './icons'
import {
  findAudioEmbed,
  audioAttachmentOf,
  transcriptOf,
  linkedEntities,
  formatDayHeading,
  dayKey,
  formatTime,
} from '../vault/util'

// Full, editable triage view for one capture from the to-weave tray.
// Aaron (the human OWNER) can: read + edit the content, see whether an audio
// attachment exists (and play it), add/remove entity links, or delete the note.
//
// `seed` is the lean note from the tray (used for an instant header); we then
// fetch the full note WITH links + attachments so the player and weave state
// are accurate. `onChanged` is called after save/weave so the parent refreshes
// the tray + timeline; `onDeleted` after a delete so it's pulled from the tray.
export function CaptureTriage({
  seed,
  onClose,
  onChanged,
  onDeleted,
}: {
  seed: Note
  onClose: () => void
  onChanged: () => void
  onDeleted: (id: string) => void
}) {
  const { data, loading, error, reload } = useAsync(
    () => getNote(seed.id, { includeLinks: true, includeAttachments: true }),
    [seed.id],
  )

  const note = data ?? seed
  const kind = captureKindOf(note)

  const [draft, setDraft] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [weaving, setWeaving] = useState(false)

  // Content textarea is prefilled from the fetched note; until it loads we keep
  // null and fall back to the live content so we never clobber with `seed`.
  const content = draft ?? note.content ?? ''
  const dirty = draft !== null && draft !== (note.content ?? '')

  async function save() {
    if (!dirty) return
    setSaving(true)
    setActionError(null)
    try {
      // Human owner editing his own capture — content edits are allowed.
      await patchNote(note.id, { content })
      setDraft(null)
      await reload()
      onChanged()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function doDelete() {
    setDeleting(true)
    setActionError(null)
    try {
      await deleteNote(note.id)
      onDeleted(note.id)
      onClose()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
      setDeleting(false)
    }
  }

  function onWoven() {
    setWeaving(false)
    reload()
    onChanged()
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="panel triage" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <span style={{ color: 'var(--clay)' }}>{captureGlyph(kind)}</span>
          <h3>Triage this capture</h3>
          <button className="icon-btn x" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>

        <div className="panel-body">
          <div className="triage-meta">
            <span className="kind">{kind === 'voice' ? 'voice' : kind === 'dream' ? 'dream' : 'note'}</span>
            <span>·</span>
            <span>
              {formatDayHeading(dayKey(note.createdAt))} · {formatTime(note.createdAt)}
            </span>
          </div>

          {loading && <Loading label="Opening the full note…" />}
          {Boolean(error) && <ErrorBanner error={error} onRetry={reload} />}

          {data && (
            <>
              {/* ── Attachment / audio ── */}
              {(() => {
                const embed = note.content ? findAudioEmbed(note.content) : null
                const att = audioAttachmentOf(note.attachments)
                if (att || embed) {
                  const transcript = transcriptOf(att)
                  const status = att?.metadata?.transcribe_status
                  const pending = !transcript && (status === 'pending' || status === 'processing')
                  return (
                    <div className="triage-section">
                      <p className="field-label">Attachment</p>
                      <AudioEmbed attachment={att} file={embed ?? undefined} />
                      {transcript ? (
                        <blockquote className="transcript">{transcript}</blockquote>
                      ) : pending ? (
                        <p className="transcript-pending">Transcribing…</p>
                      ) : null}
                    </div>
                  )
                }
                // No attachment at all — say so clearly (the key ask).
                return (
                  <div className="triage-section">
                    <p className="field-label">Attachment</p>
                    <div className="audio-block">
                      <span style={{ color: 'var(--ink-faint)' }}>
                        <VoiceGlyph />
                      </span>
                      <span className="audio-missing">No attachment.</span>
                    </div>
                  </div>
                )
              })()}

              {/* ── Editable content ── */}
              <div className="triage-section">
                <p className="field-label">Content</p>
                <textarea
                  className="capture-textarea triage-textarea"
                  value={content}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="(empty — write something, or delete it below)"
                />
                <div className="btn-row">
                  <div className="spacer" />
                  <button className="btn" disabled={!dirty || saving} onClick={save}>
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>

              {/* ── Weave / links ── */}
              <div className="triage-section">
                <p className="field-label">Woven into</p>
                {(() => {
                  const linked = linkedEntities(note)
                  return (
                    <>
                      {linked.length === 0 ? (
                        <p className="touching-empty">Not woven yet.</p>
                      ) : (
                        <div className="chips">
                          {linked.map((l) => (
                            <EntityChip key={l.ref.id} entity={l.ref} relationship={l.relationship} showRel />
                          ))}
                        </div>
                      )}
                      <button className="btn-ghost btn" style={{ marginTop: 14 }} onClick={() => setWeaving(true)}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <LinkIcon /> {linked.length ? 'Add or change links' : 'Weave it now'}
                        </span>
                      </button>
                    </>
                  )
                })()}
              </div>

              {actionError && <div className="config-err" style={{ marginTop: 16 }}>{actionError}</div>}

              {/* ── Delete ── */}
              <div className="triage-danger">
                {confirmDelete ? (
                  <>
                    <span className="td-ask">Delete this capture for good?</span>
                    <button className="btn-ghost btn" onClick={() => setConfirmDelete(false)}>
                      Keep
                    </button>
                    <button className="btn btn-danger" disabled={deleting} onClick={doDelete}>
                      {deleting ? 'Deleting…' : 'Delete'}
                    </button>
                  </>
                ) : (
                  <button className="text-toggle td-trigger" onClick={() => setConfirmDelete(true)}>
                    Delete this capture
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Weave editor stacks on top; it renders its own overlay. */}
      {weaving && (
        <WeaveEditor
          capture={note}
          onClose={() => setWeaving(false)}
          onWoven={onWoven}
          onLinked={() => {
            // A Detected-entities link was written directly — refresh the full
            // note (so "Woven into" + the scan's exclude-set update) and the
            // tray, but keep the editor open for more links.
            reload()
            onChanged()
          }}
        />
      )}
    </div>
  )
}
