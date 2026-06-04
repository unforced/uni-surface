import { useCallback, useEffect, useRef, useState } from 'react'
import type { Note } from '../vault/types'
import { capturePath, memoFilename, RESPONDS_TO } from '../vault/util'
import { linkCapture } from '../vault/api'
import { enqueue, putBlob } from '../vault/sync/outbox'
import { newLocalId } from '../vault/sync/db'
import { runOnce } from '../vault/sync/engine'
import { CloseIcon, TextGlyph, VoiceGlyph } from './icons'

// A surface this capture is answering (e.g. a morning Open Inquiry question).
type ReplyTarget = { id: string; label: string }

// Thread an online-synced reply back to its surface. The `responds_to` metadata
// is already on the note (set at create, survives offline); this adds the graph
// edge so the surface can show its replies. Best-effort — never blocks capture.
async function threadReply(synced: Note, replyTo: ReplyTarget | null | undefined) {
  if (!replyTo) return
  try {
    await linkCapture(synced.id, replyTo.id, RESPONDS_TO)
  } catch {
    /* link is non-essential; the responds_to metadata still records the reply */
  }
}

// "New capture" modal — text or voice, mirroring the Notes compose flow.
//
// Both kinds ALWAYS enqueue to the offline outbox first (src/vault/sync), then
// trigger a drain. Online, we wait briefly for the server note (to offer
// weaving); offline (or slow), we hand back an optimistic note and the outbox
// syncs in the background. So capture never fails for lack of a network.
//
// Voice: MediaRecorder(audio/webm;codecs=opus) → on stop, the audio bytes are
// stashed in IndexedDB and three mutations are queued (create-note embedding
// ![[memo-*.webm]] → upload-attachment → link-attachment w/ transcribe:true).

// Wait briefly for a queued create-note to sync, so an ONLINE capture hands back
// the real server Note (to offer weaving). Resolves null if it doesn't land in
// time (offline or slow) — the optimistic note is shown instead while the outbox
// keeps trying in the background.
function waitForSync(localId: string, timeoutMs: number): Promise<Note | null> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (note: Note | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      window.removeEventListener('pv:capture-synced', handler)
      resolve(note)
    }
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { localId?: string; note?: Note } | undefined
      if (detail?.localId === localId && detail.note) finish(detail.note)
    }
    const timer = setTimeout(() => finish(null), timeoutMs)
    window.addEventListener('pv:capture-synced', handler)
  })
}

function optimistic(
  localId: string,
  path: string,
  content: string,
  tags: string[],
  metadata: Record<string, unknown> = {},
): Note {
  const now = new Date().toISOString()
  return { id: `local:${localId}`, path, content, tags, metadata, createdAt: now, updatedAt: now }
}

const PREFERRED_MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']

function pickMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  for (const t of PREFERRED_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(t)) return t
  }
  return null
}

