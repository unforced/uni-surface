// Dismissed link-suggestions, remembered locally. When a suggested capture is a
// miss (e.g. the word "will" matched the friend "Will"), dismissing it hides the
// row AND keeps it hidden across visits — so the suggester stops re-asking.
// Stored in localStorage keyed by entityId|captureId (per-device; a lightweight
// negative signal, no graph noise).

const KEY = 'pv.dismissedMentions'

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

const key = (entityId: string, captureId: string) => `${entityId}|${captureId}`

export function dismissMention(entityId: string, captureId: string): void {
  const map = load()
  map[key(entityId, captureId)] = 1
  save(map)
}

// All capture ids dismissed for a given entity.
export function dismissedFor(entityId: string): Set<string> {
  const map = load()
  const out = new Set<string>()
  const prefix = `${entityId}|`
  for (const k of Object.keys(map)) {
    if (k.startsWith(prefix)) out.add(k.slice(prefix.length))
  }
  return out
}
