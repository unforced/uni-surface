# Vault — a quiet garden for the mind

A personal, single-page thinking surface for your **Parachute Vault**. It reads
your captures (journal entries), entities (projects, people, places, threads,
practices, tools, references, organizations, seeds), and the links that weave
them together — and gives you a calm, *Today-first* place to see what's alive and
to weave loose captures into your graph.

It is a **static SPA**. No backend, no server of its own — it talks directly to
your vault over HTTP from your browser. Deploy it once to GitHub Pages; it works
against your local vault or your Tailscale URL, whichever you paste in.

![Today view](docs/screenshot.png)

## What it does

- **Today** (`/`) — a timeline spine of your recent captures grouped by day, each
  with a type glyph (note / voice / dream), a preview, and navigable chips for
  every entity it links to. Alongside it:
  - **What you're touching today** — derived live from today's captures' links
    (projects / threads / people), no LLM, just your data reflected back.
  - **A board rail** of active projects + living threads (dormant/archived hidden
    behind a toggle).
  - **A "To weave" tray** — recent *unwoven* captures (`has_links=false`). Open one
    to search your entities and add links, or create a new entity inline.
- **Capture detail** (`/capture/:id`) — full markdown content, voice playback when
  present, `[[wikilinks]]` rendered as in-app links, and all links as chips.
- **Entity detail** (`/entity/:path`) — editable summary, type-specific fields,
  every linked capture across time, and related entities (co-occurrence on shared
  captures).
- **Browse** (`/browse`) — all entities grouped by type, with summaries + filters.
- **Global search** (`⌘K` / `Ctrl-K`) — a command palette over captures (full-text)
  and entities.
- Warm / light by default; a dark toggle is in the top bar. Theme + connection are
  remembered in `localStorage`.

## Connecting (the one-time paste-in)

On first run you'll see a **Connect** screen. Paste two things:

1. **Vault origin** — the base URL of your vault, e.g.
   - local: `http://127.0.0.1:1940/vault/default`
   - Tailscale: `https://parachute.taildf9ce2.ts.net/vault/default`
2. **A token** — mint one with:
   ```bash
   parachute auth mint-token --scope vault:default:write --ephemeral
   ```
   (`:write` is needed for the weave/create features; use `:read` for read-only.)

These are stored only in your browser's `localStorage` and sent as
`Authorization: Bearer <token>` on every request. Nothing is hardcoded in the
source. There's a **change vault / sign out** button in the top-right that clears
them. Tokens are short-lived; if requests start failing with an auth error,
re-mint and re-paste.

> The vault sends `Access-Control-Allow-Origin: *`, so the static site can call it
> cross-origin from GitHub Pages.

## Run locally

Requires [Bun](https://bun.sh) (falls back to npm fine — swap `bun` for `npm`).

```bash
bun install
bun run dev      # http://localhost:5173/my-vault-ui/
bun run build    # type-check + production bundle into dist/
bun run preview  # serve the production build
```

## Deploy to GitHub Pages

```bash
gh repo create my-vault-ui --public --source=. --remote=origin --push
```

Then in the repo on GitHub: **Settings → Pages → Build and deployment → Source:
GitHub Actions**. The included workflow (`.github/workflows/deploy.yml`) builds
with Bun and publishes `dist/` via `upload-pages-artifact` + `deploy-pages` on
every push to `main`. Your site lands at
`https://<you>.github.io/my-vault-ui/`.

### Changing the base path

This is a **project site**, so Vite's `base` is set to `/my-vault-ui/` in
[`vite.config.ts`](vite.config.ts). The router reads it automatically.

- Different repo name? Change `base` to `/<your-repo>/`.
- Custom domain or a user/org page (`<you>.github.io`)? Change `base` to `'/'`.

`public/404.html` is a small SPA fallback so deep links (e.g. an entity URL) load
correctly on Pages; it assumes the same single base segment — no edit needed for a
normal project site, but set it aside if you move to a custom domain root.

## Tech & dependencies

Vite + React + TypeScript, React Router, static-only. Deliberately few deps:

| Dependency         | Why                                                                 |
| ------------------ | ------------------------------------------------------------------- |
| `react`, `react-dom` | UI.                                                               |
| `react-router-dom` | Client-side routing for the in-app navigation between captures/entities. |
| `react-markdown`   | Renders capture markdown. `[[wikilinks]]` and `![[audio]]` embeds are post-processed by the app itself (`src/components/Markdown.tsx`) into in-app navigable links + an audio player. |
| `puppeteer-core` *(dev only)* | Used once to capture `docs/screenshot.png` against a live vault. Not shipped. |

Fonts: Fraunces (serif headings) + Inter (body), loaded from Google Fonts.

### A note on voice attachments

Voice captures embed `![[memo-*.webm]]`. The vault's file-serving route isn't part
of the documented REST surface, so `AudioEmbed` tries a few plausible URLs and, if
none serve the file, shows a calm "audio attachment present" note instead of
breaking. If your host exposes attachments at a known path, that's the one place to
adjust (`src/components/AudioEmbed.tsx`).

## Layout

```
src/
  vault/          API client, config (localStorage auth), types, helpers, entity index
  components/     EntityChip, CaptureCard, WeaveEditor, Markdown (wikilinks), SearchPalette, AudioEmbed, icons
  routes/         Config (connect), Today, CaptureDetail, EntityDetail, Browse
  styles.css      the warm/organic theme
```
