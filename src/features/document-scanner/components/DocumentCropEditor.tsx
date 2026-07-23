import React from 'react';
import { Check, Crop, Loader2, X } from 'lucide-react';
import type {
  DocumentScanCorners,
  DocumentScanPoint,
} from '../services/jscanifyDocumentScannerService';

type CornerKey = keyof DocumentScanCorners;

const CORNER_LABELS: Record<CornerKey, string> = {
  topLeftCorner: 'Esquina superior izquierda',
  topRightCorner: 'Esquina superior derecha',
  bottomLeftCorner: 'Esquina inferior izquierda',
  bottomRightCorner: 'Esquina inferior derecha',
};

const CORNER_LIMITS: Record<CornerKey, { minX: number; maxX: number; minY: number; maxY: number }> =
  {
    topLeftCorner: { minX: 0, maxX: 0.49, minY: 0, maxY: 0.49 },
    topRightCorner: { minX: 0.51, maxX: 1, minY: 0, maxY: 0.49 },
    bottomLeftCorner: { minX: 0, maxX: 0.49, minY: 0.51, maxY: 1 },
    bottomRightCorner: { minX: 0.51, maxX: 1, minY: 0.51, maxY: 1 },
  };

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

const polygonPoints = (corners: DocumentScanCorners): string =>
  [
    corners.topLeftCorner,
    corners.topRightCorner,
    corners.bottomRightCorner,
    corners.bottomLeftCorner,
  ]
    .map(point => `${point.x * 100},${point.y * 100}`)
    .join(' ');

export interface DocumentCropEditorProps {
  sourceObjectUrl: string;
  initialCorners: DocumentScanCorners;
  busy: boolean;
  onCancel: () => void;
  onApply: (corners: DocumentScanCorners) => Promise<void>;
}

export const DocumentCropEditor: React.FC<DocumentCropEditorProps> = ({
  sourceObjectUrl,
  initialCorners,
  busy,
  onCancel,
  onApply,
}) => {
  const [corners, setCorners] = React.useState(initialCorners);
  const frameRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => setCorners(initialCorners), [initialCorners]);

  const moveCorner = React.useCallback((key: CornerKey, clientX: number, clientY: number) => {
    const frame = frameRef.current;
    if (!frame) return;
    const bounds = frame.getBoundingClientRect();
    const limits = CORNER_LIMITS[key];
    const point: DocumentScanPoint = {
      x: clamp((clientX - bounds.left) / bounds.width, limits.minX, limits.maxX),
      y: clamp((clientY - bounds.top) / bounds.height, limits.minY, limits.maxY),
    };
    setCorners(current => ({ ...current, [key]: point }));
  }, []);

  const moveNearestCorner = React.useCallback(
    (clientX: number, clientY: number) => {
      const frame = frameRef.current;
      if (!frame) return;
      const bounds = frame.getBoundingClientRect();
      const target = {
        x: (clientX - bounds.left) / bounds.width,
        y: (clientY - bounds.top) / bounds.height,
      };
      const nearest = (Object.keys(CORNER_LABELS) as CornerKey[]).reduce(
        (best, key) => {
          const point = corners[key];
          const distance = (point.x - target.x) ** 2 + (point.y - target.y) ** 2;
          return distance < best.distance ? { key, distance } : best;
        },
        { key: 'topLeftCorner' as CornerKey, distance: Number.POSITIVE_INFINITY }
      );
      moveCorner(nearest.key, clientX, clientY);
    },
    [corners, moveCorner]
  );

  return (
    <section className="space-y-4" aria-label="Editor manual de bordes">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900">
          <Crop size={20} className="text-teal-700" /> Ajustar bordes
        </h2>
        <p className="mt-1 text-sm leading-5 text-slate-600">
          Arrastra cada punto o toca cerca de una esquina real del papel.
        </p>
      </div>

      <div
        ref={frameRef}
        data-testid="crop-editor-frame"
        className="relative overflow-hidden rounded-xl bg-slate-900 shadow-inner"
        style={{ touchAction: 'none' }}
        onPointerDown={event => {
          if (busy || (event.target as HTMLElement).closest('[data-crop-corner]')) return;
          moveNearestCorner(event.clientX, event.clientY);
        }}
      >
        <img
          src={sourceObjectUrl}
          alt="Fotografía original para ajustar el recorte"
          className="block h-auto w-full select-none"
          draggable={false}
        />
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          <polygon
            points={polygonPoints(corners)}
            fill="rgba(13, 148, 136, 0.12)"
            stroke="white"
            strokeWidth="0.8"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {(Object.keys(CORNER_LABELS) as CornerKey[]).map(key => {
          const point = corners[key];
          return (
            <button
              key={key}
              type="button"
              aria-label={CORNER_LABELS[key]}
              data-crop-corner={key}
              disabled={busy}
              onPointerDown={event => {
                event.currentTarget.setPointerCapture(event.pointerId);
                moveCorner(key, event.clientX, event.clientY);
              }}
              onPointerMove={event => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  moveCorner(key, event.clientX, event.clientY);
                }
              }}
              onKeyDown={event => {
                const step = event.shiftKey ? 0.02 : 0.005;
                const deltas: Partial<Record<React.KeyboardEvent['key'], [number, number]>> = {
                  ArrowLeft: [-step, 0],
                  ArrowRight: [step, 0],
                  ArrowUp: [0, -step],
                  ArrowDown: [0, step],
                };
                const delta = deltas[event.key];
                if (!delta) return;
                event.preventDefault();
                const limits = CORNER_LIMITS[key];
                setCorners(current => ({
                  ...current,
                  [key]: {
                    x: clamp(current[key].x + delta[0], limits.minX, limits.maxX),
                    y: clamp(current[key].y + delta[1], limits.minY, limits.maxY),
                  },
                }));
              }}
              className="absolute z-10 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 touch-none items-center justify-center rounded-full border-2 border-white bg-teal-600 shadow-lg disabled:opacity-60"
              style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
            >
              <span className="h-2.5 w-2.5 rounded-full bg-white" />
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold text-slate-700 disabled:opacity-60"
        >
          <X size={18} /> Cancelar
        </button>
        <button
          type="button"
          onClick={() => void onApply(corners)}
          disabled={busy}
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-teal-600 px-3 text-sm font-bold text-white disabled:bg-teal-300"
        >
          {busy ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
          {busy ? 'Aplicando…' : 'Aplicar recorte'}
        </button>
      </div>
    </section>
  );
};
