import type { CaptureKind } from '../vault/types'

const s = { width: 16, height: 16, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

// A little seed/sprout mark for the brand.
export function Seed({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M12 21c0-4 0-7 0-9" stroke="var(--sage)" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M12 13c-3.2 0-5.5-2-5.5-5C9.5 8 12 9.8 12 13Z" fill="var(--moss-wash)" stroke="var(--sage)" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M12 11c0-2.6 2-4.6 5-4.6C17 9 14.8 11 12 11Z" fill="var(--terracotta-wash)" stroke="var(--clay)" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="12" cy="21.5" r="1.3" fill="var(--clay)" />
    </svg>
  )
}

export function TextGlyph() {
  return <svg {...s} viewBox="0 0 24 24"><path d="M5 6h14M5 12h14M5 18h9" /></svg>
}
export function VoiceGlyph() {
  return <svg {...s} viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
}
export function DreamGlyph() {
  return <svg {...s} viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" /></svg>
}

export function captureGlyph(kind: CaptureKind | null) {
  if (kind === 'voice') return <VoiceGlyph />
  if (kind === 'dream') return <DreamGlyph />
  return <TextGlyph />
}

export function SearchIcon() {
  return <svg {...s} viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" /></svg>
}
export function CloseIcon() {
  return <svg {...s} viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg>
}
export function SunIcon() {
  return <svg {...s} viewBox="0 0 24 24"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19" /></svg>
}
export function MoonIcon() {
  return <svg {...s} viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" /></svg>
}
export function BackIcon() {
  return <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
}
export function PlusIcon() {
  return <svg {...s} viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
}
export function LinkIcon() {
  return <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1" /></svg>
}

// ── Spine icons (the mobile bottom tab bar + reusable elsewhere) ──
// Single-stroke, 24-grid, matching the line weight of the glyphs above. Each
// takes the shared `s` style so they pick up currentColor + the 1.8 stroke.
export function HomeIcon() {
  return <svg {...s} viewBox="0 0 24 24"><path d="M4 11.5 12 4l8 7.5M6 10v9h12v-9" /></svg>
}
// Uni — two arcs leaning into one another (you and I, joined).
export function UniIcon() {
  return <svg {...s} viewBox="0 0 24 24"><path d="M8 5v8a4 4 0 0 0 8 0V5" /><circle cx="12" cy="18.5" r="1.1" fill="currentColor" stroke="none" /></svg>
}
export function TodayIcon() {
  return <svg {...s} viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="2.5" /><path d="M4 9.5h16M8 3.5v3M16 3.5v3" /></svg>
}
// Projects — stacked layers, the board of endeavors.
export function ProjectsIcon() {
  return <svg {...s} viewBox="0 0 24 24"><path d="M12 3.5 21 8l-9 4.5L3 8l9-4.5Z" /><path d="M3 12.5 12 17l9-4.5" /></svg>
}
// Browse — the graph: a node with branches.
export function BrowseIcon() {
  return <svg {...s} viewBox="0 0 24 24"><circle cx="6" cy="12" r="2.4" /><circle cx="18" cy="6" r="2.4" /><circle cx="18" cy="18" r="2.4" /><path d="M8.1 11l7.8-3.8M8.1 13l7.8 3.8" /></svg>
}
