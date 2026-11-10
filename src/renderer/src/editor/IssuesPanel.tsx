import type { ShownIssue } from '@core'

interface IssuesPanelProps {
  issues: readonly ShownIssue[]
  onOpen: (issue: ShownIssue) => void
}

/** The badge names the sizes, so a row only spells them out when their reports read differently. */
const wording = (issue: ShownIssue): string => (issue.instances.every(({ issue: report }) => report.message === issue.message) ? issue.message : issue.text)

/** Every problem, in any size. Clicking one opens the item it's about, in a size that has the problem. */
export function IssuesPanel({ issues, onOpen }: IssuesPanelProps) {
  return (
    <section aria-labelledby="issues-heading" className="border-t border-neutral-200 p-4">
      <h2 id="issues-heading" className="mb-2 text-sm font-semibold text-neutral-700">
        Issues ({issues.length})
      </h2>
      {issues.length === 0 ? (
        <p className="text-sm text-neutral-500">No issues.</p>
      ) : (
        <ul className="space-y-1">
          {issues.map((issue) => (
            <li key={issue.key} className={`text-sm ${issue.here ? 'text-red-700' : 'text-amber-700'}`}>
              <button type="button" className="text-left hover:underline" onClick={() => onOpen(issue)}>
                {wording(issue)}
              </button>
              {issue.scope !== null && <span className="ml-1 rounded bg-amber-100 px-1 text-xs text-amber-800">{issue.scope}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