function fmtElapsed(ms: number): string {
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

type Mode = 'choose' | 'text' | 'voice'
type VoicePhase = 'idle' | 'recording' | 'saving'

export function Capture({
  onClose,
  onCreated,
  onQueued,
  replyTo,
}: {
  onClose: () => void
  // Called when a capture syncs to the vault while online — the host refreshes
  // its list and offers to weave it (links need a server-side note).
  onCreated: (note: Note) => void
  // Called when a capture is saved offline / not yet synced — the host shows it
  // optimistically and flashes a "will sync" toast (no weave offer yet).
  onQueued: (note: Note) => void
  // When present, this capture is a reply: it carries `responds_to` metadata and
  // (once synced) a `responds-to` link back to the surface being answered.
  replyTo?: ReplyTarget | null
}) {
  const replyMeta = replyTo ? { responds_to: replyTo.id } : {}
  const [mode, setMode] = useState<Mode>('choose')
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ── voice state ──
  const [phase, setPhase] = useState<VoicePhase>('idle')
  const [elapsedMs, setElapsedMs] = useState(0)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startedAtRef = useRef(0)
  const mimeRef = useRef<string>('audio/webm;codecs=opus')

  // tick the elapsed timer while recording
  useEffect(() => {
    if (phase !== 'recording') return
    const id = setInterval(() => setElapsedMs(Date.now() - startedAtRef.current), 250)
    return () => clearInterval(id)
  }, [phase])

  const releaseMic = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])

  // Release the mic if the modal unmounts mid-recording.
  useEffect(() => () => releaseMic(), [releaseMic])

  // ── text submit ── (enqueue → drain → online: real note; offline: optimistic)
  async function submitText() {
    const content = text.trim()
    if (!content || saving) return
    setSaving(true)
    setError(null)
    try {
      const localId = newLocalId()
      const path = capturePath('text')
      const tags = ['capture/text']
      // Attach the waiter BEFORE flushing so we never miss the sync event.
      const waiter = navigator.onLine ? waitForSync(localId, 8000) : Promise.resolve(null)
      await enqueue({ kind: 'create-note', localId, path, content, tags, metadata: replyMeta })
      void runOnce()
      const synced = await waiter
      if (synced) {
        await threadReply(synced, replyTo)
        onCreated(synced)
      } else onQueued(optimistic(localId, path, content, tags, replyMeta))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSaving(false)
    }
  }

  // ── voice: start ──
  async function startRecording() {
    setError(null)
    const mimeType = pickMimeType()
    if (!mimeType) {
      setError("This browser can't record audio in a format we can save.")
      return
    }
    mimeRef.current = mimeType
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const rec = new MediaRecorder(stream, { mimeType })
      chunksRef.current = []
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorderRef.current = rec
      rec.start()
      startedAtRef.current = Date.now()
      setElapsedMs(0)
      setPhase('recording')
    } catch (e) {
      const name = e instanceof DOMException ? e.name : ''
      setError(
        name === 'NotFoundError'
          ? 'No microphone was found on this device.'
          : name === 'NotAllowedError'
            ? 'Microphone access was denied. Update your browser settings to record.'
            : e instanceof Error
              ? e.message
              : 'Microphone is not available in this browser.',
      )
      releaseMic()
    }
  }

  function cancelRecording() {
    const rec = recorderRef.current
    if (rec && rec.state !== 'inactive') {
      rec.onstop = null
      try {
        rec.stop()
      } catch {
        /* ignore */
      }
    }
    recorderRef.current = null
    chunksRef.current = []
    releaseMic()
    setPhase('idle')
    setElapsedMs(0)
  }

  // ── voice: stop → upload → note → attach ──
  async function stopAndSave() {
    const rec = recorderRef.current
    if (!rec || phase !== 'recording') return
    setPhase('saving')
    const blob: Blob = await new Promise((resolve) => {
      rec.onstop = () => resolve(new Blob(chunksRef.current, { type: mimeRef.current }))
      rec.stop()
    })
    releaseMic()
    recorderRef.current = null

    try {
      const filename = memoFilename(mimeRef.current)
      const path = capturePath('voice')
      const tags = ['capture/voice']
      const content = `![[${filename}]]`
      // Stash the audio bytes in IndexedDB so the memo survives offline/reload.
      const arrayBuffer = await blob.arrayBuffer()
      const blobId = await putBlob(arrayBuffer, mimeRef.current, filename)
      const localId = newLocalId()
      // Queue the 3-step chain (FIFO): create note → upload audio → link+transcribe.
      const waiter = navigator.onLine ? waitForSync(localId, 10000) : Promise.resolve(null)
      await enqueue({ kind: 'create-note', localId, path, content, tags, metadata: replyMeta })
      await enqueue({ kind: 'upload-attachment', blobId })
      await enqueue({
        kind: 'link-attachment',
        noteLocalId: localId,
        blobId,
        mimeType: 'audio/webm;codecs=opus',
        transcribe: true,
      })
      void runOnce()
      const synced = await waiter
      if (synced) {
        await threadReply(synced, replyTo)
        onCreated(synced)
      } else onQueued(optimistic(localId, path, content, tags, replyMeta))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPhase('idle')
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <span style={{ color: 'var(--clay)' }}>
            {mode === 'voice' ? <VoiceGlyph /> : <TextGlyph />}
          </span>
          <h3>
            {mode === 'choose'
              ? 'New capture'
              : mode === 'text'
                ? 'Write a capture'
                : 'Voice capture'}
          </h3>
          <button className="icon-btn x" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>
        <div className="panel-body">
          {replyTo && (
            <div className="reply-chip" title="This capture will thread back to what it answers">
              <span className="reply-chip-arrow">↩</span>
              <span className="reply-chip-text">
                Replying to <strong>{replyTo.label}</strong>
              </span>
            </div>
          )}
          {mode === 'choose' && (
            <div className="capture-modes">
              <button className="capture-mode" onClick={() => setMode('text')}>
                <span className="cm-glyph"><TextGlyph /></span>
                <span className="cm-label">Text</span>
                <span className="cm-sub">Type a thought in markdown</span>
              </button>
              <button className="capture-mode" onClick={() => setMode('voice')}>
                <span className="cm-glyph"><VoiceGlyph /></span>
                <span className="cm-label">Voice</span>
                <span className="cm-sub">Record &amp; transcribe a memo</span>
              </button>
            </div>
          )}

          {mode === 'text' && (
            <>
              <textarea
                className="capture-textarea"
                autoFocus
                placeholder="What's alive right now? (markdown welcome — [[link]] later in Weave)"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void submitText()
                }}
              />
              {error && <div className="config-err" style={{ marginTop: 12 }}>{error}</div>}
              <div className="btn-row">
                <button className="btn-ghost btn" onClick={() => setMode('choose')}>
                  Back
                </button>
                <div className="spacer" />
                <button className="btn" disabled={!text.trim() || saving} onClick={submitText}>
                  {saving ? 'Capturing…' : 'Capture'}
                </button>
              </div>
            </>
          )}

          {mode === 'voice' && (
            <>
              {phase === 'idle' && (
                <div className="voice-stage">
                  <p className="voice-hint">
                    Tap record, speak freely, then stop. We'll save the audio and
                    transcribe it for you.
                  </p>
                  {error && <div className="config-err">{error}</div>}
                  <div className="btn-row">
                    <button className="btn-ghost btn" onClick={() => setMode('choose')}>
                      Back
                    </button>
                    <div className="spacer" />
                    <button className="btn" onClick={startRecording}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                        <VoiceGlyph /> Record
                      </span>
                    </button>
                  </div>
                </div>
              )}

              {phase === 'recording' && (
                <div className="voice-stage recording">
                  <div className="rec-pulse" aria-hidden />
                  <div className="rec-elapsed">{fmtElapsed(elapsedMs)}</div>
                  <p className="voice-hint">Recording… speak naturally.</p>
                  <div className="btn-row">
                    <button className="btn-ghost btn" onClick={cancelRecording}>
                      Cancel
                    </button>
                    <div className="spacer" />
                    <button className="btn" onClick={stopAndSave}>
                      Stop &amp; save
                    </button>
                  </div>
                </div>
              )}

              {phase === 'saving' && (
                <div className="voice-stage">
                  <div className="breathing" />
                  <p className="voice-hint" style={{ marginTop: 16 }}>
                    Saving your memo &amp; starting transcription…
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
