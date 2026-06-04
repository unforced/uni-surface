import { Link } from 'react-router-dom'
import { getNote } from '../vault/api'
import { useAsync } from '../vault/useAsync'
import { openCapture } from '../App'
import { Markdown } from './Markdown'
import { Seed } from './icons'

// Pull a "## Heading" section's body out of a note's markdown.
function section(content: string, heading: string): string {
  const lines = content.split('\n')
  const start = lines.findIndex((l) => l.trim().toLowerCase() === `## ${heading}`.toLowerCase())
  if (start < 0) return ''
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) {
      end = i
      break
    }
  }
  return lines.slice(start + 1, end).join('\n').trim()
}

// Split "## This morning" into its individual prompts, each a block that opens
// with a bold lead (**The work.** or the older **N. Title.** form). Returns the
// raw markdown block + a short label (the bold lead) used as the reply target so
// a response threads to the right prompt. Falls back to one block otherwise.
function splitQuestions(body: string): { block: string; label: string }[] {
  if (!body) return []
  const blocks = body.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean)
  const questions = blocks.filter((b) => /^\*\*/.test(b))
  if (questions.length === 0) return body ? [{ block: body, label: 'this morning' }] : []
  return questions.map((block) => {
    const m = block.match(/^\*\*(.+?)\*\*/)
    const inner = (m?.[1] ?? '').trim()
    const label = inner.replace(/^\d+\.\s*/, '').replace(/\.$/, '') || 'this morning'
    return { block, label }
  })
}

// The morning surface on Today: the live Open Inquiry questions, each its own
// card you can answer. The front-end of the daily tending loop — and the start
// of the conversation: a "Respond" threads your capture back to that question
// (responds-to), so the next weave can read the exchange. Renders nothing if
// neither tending note exists yet (graceful before the first weave).
export function MorningCard() {
  const { data } = useAsync(async () => {
    const [now, inquiry] = await Promise.allSettled([getNote('Now'), getNote('Open Inquiry')])
    return {
      now: now.status === 'fulfilled' ? now.value : null,
      inquiry: inquiry.status === 'fulfilled' ? inquiry.value : null,
    }
  }, [])

  if (!data || (!data.now && !data.inquiry)) return null

  const inquiryBody = data.inquiry?.content ?? ''
  const questions = splitQuestions(section(inquiryBody, 'This morning'))
  const throughline = section(data.now?.content ?? '', 'The throughline')

  return (
    <section className="morning-card">
      <div className="morning-head">
        <span className="morning-glyph"><Seed size={18} /></span>
        <h2>This morning</h2>
        {data.inquiry && (
          <Link className="morning-all" to="/note/Open%20Inquiry">
            Open Inquiry →
          </Link>
        )}
      </div>

      {questions.length > 0 ? (
        <div className="morning-questions">
          {questions.map((q, i) => (
            <div className="mq" key={i}>
              <div className="mq-body">
                <Markdown content={q.block} />
              </div>
              <button
                className="mq-respond"
                onClick={() => openCapture({ id: 'Open Inquiry', label: q.label })}
              >
                Respond <span className="mq-respond-arrow">↩</span>
              </button>
            </div>
          ))}
        </div>
      ) : data.inquiry ? (
        <p className="morning-quiet">No questions waiting — a quiet morning.</p>
      ) : null}

      <div className="morning-foot">
        <button className="morning-respond" onClick={() => openCapture()}>
          Capture something else
        </button>
        {data.now && (
          <Link className="morning-now" to="/note/Now" title={throughline}>
            What's alive now →
          </Link>
        )}
      </div>
    </section>
  )
}
