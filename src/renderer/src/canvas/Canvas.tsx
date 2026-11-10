import { useEffect, useMemo, useReducer, useRef, type PointerEvent } from 'react'
import type { Id, Vec2 } from '@core'
import { CSS_PX_PER_MM, cameraReducer, initialCameraState, worldToScreen, worldTransform } from './camera'
import { idleGesture, interpretWheel, pickMarker, stepPointer, type PointerGesture, type PointerInput } from './input'
import type { Scene } from './scene'

const MARKER_RADIUS_PX = { anchor: 4, control: 3 } as const
const ZOOM_STEP = 1.25

interface CanvasProps {
  scene: Scene
  onSelect: (id: Id | null) => void
}

export function Canvas({ scene, onSelect }: CanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [{ camera, viewport }, dispatchCamera] = useReducer(cameraReducer, initialCameraState)
  const gesture = useRef<PointerGesture>(idleGesture)
  // The latest bounds, read by the resize observer without re-subscribing on every edit.
  const bounds = useRef(scene.bounds)
  bounds.current = scene.bounds

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      const { width, height } = entry.contentRect
      dispatchCamera({ type: 'resize', viewport: { width, height }, bounds: bounds.current })
    })
    observer.observe(element)
    // React's onWheel is passive and can't stop Chromium's page zoom on pinch, so listen natively.
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      const rect = element.getBoundingClientRect()
      dispatchCamera(
        interpretWheel({
          deltaX: event.deltaX,
          deltaY: event.deltaY,
          deltaMode: event.deltaMode,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          at: { x: event.clientX - rect.left, y: event.clientY - rect.top }
        })
      )
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      observer.disconnect()
      element.removeEventListener('wheel', onWheel)
    }
  }, [])

  // Turning the nest on may need more room; nothing else about the nest moves the camera.
  const nestOn = scene.legend.length > 0
  useEffect(() => {
    if (nestOn) dispatchCamera({ type: 'reveal', shown: scene.shownBounds, all: scene.bounds })
  }, [nestOn])

  const projected = useMemo(
    () => (camera && viewport ? scene.markers.map((marker) => ({ marker, at: worldToScreen(camera, viewport, marker.at) })) : []),
    [scene.markers, camera, viewport]
  )

  const localPoint = (event: PointerEvent): Vec2 => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  const handlePointer = (event: PointerEvent<SVGSVGElement>, input: PointerInput): void => {
    const step = stepPointer(gesture.current, input)
    gesture.current = step.gesture
    const { output } = step
    if (output.kind === 'pan') dispatchCamera({ type: 'pan', delta: output.delta })
    if (output.kind === 'click') {
      onSelect(pickMarker(projected.map(({ marker, at }) => ({ id: marker.id, role: marker.role, at })), output.at))
    }
    if (input.type === 'down' && step.gesture.mode !== 'idle') event.currentTarget.setPointerCapture(event.pointerId)
  }

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden bg-white">
      {camera && viewport && (
        <svg
          aria-label="Pattern canvas"
          role="group"
          width={viewport.width}
          height={viewport.height}
          className="block touch-none select-none"
          onPointerDown={(e) => handlePointer(e, { type: 'down', pointerId: e.pointerId, at: localPoint(e), button: e.button })}
          onPointerMove={(e) => handlePointer(e, { type: 'move', pointerId: e.pointerId, at: localPoint(e), buttons: e.buttons })}
          onPointerUp={(e) => handlePointer(e, { type: 'up', pointerId: e.pointerId, at: localPoint(e) })}
          onPointerCancel={(e) => handlePointer(e, { type: 'cancel', pointerId: e.pointerId })}
          onLostPointerCapture={(e) => handlePointer(e, { type: 'cancel', pointerId: e.pointerId })}
        >
          <g transform={worldTransform(camera, viewport)}>
            {scene.pieces.map(
              (piece) =>
                piece.cutD && (
                  <path
                    key={piece.id}
                    d={piece.cutD}
                    fill="none"
                    vectorEffect="non-scaling-stroke"
                    strokeWidth={piece.selected ? 2 : 1}
                    className={piece.selected ? 'stroke-amber-600' : 'stroke-neutral-500'}
                    aria-label={`Cut line ${piece.name}`}
                  />
                )
            )}
            {scene.pieces.map((piece) => (
              <path key={piece.id} d={piece.d} className={`stroke-none ${piece.selected ? 'fill-amber-50' : 'fill-sky-50'}`} aria-label={`Piece ${piece.name}`} />
            ))}
            {scene.ghosts.map((ghost) => {
              const transform = `translate(${ghost.offset.x} ${ghost.offset.y})`
              return (
                <g key={ghost.key} pointerEvents="none">
                  <path d={ghost.d} transform={transform} fill="none" stroke={ghost.tint} vectorEffect="non-scaling-stroke" strokeWidth={1} aria-label={`Graded ${ghost.size} ${ghost.pieceName}`} />
                  {ghost.cutD && (
                    <path d={ghost.cutD} transform={transform} fill="none" stroke={ghost.tint} vectorEffect="non-scaling-stroke" strokeWidth={1} strokeDasharray="4 3" aria-label={`Graded cut line ${ghost.size} ${ghost.pieceName}`} />
                  )}
                </g>
              )
            })}
            {scene.pieces.map((piece) => (
              <g key={piece.id}>
                {piece.grainlineD && <path d={piece.grainlineD} fill="none" vectorEffect="non-scaling-stroke" strokeWidth={1} className="stroke-emerald-600" aria-label={`Grainline ${piece.name}`} />}
                {piece.fold && (
                  <line
                    x1={piece.fold[0].x}
                    y1={piece.fold[0].y}
                    x2={piece.fold[1].x}
                    y2={piece.fold[1].y}
                    vectorEffect="non-scaling-stroke"
                    strokeWidth={3}
                    strokeDasharray="10 5"
                    className="stroke-sky-500"
                    aria-label={`Fold ${piece.name}`}
                  />
                )}
                {piece.notchMarks.map(([from, to], index) => (
                  <line key={index} x1={from.x} y1={from.y} x2={to.x} y2={to.y} vectorEffect="non-scaling-stroke" strokeWidth={1.5} className="stroke-neutral-800" aria-label={`Notch mark ${piece.name}`} />
                ))}
              </g>
            ))}
            {scene.handles.map((handle) => (
              <line
                key={handle.key}
                x1={handle.anchor.x}
                y1={handle.anchor.y}
                x2={handle.control.x}
                y2={handle.control.y}
                vectorEffect="non-scaling-stroke"
                strokeWidth={1}
                className={handle.highlighted ? 'stroke-amber-500' : 'stroke-neutral-300'}
              />
            ))}
            {scene.segments.map((segment) => (
              <path
                key={segment.id}
                d={segment.d}
                fill="none"
                vectorEffect="non-scaling-stroke"
                strokeWidth={segment.highlighted ? 2.5 : 1.5}
                strokeDasharray={segment.inPiece ? undefined : '6 4'}
                className={segment.highlighted ? 'stroke-amber-600' : 'stroke-neutral-800'}
              />
            ))}
          </g>
          {/* Screen-space layer: constant-size markers and labels at projected positions. */}
          <g>
            {projected.map(({ marker, at }) => (
              <g
                key={marker.id}
                role="button"
                aria-label={`Point ${marker.name}`}
                aria-pressed={marker.selected}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSelect(marker.id)
                  }
                }}
                className="cursor-pointer outline-none"
              >
                <circle
                  cx={at.x}
                  cy={at.y}
                  r={MARKER_RADIUS_PX[marker.role] + (marker.selected ? 2 : 0)}
                  className={
                    marker.selected
                      ? 'fill-amber-500 stroke-amber-700'
                      : marker.role === 'anchor'
                        ? 'fill-neutral-800 stroke-white'
                        : 'fill-white stroke-neutral-500'
                  }
                  strokeWidth={1.5}
                />
                {marker.role === 'anchor' && (
                  <text x={at.x + 7} y={at.y - 7} className="fill-neutral-600 text-[11px]">
                    {marker.name}
                  </text>
                )}
              </g>
            ))}
          </g>
        </svg>
      )}
      {nestOn && (
        <ul aria-label="Size legend" className="absolute top-3 right-3 max-w-56 space-y-0.5 rounded-md border border-neutral-200 bg-white/90 p-2 text-xs shadow-sm">
          {scene.legend.map((entry) => (
            <li key={entry.size} className="flex items-start gap-1.5">
              <span aria-hidden="true" className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: entry.shown ? '#262626' : entry.tint }} />
              <span>
                <span className={entry.shown ? 'font-semibold' : ''}>{entry.size}</span>
                {entry.gaps.length > 0 && <span className="text-yellow-700"> {entry.gaps.join(', ')}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="absolute top-3 left-3 flex items-center gap-1 rounded-md border border-neutral-200 bg-white/90 p-1 text-sm shadow-sm">
        <button
          type="button"
          aria-label="Zoom out"
          className="rounded px-2 py-0.5 hover:bg-neutral-100"
          onClick={() => dispatchCamera({ type: 'zoom', factor: 1 / ZOOM_STEP })}
        >
          −
        </button>
        <span role="status" aria-label="Zoom level" className="w-14 text-center tabular-nums text-neutral-600">
          {camera ? `${Math.round((camera.scale / CSS_PX_PER_MM) * 100)}%` : '…'}
        </span>
        <button
          type="button"
          aria-label="Zoom in"
          className="rounded px-2 py-0.5 hover:bg-neutral-100"
          onClick={() => dispatchCamera({ type: 'zoom', factor: ZOOM_STEP })}
        >
          +
        </button>
        <button
          type="button"
          className="rounded px-2 py-0.5 hover:bg-neutral-100"
          onClick={() => dispatchCamera({ type: 'fit', bounds: scene.bounds })}
        >
          Fit
        </button>
      </div>
    </div>
  )
}
