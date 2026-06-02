import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getNote } from '../vault/api'
import type { Note } from '../vault/types'
import { captureKindOf } from '../vault/types'
import { useAsync } from '../vault/useAsync'
import { Markdown } from '../components/Markdown'
import { AudioEmbed } from '../components/AudioEmbed'
import { WeaveEditor } from '../components/WeaveEditor'
import { Loading, ErrorBanner, EntityChip, Toast } from '../components/common'
import { BackIcon, captureGlyph, LinkIcon } from '../components/icons'
import { findAudioEmbed, linkedEntities, formatDayHeading, dayKey, formatTime } from '../vault/util'

export function CaptureDetail() {
  const { id = '' } = useParams()
  const [weaving, setWeaving] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const { data, loading, error, reload } = useAsync(
    () => getNote(decodeURIComponent(id), { includeLinks: true }),
    [id],
  )

  function onWoven(_updated: Note) {
    setWeaving(false)
    setToast('Woven 🌿')
    setTimeout(() => setToast(null), 2000)
    reload()
  }

  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <Link to="/" className="back-link">
        <BackIcon /> Today
      </Link>

      {loading && <Loading />}
      {Boolean(error) && <ErrorBanner error={error} onRetry={reload} />}

      {data && (
        <>
          <div className="capture-meta" style={{ fontSize: 13 }}>
            <span style={{ color: 'var(--clay)' }}>{captureGlyph(captureKindOf(data))}</span>
            <span className="kind">{captureKindOf(data) ?? 'note'}</span>
            <span>·</span>
            <span>
              {formatDayHeading(dayKey(data.createdAt))} · {formatTime(data.createdAt)}
            </span>
          </div>

          {(() => {
            const audio = data.content ? findAudioEmbed(data.content) : null
            return audio ? <AudioEmbed file={audio} /> : null
          })()}

          {data.content ? (
            <Markdown content={data.content} />
          ) : (
            <p style={{ color: 'var(--ink-faint)' }}>(no text content)</p>
          )}

          {/* Links */}
          <div style={{ marginTop: 30 }}>
            <div className="section-title">Woven into</div>
            {(() => {
              const linked = linkedEntities(data)
              if (linked.length === 0) {
                return (
                  <p style={{ color: 'var(--ink-soft)' }}>
                    Not woven yet.{' '}
                    <button
                      className="text-toggle"
                      onClick={() => setWeaving(true)}
                      style={{ display: 'inline' }}
                    >
                      Weave it now →
                    </button>
                  </p>
                )
              }
              return (
                <>
                  <div className="chips">
                    {linked.map((l) => (
                      <EntityChip key={l.ref.id} entity={l.ref} relationship={l.relationship} showRel />
                    ))}
                  </div>
                  <button className="btn-ghost btn" style={{ marginTop: 16 }} onClick={() => setWeaving(true)}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <LinkIcon /> Add more links
                    </span>
                  </button>
                </>
              )
            })()}
          </div>
        </>
      )}

      {weaving && data && (
        <WeaveEditor capture={data} onClose={() => setWeaving(false)} onWoven={onWoven} />
      )}
      {toast && <Toast message={toast} />}
    </div>
  )
}
