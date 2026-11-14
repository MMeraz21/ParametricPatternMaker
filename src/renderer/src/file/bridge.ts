/** The file types as the preload bridge declares them, so the renderer never imports from preload/. */
type Api = Window['api']

export type FileApi = Pick<Api, 'openDocument' | 'saveDocument' | 'askToSave' | 'answerClose'>
export type OpenDocumentResult = Awaited<ReturnType<Api['openDocument']>>
export type SaveDocumentResult = Awaited<ReturnType<Api['saveDocument']>>
export type DocumentFile = Extract<OpenDocumentResult, { kind: 'read' }>['file']
export type DocumentStatus = Parameters<Api['setDocumentStatus']>[0]
export type FileCommand = Parameters<Parameters<Api['onFileCommand']>[0]>[0]
export type SaveChoice = Awaited<ReturnType<Api['askToSave']>>
