import { createContext, useContext, useMemo } from 'react'
import { listNotes } from './api'
import { ENTITY_PARENT_TAG } from './types'
import type { Note } from './types'
import { useAsync } from './useAsync'
import { entityName } from './util'

interface EntityIndexValue {
  entities: Note[]
  loading: boolean
  error: unknown
  reload: () => void
  // resolve a [[wikilink]] target or bare name → entity path (or null)
  resolve: (target: string) => Note | null
  byPath: Map<string, Note>
}

const Ctx = createContext<EntityIndexValue | null>(null)

export function EntityIndexProvider({ children }: { children: React.ReactNode }) {
  const { data, loading, error, reload } = useAsync(
    () =>
      listNotes({
        tag: ENTITY_PARENT_TAG,
        includeMetadata: true,
        limit: 1000,
        sort: 'asc',
      }),
    [],
  )

  const value = useMemo<EntityIndexValue>(() => {
    const entities = data ?? []
    const byPath = new Map<string, Note>()
    const byName = new Map<string, Note>()
    for (const e of entities) {
      byPath.set(e.path.toLowerCase(), e)
      const n = entityName(e).toLowerCase()
      if (!byName.has(n)) byName.set(n, e)
    }
    const resolve = (target: string): Note | null => {
      const t = target.split('|')[0].trim() // [[Path|Alias]] → Path
      const lower = t.toLowerCase()
      // exact path
      if (byPath.has(lower)) return byPath.get(lower)!
      // path with trailing name segment match
      if (byName.has(lower)) return byName.get(lower)!
      // try last segment of a slashed target
      const last = lower.split('/').pop()!
      if (byName.has(last)) return byName.get(last)!
      return null
    }
    return { entities, loading, error, reload, resolve, byPath }
  }, [data, loading, error, reload])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useEntityIndex(): EntityIndexValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useEntityIndex outside provider')
  return v
}
