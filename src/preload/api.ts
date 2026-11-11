/** A finished file for the user to save. Structural, so a core PosterFile passes straight through and preload never imports core. */
export interface SaveExportRequest {
  readonly fileName: string
  readonly data: Uint8Array
}

export type SaveExportResult =
  | { readonly kind: 'saved'; readonly path: string }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'failed'; readonly message: string }

export interface Api {
  getVersion: () => Promise<string>
  /** Asks where to save, then writes. Never rejects: every outcome is a result. */
  saveExport: (request: SaveExportRequest) => Promise<SaveExportResult>
}
