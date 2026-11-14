import { useEffect, useMemo, useState } from 'react'
import { PAPER, PRINT_INSTRUCTION, planPoster, printStatus, writePosterFile, type ExportFormat, type GradedPattern, type PaperName, type Pattern } from '@core'
import { defaultPaper, defaultTicks, pagesOf, refusalText, stageAfter, type ExportStage } from './stage'

/** Chosen once per session, so reopening the dialog keeps it. */
let sessionPaper: PaperName | null = null

export function ExportDialog({
  pattern,
  graded,
  shownSize,
  defaultTitle,
  onClose
}: {
  pattern: Pattern
  graded: GradedPattern
  shownSize: string
  /** The document's name, or "Pattern" for an untitled one. */
  defaultTitle: string
  onClose: () => void
}) {
  const status = useMemo(() => printStatus(pattern, graded), [pattern, graded])
  const [ticked, setTicked] = useState(() => defaultTicks(status, shownSize))
  const [paper, setPaper] = useState<PaperName>(() => sessionPaper ?? defaultPaper(navigator.language))
  const [title, setTitle] = useState(defaultTitle)
  const [stage, setStage] = useState<ExportStage>({ kind: 'idle' })
  const outcome = useMemo(() => planPoster(pattern, graded, { sizes: [...ticked], paper, title: title.trim() || 'Pattern' }), [pattern, graded, ticked, paper, title])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && stage.kind !== 'working') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, stage.kind])

  function toggle(size: string): void {
    const next = new Set(ticked)
    if (next.has(size)) next.delete(size)
    else next.add(size)
    setTicked(next)
    setStage({ kind: 'idle' })
  }

  async function exportNow(format: ExportFormat): Promise<void> {
    if (outcome.kind !== 'planned') return
    setStage({ kind: 'working' })
    try {
      setStage(stageAfter(await window.api.saveExport(await writePosterFile(outcome.plan, format))))
    } catch (cause) {
      setStage({ kind: 'failed', message: `The file couldn't be built: ${String(cause)}` })
    }
  }

  const working = stage.kind === 'working'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onMouseDown={(e) => e.target === e.currentTarget && !working && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Export" className="w-[28rem] rounded-lg border border-neutral-200 bg-white p-4 text-sm shadow-xl">
        <h2 className="mb-3 text-base font-semibold">Export</h2>

        <fieldset className="mb-3">
          <legend className="mb-1 font-medium">Sizes</legend>
          <ul className="space-y-1">
            {status.map((row) => {
              const refusal = refusalText(row)
              return (
                <li key={row.size}>
                  <label className={`flex items-center gap-2 ${refusal ? 'text-neutral-400' : ''}`}>
                    <input type="checkbox" aria-label={`Size ${row.size}`} checked={ticked.has(row.size)} disabled={refusal !== null} onChange={() => toggle(row.size)} />
                    {row.size}
                  </label>
                  {refusal && <p className="ml-6 text-xs text-red-700">{refusal}</p>}
                </li>
              )
            })}
          </ul>
        </fieldset>

        <div className="mb-3 flex items-center gap-4">
          <label className="flex items-center gap-1">
            Paper
            <select
              aria-label="Paper"
              value={paper}
              onChange={(e) => {
                const next = e.target.value
                if (next === 'letter' || next === 'a4') {
                  sessionPaper = next
                  setPaper(next)
                }
              }}
              className="rounded border border-neutral-300 bg-white px-1 py-0.5"
            >
              {Object.entries(PAPER).map(([name, { label }]) => (
                <option key={name} value={name}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-1 items-center gap-1">
            Title
            <input aria-label="Title" value={title} onChange={(e) => setTitle(e.target.value)} className="min-w-0 flex-1 rounded border border-neutral-300 px-1 py-0.5" />
          </label>
        </div>

        <p className="mb-2 font-medium" aria-live="polite">
          {outcome.kind === 'planned' ? `${pagesOf(outcome.plan)} pages of ${PAPER[paper].label}` : 'Nothing to export. Tick a size that can be printed.'}
        </p>
        <p className="mb-3 rounded bg-amber-50 p-2 text-xs text-amber-900">{PRINT_INSTRUCTION}</p>

        {stage.kind === 'saved' && (
          <p role="status" className="mb-3 text-xs text-green-800">
            Saved to {stage.path}
          </p>
        )}
        {stage.kind === 'failed' && (
          <p role="alert" className="mb-3 text-xs text-red-700">
            {stage.message}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={working} className="rounded border border-neutral-300 px-3 py-1 disabled:opacity-50">
            Close
          </button>
          <button
            type="button"
            onClick={() => void exportNow('svg')}
            disabled={working || outcome.kind !== 'planned'}
            className="rounded border border-neutral-300 px-3 py-1 disabled:opacity-50"
          >
            Save SVG
          </button>
          <button
            type="button"
            onClick={() => void exportNow('pdf')}
            disabled={working || outcome.kind !== 'planned'}
            className="rounded bg-neutral-800 px-3 py-1 text-white disabled:opacity-50"
          >
            {working ? 'Exporting…' : 'Save PDF'}
          </button>
        </div>
      </div>
    </div>
  )
}
