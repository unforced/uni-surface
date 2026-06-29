import { NavLink } from 'react-router-dom'

// Section lenses — Projects, Dev, Writing, and Life(Arc) are one board read
// through different lenses, not four separate destinations. This calm pill row
// sits at the top of each of those pages so switching between them feels like
// turning a dial, not navigating away. The look mirrors the Weave
// Proposals/Unwoven segmented control (.weave-tabs) so it reads as native.
//
// Presentation only: each lens keeps its own data + body below the bar. `active`
// is passed explicitly (rather than derived from the route) so a page renders
// the bar correctly even when its path differs from the lens slug.
export type Lens = 'projects' | 'dev' | 'writing' | 'life'

const LENSES: { key: Lens; label: string; to: string }[] = [
  { key: 'projects', label: 'All work', to: '/projects' },
  { key: 'dev', label: 'Dev', to: '/dev' },
  { key: 'writing', label: 'Writing', to: '/writing' },
  { key: 'life', label: 'Life', to: '/arc' },
]

export function SectionLenses({ active }: { active: Lens }) {
  return (
    <div className="lens-tabs" role="tablist" aria-label="Work lenses">
      {LENSES.map((l) => (
        <NavLink
          key={l.key}
          to={l.to}
          role="tab"
          aria-selected={l.key === active}
          className={`lens-tab${l.key === active ? ' sel' : ''}`}
        >
          {l.label}
        </NavLink>
      ))}
    </div>
  )
}
