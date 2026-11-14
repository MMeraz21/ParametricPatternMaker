import type { Notice } from '../editor/state'

/** The last file problem or remark, under the header until dismissed or the next file command. */
export function NoticeBar({ notice, onDismiss }: { notice: Notice; onDismiss: () => void }) {
  const error = notice.tone === 'error'
  return (
    <div
      role={error ? 'alert' : 'status'}
      className={`flex items-start gap-3 border-b px-4 py-2 text-sm ${error ? 'border-red-200 bg-red-50 text-red-800' : 'border-sky-200 bg-sky-50 text-sky-900'}`}
    >
      <p className="flex-1">{notice.text}</p>
      <button type="button" onClick={onDismiss} aria-label="Dismiss" className="rounded px-1 hover:bg-black/5">
        ×
      </button>
    </div>
  )
}
