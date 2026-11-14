import type { FileIssue, PatternFileProblem } from '@core'

/** Every word the renderer shows about a file. Design: docs/design/m8-file-io.md, decision 8. */

const SHOWN_ISSUES = 3

/** The file name with its extension, from a path on any OS. */
export const fileNameOf = (path: string): string => path.split(/[/\\]/).pop() ?? path

function issueList(issues: readonly FileIssue[]): string {
  const shown = issues.slice(0, SHOWN_ISSUES).map((issue) => `${issue.path}: ${issue.message}`)
  const more = issues.length - shown.length
  return `${shown.join('; ')}${more > 0 ? `, and ${more} more` : ''}.`
}

/** What went wrong opening `fileName`. */
export function problemText(problem: PatternFileProblem, fileName: string): string {
  switch (problem.kind) {
    case 'empty':
      return `${fileName} is empty.`
    case 'not-text':
      return `${fileName} isn't a pattern file. If it's a pattern saved in another encoding, save it again as UTF-8.`
    case 'not-json':
      return problem.cutShort
        ? `${fileName} is damaged. It ends too early, so it may have been cut off while saving or copying.`
        : `${fileName} is damaged and can't be read as JSON. (${problem.detail})`
    case 'not-a-pattern':
      return `${fileName} isn't a pattern file.`
    case 'newer-version':
      return `${fileName} was made by a newer version of Parametric Pattern Maker (format ${problem.version}). Update the app to open it.`
    case 'invalid':
      return `${fileName} can't be opened: ${issueList(problem.issues)}`
    default: {
      const _exhaustive: never = problem
      return _exhaustive
    }
  }
}

export const upgradedText = (fileName: string): string =>
  `${fileName} was made by an older version. Saving updates it, and older versions won't open it after that.`

export const unsavableText = (issues: readonly FileIssue[]): string => `This pattern can't be saved: ${issueList(issues)}`
