/**
 * The bridge between the sandboxed renderer and main. Structural types only: preload never imports core.
 * Designs: docs/design/m7-export.md (export), docs/design/m8-file-io.md (pattern files).
 */

/** A finished file for the user to save. Structural, so a core PosterFile passes straight through and preload never imports core. */
export interface SaveExportRequest {
  readonly fileName: string
  readonly data: Uint8Array
}

export type SaveExportResult =
  | { readonly kind: 'saved'; readonly path: string }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'failed'; readonly message: string }

/** A pattern file the window has open. Main computed both fields. */
export interface DocumentFile {
  readonly path: string
  /** The file name without `.json`. The title and the export name use it. */
  readonly name: string
}

export type OpenDocumentRequest =
  /** The open dialog, starting in `near`'s folder, else Documents. */
  | { readonly kind: 'choose'; readonly near: string | null }
  /** A path from the recent list. */
  | { readonly kind: 'recent'; readonly path: string }

export type OpenDocumentResult =
  /** Bytes, unparsed: core reads them in the renderer. */
  | { readonly kind: 'read'; readonly file: DocumentFile; readonly data: Uint8Array }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'failed'; readonly message: string }

export type SaveDocumentRequest =
  /** Save in place. `path` must be one main handed out. */
  | { readonly kind: 'overwrite'; readonly path: string; readonly data: Uint8Array }
  /** Save As: the dialog suggests `<name>.json` in `near`'s folder, else Documents. */
  | { readonly kind: 'choose'; readonly name: string; readonly near: string | null; readonly data: Uint8Array }

export type SaveDocumentResult =
  /** `file` differs from an overwrite's path when the user chose Save As in the changed-on-disk prompt. */
  | { readonly kind: 'saved'; readonly file: DocumentFile }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'failed'; readonly message: string }

export type SaveChoice = 'save' | 'discard' | 'cancel'

/** What the window shows, for the title bar and the recent list. Display only: closing always asks the renderer. */
export interface DocumentStatus {
  readonly name: string
  readonly path: string | null
  readonly dirty: boolean
}

export type FileCommand =
  | { readonly kind: 'new' }
  | { readonly kind: 'open' }
  | { readonly kind: 'openRecent'; readonly path: string }
  | { readonly kind: 'save' }
  | { readonly kind: 'saveAs' }
  /** From main only: the window was asked to close. The renderer must answer with `answerClose`. */
  | { readonly kind: 'close' }

/** The commands a menu item runs with no argument. The menu keys a Record by this, so a new command fails the build until it has an item. */
export type MenuCommandKind = Exclude<FileCommand['kind'], 'openRecent' | 'close'>

export interface Api {
  getVersion: () => Promise<string>
  /** Asks where to save, then writes. Never rejects: every outcome is a result. */
  saveExport: (request: SaveExportRequest) => Promise<SaveExportResult>
  /** Never rejects. */
  openDocument: (request: OpenDocumentRequest) => Promise<OpenDocumentResult>
  /** Never rejects. */
  saveDocument: (request: SaveDocumentRequest) => Promise<SaveDocumentResult>
  /** The native Save / Don't Save / Cancel prompt for the document called `name`. */
  askToSave: (name: string) => Promise<SaveChoice>
  /** Fire and forget. */
  setDocumentStatus: (status: DocumentStatus) => void
  /** Fire and forget. The reply to a `close` command: true lets the window close. */
  answerClose: (proceed: boolean) => void
  /** Menu clicks, shortcuts and close requests. Returns the unsubscribe. The listener never sees the IPC event. */
  onFileCommand: (listener: (command: FileCommand) => void) => () => void
}
