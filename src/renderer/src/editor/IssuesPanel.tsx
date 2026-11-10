import type { EvaluationIssue } from '@core'
import { selectionForIssue } from './inspect'
import type { Selection } from './state'

interface IssuesPanelProps {
  issues: readonly EvaluationIssue[]
  onSelect: (selection: Selection) => void
}

/** Every evaluation issue. Clicking one opens the item it's about, which is how you reach a point the canvas can't draw. */
export function IssuesPanel({ issues, onSelect }: IssuesPanelProps) {
  return (
    <section aria-labelledby="issues-heading" className="border-t border-neutral-200 p-4">
      <h2 id="issues-heading" className="mb-2 text-sm font-semibold text-neutral-700">
        Issues ({issues.length})
      </h2>
      {issues.length === 0 ? (
        <p className="text-sm text-neutral-500">No issues.</p>
      ) : (
        <ul className="space-y-1">
          {issues.map((issue, i) => {
            const selection = selectionForIssue(issue)
            return (
              <li key={i} className="text-sm text-red-700">
                {selection ? (
                  <button type="button" className="text-left hover:underline" onClick={() => onSelect(selection)}>
                    {issue.message}
                  </button>
                ) : (
                  issue.message
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
