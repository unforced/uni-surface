import { useState } from 'react'
import { getConfig } from '../vault/config'
import { VoiceGlyph } from './icons'

// Voice captures embed `![[memo-*.webm]]`. The vault's file-serving route is
// not part of the documented REST surface, so we *try* a few plausible URLs
// (token as query param) and fall back to a calm "attachment present" note.
// This stays correct whether or not the host serves the file.

function candidateUrls(origin: string, token: string, file: string): string[] {
  const enc = encodeURIComponent(file)
  const q = `token=${encodeURIComponent(token)}`
  return [
    `${origin}/api/files/${enc}?${q}`,
    `${origin}/files/${enc}?${q}`,
    `${origin}/api/attachments/${enc}?${q}`,
    `${origin}/attachments/${enc}?${q}`,
  ]
}

export function AudioEmbed({ file }: { file: string }) {
  const cfg = getConfig()
  const [idx, setIdx] = useState(0)
  const [failed, setFailed] = useState(false)

  if (!cfg) return null
  const urls = candidateUrls(cfg.origin, cfg.token, file)

  if (failed) {
    return (
      <div className="audio-block">
        <span style={{ color: 'var(--clay)' }}>
          <VoiceGlyph />
        </span>
        <span className="audio-missing">
          Voice memo <code>{file}</code> — audio not reachable over the API on this host.
        </span>
      </div>
    )
  }

  return (
    <div className="audio-block">
      <span style={{ color: 'var(--clay)' }}>
        <VoiceGlyph />
      </span>
      <audio
        controls
        src={urls[idx]}
        onError={() => {
          if (idx < urls.length - 1) setIdx(idx + 1)
          else setFailed(true)
        }}
      />
    </div>
  )
}
