import { Fragment, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import { Link } from 'react-router-dom'
import { useEntityIndex } from '../vault/EntityIndex'
import { captureHref, entityHref } from '../vault/util'

// Render markdown content, turning [[wikilinks]] into in-app navigable links
// and stripping ![[audio]] embeds (handled separately by AudioEmbed).

const EMBED_RE = /!\[\[[^\]]*?\]\]/g
const WIKILINK_SPLIT = /(\[\[[^\]]+?\]\])/g
const WIKILINK_ONE = /^\[\[([^\]]+?)\]\]$/

function WikiText({ text }: { text: string }) {
  const { resolve } = useEntityIndex()
  const parts = text.split(WIKILINK_SPLIT)
  return (
    <>
      {parts.map((part, i) => {
        const m = part.match(WIKILINK_ONE)
        if (!m) return <Fragment key={i}>{part}</Fragment>
        const target = m[1]
        const [path, alias] = target.split('|')
        const label = (alias ?? path).split('/').pop()!
        const hit = resolve(target)
        if (hit) {
          return (
            <Link key={i} to={entityHref(hit)} className="wikilink">
              {label}
            </Link>
          )
        }
        // unresolved — render as a soft non-link (still readable)
        return (
          <span key={i} className="wikilink-dead" title="No matching note">
            {label}
          </span>
        )
      })}
    </>
  )
}

// Recursively wrap string children so wikilinks inside paragraphs resolve.
function wrapChildren(children: ReactNode): ReactNode {
  if (typeof children === 'string') {
    return children.includes('[[') ? <WikiText text={children} /> : children
  }
  if (Array.isArray(children)) {
    return children.map((c, i) => <Fragment key={i}>{wrapChildren(c)}</Fragment>)
  }
  return children
}

export function Markdown({ content }: { content: string }) {
  const cleaned = content.replace(EMBED_RE, '').trim()
  return (
    <div className="markdown">
      <ReactMarkdown
        components={{
          a: ({ href, children }) => {
            // resolve internal-looking links; external open in new tab
            if (href && /^https?:\/\//.test(href)) {
              return (
                <a href={href} target="_blank" rel="noreferrer">
                  {children}
                </a>
              )
            }
            return <span>{children}</span>
          },
          p: ({ children }) => <p>{wrapChildren(children)}</p>,
          li: ({ children }) => <li>{wrapChildren(children)}</li>,
          h1: ({ children }) => <h1>{wrapChildren(children)}</h1>,
          h2: ({ children }) => <h2>{wrapChildren(children)}</h2>,
          h3: ({ children }) => <h3>{wrapChildren(children)}</h3>,
          em: ({ children }) => <em>{wrapChildren(children)}</em>,
          strong: ({ children }) => <strong>{wrapChildren(children)}</strong>,
          blockquote: ({ children }) => <blockquote>{wrapChildren(children)}</blockquote>,
        }}
      >
        {cleaned}
      </ReactMarkdown>
    </div>
  )
}

// Re-export for capture detail use of captureHref if needed.
export { captureHref }
