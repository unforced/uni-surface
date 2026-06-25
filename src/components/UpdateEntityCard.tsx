import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  getNote,
  resolveProposalWithSpec,
  resolveProposal,
  updateEntityContent,
  VaultConflictError,
} from '../vault/api'
import type { Note } from '../vault/types'
import { entityTypeOf } from '../vault/types'
import { entityHref } from '../vault/util'
import type { ProposalSpec } from '../vault/proposalSpec'
import { applyDossierDeltas, hasUpdateDeltas } from '../vault/proposalSpec'
import { Markdown } from './Markdown'
import { OpenNote } from './common'

// ── Render + accept an `update_entity` proposal ──
// A refresh of an existing entity's summary + content. We show the proposed new
// content next to the CURRENT content (before/after), let the human edit the
// proposal before applying, and accept with OPTIMISTIC CONCURRENCY: the write
// is guarded by the entity's `updated_at` AS OF the proposal (`base_updated_at`).
// If the entity changed since (live updated_at ≠ base), the vault 409s and we
// surface a staleness warning + a "re-apply on latest" path instead of clobbering.
export function UpdateEntityCard({
  proposal,
  spec,
  onResolved,
}: {
  proposal: Note
  spec: ProposalSpec
  onResolved: (id: string, msg: string) => void
}) {
  const update = spec.update! // guaranteed by the caller (kind === 'update_entity')
  const target = update.target
  const type = spec.entity.type

  // Whether the Weaver sent a delta/addendum update (no full `content`) — then
  // the proposed body is computed by applying the deltas onto the CURRENT
  // dossier once it loads, never an empty replace.
  const deltaMode = !update.content.trim() && hasUpdateDeltas(update)

  // Editable proposal payload. In full-replace mode it's the spec's content; in
  // delta mode it's seeded from current+deltas after the load effect runs.
  const [draftContent, setDraftContent] = useState(update.content)
  const [draftSummary, setDraftSummary] = useState(update.summary)
  // Once the human edits the body, stop re-seeding it from the deltas.
  const contentDirty = useRef(false)
  const seeded = useRef(false)

  // The live entity (for the "current" before-pane + its live updated_at, which
  // we compare against base_updated_at to detect staleness up front).
  const [current, setCurrent] = useState<Note | null>(null)
  const [loadingCurrent, setLoadingCurrent] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [showCurrent, setShowCurrent] = useState(false)

  // Execution + conflict state.
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // When set, the entity changed since the proposal was made: we refuse to
  // clobber and offer "re-apply on latest". Carries the live updated_at to use.
  const [conflict, setConflict] = useState<{ liveUpdatedAt: string | null } | null>(null)

  // Fetch the current entity once for the before-pane + freshness check.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const note = await getNote(target, { includeLinks: false })
        if (cancelled) return
        setCurrent(note)
        // Delta/addendum proposals carry no full `content` — compute the proposed
        // body by applying the deltas onto the freshly-loaded current dossier, so
        // the body is current + additions (never blank).
        if (deltaMode && !seeded.current && !contentDirty.current) {
          setDraftContent(applyDossierDeltas(note.content ?? '', update))
        }
        seeded.current = true
        // Pre-flight staleness: if the live updated_at already differs from the
        // base the proposal was computed against, warn before the human edits.
        if (update.baseUpdatedAt && note.updatedAt && note.updatedAt !== update.baseUpdatedAt) {
          setConflict({ liveUpdatedAt: note.updatedAt })
        }
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoadingCurrent(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // Mount-only for this proposal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const currentContent = current?.content ?? ''
  const currentSummary = String(current?.metadata?.summary ?? '')
  const confPct = Math.round(spec.confidence * 100)
  const effectiveType = (current ? entityTypeOf(current) : null) ?? type

  // ── SAFETY: never write empty/blank content over a non-empty dossier. ──
  // This is the data-loss guard: a delta-only proposal whose deltas didn't yet
  // resolve to a body, or a hand-cleared editor, must not erase the entity.
  const proposedBlank = draftContent.trim().length === 0
  const currentNonEmpty = currentContent.trim().length > 0
  const wouldErase = proposedBlank && currentNonEmpty
  // If the current dossier failed to load, we can't verify a blank write is
  // safe — refuse it rather than risk erasing an unseen body.
  const cannotVerify = proposedBlank && loadError !== null
  const blockApply = wouldErase || cannotVerify

  // The edited spec to persist on resolve (records exactly what was applied).
  // Built from the body actually written, so the conflict re-merge path records
  // the merged result, not a stale draft.
  const buildExecutedJson = (content: string) =>
    JSON.stringify({
      v: spec.v,
      kind: 'update_entity',
      target,
      confidence: spec.confidence,
      evidence: spec.evidence,
      base_updated_at: update.baseUpdatedAt,
      update: { summary: draftSummary, content },
    })

  // Apply the (edited) update, then resolve the proposal. `guard` decides the
  // concurrency mode: when set, the write is conditioned on that updated_at; on
  // a 409 we record the conflict instead of clobbering. When `guard` is null the
  // write force-applies (the "re-apply on latest" path, after reconciling).
  async function applyUpdate(guard: string | null) {
    // Defense in depth: the button is disabled when blocked, but never let a
    // blank-over-non-empty write through even if a code path reaches here.
    if (blockApply) {
      setError(
        'This update has no proposed content — applying it would erase the current dossier. Blocked.',
      )
      return
    }
    setBusy(true)
    setError(null)
    try {
      setProgress(`Updating ${target}…`)
      await updateEntityContent(target, draftContent, draftSummary, guard ?? undefined)
      setProgress('Resolving proposal…')
      await resolveProposalWithSpec(proposal.id, buildExecutedJson(draftContent), 'approved')
      onResolved(proposal.id, `Updated ${target} 🌿`)
    } catch (e) {
      if (e instanceof VaultConflictError) {
        // Re-fetch the latest so the before-pane + base reflect reality, then
        // surface the staleness warning + re-apply affordance.
        setConflict({ liveUpdatedAt: e.currentUpdatedAt })
        setShowCurrent(true)
        try {
          const fresh = await getNote(target, { includeLinks: false })
          setCurrent(fresh)
        } catch {
          /* keep whatever we had */
        }
        setError(null)
      } else {
        setError(e instanceof Error ? e.message : String(e))
      }
      setBusy(false)
      setProgress(null)
    }
  }

  // Primary accept: guarded by base_updated_at (won't clobber a changed entity).
  function accept() {
    void applyUpdate(update.baseUpdatedAt || null)
  }

  // Re-apply on latest: re-fetch current, let the human reconcile (the before-
  // pane + editable proposal are already live), then write guarded by the LIVE
  // updated_at (so a concurrent third edit still can't be clobbered silently).
  async function reapplyOnLatest() {
    setBusy(true)
    setError(null)
    setProgress(`Re-fetching ${target}…`)
    try {
      const fresh = await getNote(target, { includeLinks: false })
      setCurrent(fresh)
      setShowCurrent(true)
      setConflict(null)
      // Delta mode: re-apply the deltas onto the FRESH dossier (the prior merge
      // was against a now-stale body), unless the human hand-edited.
      let bodyToWrite = draftContent
      if (deltaMode && !contentDirty.current) {
        bodyToWrite = applyDossierDeltas(fresh.content ?? '', update)
        setDraftContent(bodyToWrite)
      }
      // Guard: never blank a non-empty fresh dossier.
      if (!bodyToWrite.trim() && (fresh.content ?? '').trim()) {
        setError('This update has no content to apply — it would erase the dossier. Skipped to protect it.')
        setBusy(false)
        setProgress(null)
        return
      }
      // Write guarded by the freshly-read updated_at.
      await updateEntityContent(target, bodyToWrite, draftSummary, fresh.updatedAt)
      setProgress('Resolving proposal…')
      await resolveProposalWithSpec(proposal.id, buildExecutedJson(bodyToWrite), 'approved')
      onResolved(proposal.id, `Updated ${target} (re-applied on latest) 🌿`)
    } catch (e) {
      if (e instanceof VaultConflictError) {
        setConflict({ liveUpdatedAt: e.currentUpdatedAt })
        setError(`${target} changed again while re-applying — review and try once more.`)
      } else {
        setError(e instanceof Error ? e.message : String(e))
      }
      setBusy(false)
      setProgress(null)
    }
  }

  async function skip() {
    setBusy(true)
    setError(null)
    try {
      await resolveProposal(proposal.id, 'rejected')
      onResolved(proposal.id, 'Skipped 🍂')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <article className={`proposal-card pc-update t-${effectiveType}`}>
      {/* ── Header ── */}
      <div className="pc-head">
        <span className="pc-dot" />
        <div className="pc-title">
          Update{' '}
          <Link to={entityHref({ path: target } as Note)} className="pc-update-target">
            {target}
          </Link>
        </div>
        <span className="pc-type-tag">{effectiveType}</span>
        <span className="pc-conf" title="Weaver confidence">{confPct}%</span>
      </div>

      {spec.evidence && (
        <p className="pc-why">
          <span className="pc-why-label">Why</span> {spec.evidence}
        </p>
      )}

      {loadError && (
        <div className="config-err" style={{ marginTop: 12 }}>
          Couldn't load the current {target}: {loadError}
        </div>
      )}

      {/* ── Staleness warning: the entity changed since this was proposed. ── */}
      {conflict && (
        <div className="pc-conflict">
          <div className="pc-conflict-text">
            ⚠ <strong>{target}</strong> changed since this was proposed — review the current
            version before applying so you don't overwrite newer edits.
          </div>
          <button
            className="btn pc-conflict-btn"
            onClick={reapplyOnLatest}
            disabled={busy || loadingCurrent}
          >
            Re-apply on latest
          </button>
        </div>
      )}

      {/* ── What a delta/addendum update will ADD (rendered intent, not empty) ── */}
      {deltaMode && (
        <div className="pc-update-deltas">
          <div className="pc-pane-label">What this update adds</div>
          {update.whereItStandsAddendum && (
            <p className="pc-delta-line">
              <span className="pc-delta-tag">where it stands</span> {update.whereItStandsAddendum}
            </p>
          )}
          {update.openLoopsAdd && update.openLoopsAdd.length > 0 && (
            <ul className="pc-delta-loops">
              {update.openLoopsAdd.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          )}
          {update.openQuestionsResolvedNote && (
            <p className="pc-delta-line">
              <span className="pc-delta-tag">resolved</span> {update.openQuestionsResolvedNote}
            </p>
          )}
          <p className="pc-delta-hint">
            Applied onto the current dossier below — additions only, never a replace. Edit freely.
          </p>
        </div>
      )}

      {/* ── SAFETY: refuse to write empty over a non-empty dossier. ── */}
      {blockApply && (
        <div className="pc-erase-guard">
          ⚠ This update has no proposed body
          {cannotVerify ? " and the current dossier couldn't be loaded" : ''} — applying it would{' '}
          <strong>erase {target}</strong>. Accept is blocked. Add content above, or Skip.
        </div>
      )}

      {/* ── Proposed new summary (editable) ── */}
      <div className="pc-field" style={{ marginTop: 16 }}>
        <label className="field-label">Proposed summary</label>
        <textarea
          className="pc-textarea"
          value={draftSummary}
          onChange={(e) => setDraftSummary(e.target.value)}
          rows={2}
          placeholder="One-line summary"
        />
      </div>

      {/* ── Before / after content ── */}
      <div className="pc-update-panes">
        <div className="pc-update-pane">
          <div className="pc-pane-head">
            <span className="pc-pane-label">Proposed content</span>
            <span className="pc-pane-hint">editable · rendered preview below</span>
          </div>
          <textarea
            className="pc-textarea pc-update-editor"
            value={draftContent}
            onChange={(e) => setDraftContent(e.target.value)}
            rows={12}
            placeholder="Refreshed markdown dossier"
          />
          <div className="pc-update-preview">
            <Markdown content={draftContent} />
          </div>
        </div>
      </div>

      {/* ── Current content (collapsed; the before half of before/after) ── */}
      <div className="pc-update-current">
        <button
          type="button"
          className="text-toggle"
          onClick={() => setShowCurrent((v) => !v)}
          disabled={loadingCurrent}
        >
          {loadingCurrent
            ? 'Loading current…'
            : showCurrent
              ? 'Hide current version'
              : 'Show current version (before)'}
        </button>
        {showCurrent && !loadingCurrent && (
          <div className="pc-update-current-body">
            {currentSummary && (
              <p className="pc-update-current-summary">
                <span className="pc-why-label">Current summary</span> {currentSummary}
              </p>
            )}
            {currentContent.trim() ? (
              <Markdown content={currentContent} />
            ) : (
              <p style={{ color: 'var(--ink-faint)', fontStyle: 'italic' }}>
                The current note has no content yet.
              </p>
            )}
          </div>
        )}
      </div>

      {progress && <div className="pc-progress">{progress}</div>}
      {error && <div className="config-err" style={{ marginTop: 12 }}>{error}</div>}

      {/* ── Actions ── */}
      <div className="pc-actions">
        <button className="text-toggle pc-skip" onClick={skip} disabled={busy}>
          Skip
        </button>
        <OpenNote note={proposal} className="pc-open" />
        <div className="spacer" />
        {/* When stale, the primary path is Re-apply on latest (above); the plain
            Accept stays disabled so the human can't clobber by reflex. */}
        <button
          className="btn pc-accept"
          onClick={accept}
          disabled={busy || loadingCurrent || conflict !== null || blockApply}
          title={
            blockApply
              ? 'Blocked: this update has no content and would erase the dossier.'
              : conflict
                ? 'This entity changed since the proposal — use “Re-apply on latest”.'
                : 'Apply this update'
          }
        >
          {busy ? (progress ?? 'Working…') : 'Accept · update'}
        </button>
      </div>
    </article>
  )
}
