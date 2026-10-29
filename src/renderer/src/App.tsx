import { useEffect, useState } from 'react'

export function App() {
  const [version, setVersion] = useState<string>()

  useEffect(() => {
    void window.api.getVersion().then(setVersion)
  }, [])

  return (
    <main className="flex h-screen items-center justify-center bg-neutral-50 text-neutral-800">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">Parametric Pattern Maker</h1>
        <p className="mt-2 text-sm text-neutral-500">v{version ?? '…'}</p>
      </div>
    </main>
  )
}
