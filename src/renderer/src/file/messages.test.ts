import { describe, expect, it } from 'vitest'
import { fileNameOf, problemText, unsavableText } from './messages'

describe('problemText', () => {
  it('shows three issues, then how many more', () => {
    const issues = Array.from({ length: 5 }, (_, i) => ({ path: `points[${i}].x`, message: 'Invalid input' }))
    const [first, ...rest] = issues
    if (!first) throw new Error('no issues')
    expect(problemText({ kind: 'invalid', issues: [first, ...rest] }, 'a.json')).toBe(
      "a.json can't be opened: points[0].x: Invalid input; points[1].x: Invalid input; points[2].x: Invalid input, and 2 more."
    )
  })

  it.each([
    [{ kind: 'not-text' } as const, "a.json isn't a pattern file. If it's a pattern saved in another encoding, save it again as UTF-8."],
    [{ kind: 'not-json', cutShort: false, detail: 'Unexpected token' } as const, "a.json is damaged and can't be read as JSON. (Unexpected token)"]
  ])('says %j plainly', (problem, words) => {
    expect(problemText(problem, 'a.json')).toBe(words)
  })

  it('names an unsavable pattern’s problem', () => {
    expect(unsavableText([{ path: 'measurements[0].values.S', message: 'Invalid input' }])).toBe("This pattern can't be saved: measurements[0].values.S: Invalid input.")
  })
})

describe('fileNameOf', () => {
  it.each([
    ['/home/me/Raglan.json', 'Raglan.json'],
    ['C:\\Users\\me\\Raglan.json', 'Raglan.json']
  ])('takes the name from %s', (path, name) => {
    expect(fileNameOf(path)).toBe(name)
  })
})
