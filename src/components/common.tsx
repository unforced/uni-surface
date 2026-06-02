import { Link } from 'react-router-dom'
import type { NoteRef, Note } from '../vault/types'
import { entityTypeOf, RELATIONSHIP_LABELS } from '../vault/types'
import { entityName, entityHref } from '../vault/util'

// ── Entity chip — navigable, color-dotted by type ──
export function EntityChip({
  entity,
  relationship,
  showRel = false,
}: {
  entity: NoteRef | Note
  relationship?: string
  showRel?: boolean
}) {
  const type = entityTypeOf(entity)
  return (
    <Link to={entityHref(entity)} className={`chip t-${type ?? ''}`} title={entity.metadata?.summary as string | undefined}>
      <span className="dot" />
      {showRel && relationship && (
        <span className="rel">{RELATIONSHIP_LABELS[relationship] ?? relationship}</span>
      )}
      <span className="name">{entityName(entity)}</span>
    </Link>
  )
}

// ── Loading / error / empty ──
export function Loading({ label = 'Gathering…' }: { label?: string }) {
  return (
    <div className="loading-wrap">
      <div className="breathing" />
      <p style={{ marginTop: 16 }}>{label}</p>
    </div>
  )
}

export function ErrorBanner({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : String(error)
  return (
    <div className="error-banner">
      {msg}
      {onRetry && (
        <>
          {' '}
          <a onClick={onRetry} style={{ cursor: 'pointer' }}>
            try again
          </a>
        </>
      )}
    </div>
  )
}

export function EmptyState({
  art = '𓂃',
  title,
  children,
}: {
  art?: string
  title: string
  children?: React.ReactNode
}) {
  return (
    <div className="empty-state">
      <div className="es-art">{art}</div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  )
}

export function Toast({ message }: { message: string }) {
  return <div className="toast">{message}</div>
}
