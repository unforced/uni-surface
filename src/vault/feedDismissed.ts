// For You feed dismissals, remembered locally. Dismissing an item drops it from
// the feed and keeps it gone across visits — a per-device "I've seen this, not
// now" signal, distinct from resolving/approving the underlying note (which is a
// vault write). Reversible: the items are still in the source queries, just
// filtered out, so a "show dismissed" affordance can restore them.
//
// Stored in localStorage as a map of note-id → 1 (mirrors dismissed.ts).

const KEY = 'pv.dismissedFeed'

function load(): Record<string, 1> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, 1>
  } catch {
    return {}
  }
}

function save(map: Record<string, 1>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(map))
  } catch {
    /* storage full / unavailable — non-fatal */
  }
}

export function dismissFeedItem(id: string): void {
  const map = load()
  map[id] = 1
  save(map)
}

export function restoreFeedItem(id: string): void {
  const map = load()
  delete map[id]
  save(map)
}

export function dismissedFeedIds(): Set<string> {
  return new Set(Object.keys(load()))
}
