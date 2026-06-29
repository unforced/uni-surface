import { Link } from 'react-router-dom'
import { listNotes } from '../vault/api'
import type { Note } from '../vault/types'
import { entityTypeOf } from '../vault/types'
import { useAsync } from '../vault/useAsync'
import { entityHref, entityName } from '../vault/util'
import { Loading, ErrorBanner } from '../components/common'
import { SectionLenses } from '../components/SectionLenses'

// The Projects dashboard — every endeavor as a card, grouped by status. Lives off
// the graph: `#project` entities plus their subtypes (`#dev/build` software,
// `#piece` writing) all resolve to the project type via subtype expansion, so a
// single `tag: 'project'` query surfaces them together. Active is the prominent
// grid; Incubating shows when present; Resting (dormant / archived / blank) is
// collapsed so the historical projects don't crowd the live ones.
//
// Future: a "threads tending this project" strand will land once project threads
// exist (inbound thread → project edges).
export function Projects() {
  const projects = useAsync(
    () => listNotes({ tag: 'project', includeMetadata: true, limit: 300, sort: 'asc' }),
    [],
  )

  // Subtype expansion can pull in non-entity matches; keep only real project-typed
  // notes (build/piece resolve to project in entityTypeOf).
  const all = (projects.data ?? []).filter((n) => entityTypeOf(n) === 'project')

  const byName = (a: Note, b: Note) =>
    entityName(a).localeCompare(entityName(b), undefined, { sensitivity: 'base' })

  const statusOf = (n: Note) => String(n.metadata?.status ?? '').trim().toLowerCase()

  const active = all.filter((n) => statusOf(n) === 'active').sort(byName)
  const incubating = all.filter((n) => statusOf(n) === 'incubating').sort(byName)
  const resting = all
    .filter((n) => {
      const s = statusOf(n)
      return s !== 'active' && s !== 'incubating'
    })
    .sort(byName)

  return (
    <div className="page">
      <SectionLenses active="projects" />
      <div className="page-head">
        <div className="kicker">the work</div>
        <h1>All work</h1>
        <p className="sub">One board, every endeavor — what's live, what's stirring, and what's at rest. Switch the lens above to read it by domain.</p>
      </div>

      {Boolean(projects.error) && <ErrorBanner error={projects.error} onRetry={projects.reload} />}
      {projects.loading && all.length === 0 && <Loading label="…" />}

      <section className="dev-section">
        <div className="section-title">Active</div>
        {!projects.loading && active.length === 0 ? (
          <p className="dev-hint">No active projects.</p>
        ) : (
          <div className="dev-builds">
            {active.map((p) => (
              <ProjectCard key={p.id} project={p} />
            ))}
          </div>
        )}
      </section>

      {incubating.length > 0 && (
        <section className="dev-section">
          <div className="section-title">Incubating</div>
          <div className="dev-builds">
            {incubating.map((p) => (
              <ProjectCard key={p.id} project={p} />
            ))}
          </div>
        </section>
      )}

      {resting.length > 0 && (
        <section className="dev-section">
          <details className="proj-resting">
            <summary>Resting · {resting.length}</summary>
            <div className="dev-builds proj-resting-grid">
              {resting.map((p) => (
                <ProjectCard key={p.id} project={p} />
              ))}
            </div>
          </details>
        </section>
      )}
    </div>
  )
}

function ProjectCard({ project }: { project: Note }) {
  const role = String(project.metadata?.role ?? '').trim()
  const parachute = String(project.metadata?.parachute ?? '').trim()
  const summary = String(project.metadata?.summary ?? '').trim()
  const showParachute = Boolean(parachute) && parachute !== 'this'

  return (
    <Link to={entityHref(project)} className="board-item">
      <div className="bi-name">
        <span className={`status-dot status-${project.metadata?.status ?? 'active'}`} />
        {entityName(project)}
      </div>
      {(role || showParachute) && (
        <div className="proj-meta">
          {role && <span className="proj-role">{role}</span>}
          {showParachute && <span className="proj-chip">{parachute}</span>}
        </div>
      )}
      {summary && <div className="bi-sum">{summary}</div>}
    </Link>
  )
}
