import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Maximize2,
  Minimize2,
  RotateCw,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

interface PrescriptionImageLightboxProps {
  imageUrl: string | null;
  altText?: string;
  counterLabel?: string;
  onClose: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  canGoPrevious?: boolean;
  canGoNext?: boolean;
  onDelete?: () => Promise<void> | void;
  deletePending?: boolean;
}

const MIN_SCALE = 1;
const MAX_SCALE = 5;
const SCALE_STEP = 0.5;

export const PrescriptionImageLightbox: React.FC<PrescriptionImageLightboxProps> = ({
  imageUrl,
  altText = 'Receta',
  counterLabel,
  onClose,
  onPrevious,
  onNext,
  canGoPrevious = false,
  canGoNext = false,
  onDelete,
  deletePending = false,
}) => {
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panOriginRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft' && canGoPrevious) onPrevious?.();
      if (event.key === 'ArrowRight' && canGoNext) onNext?.();
      if (event.key === '+' || event.key === '=')
        setScale(s => Math.min(MAX_SCALE, s + SCALE_STEP));
      if (event.key === '-') setScale(s => Math.max(MIN_SCALE, s - SCALE_STEP));
      if (event.key === '0') {
        setScale(1);
        setTranslate({ x: 0, y: 0 });
      }
      if (event.key.toLowerCase() === 'r') setRotation(r => (r + 90) % 360);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canGoNext, canGoPrevious, onClose, onNext, onPrevious]);

  const reset = useCallback(() => {
    setScale(1);
    setRotation(0);
    setTranslate({ x: 0, y: 0 });
  }, []);

  const zoomIn = useCallback(() => setScale(s => Math.min(MAX_SCALE, s + SCALE_STEP)), []);
  const zoomOut = useCallback(() => {
    setScale(s => {
      const next = Math.max(MIN_SCALE, s - SCALE_STEP);
      if (next === 1) setTranslate({ x: 0, y: 0 });
      return next;
    });
  }, []);

  const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const delta = event.deltaY < 0 ? SCALE_STEP : -SCALE_STEP;
    setScale(s => {
      const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, s + delta));
      if (next === 1) setTranslate({ x: 0, y: 0 });
      return next;
    });
  }, []);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLImageElement>) => {
      if (scale <= 1) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      setIsPanning(true);
      panOriginRef.current = {
        x: event.clientX,
        y: event.clientY,
        tx: translate.x,
        ty: translate.y,
      };
    },
    [scale, translate.x, translate.y]
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLImageElement>) => {
      if (!isPanning || !panOriginRef.current) return;
      const { x, y, tx, ty } = panOriginRef.current;
      setTranslate({
        x: tx + (event.clientX - x),
        y: ty + (event.clientY - y),
      });
    },
    [isPanning]
  );

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLImageElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setIsPanning(false);
    panOriginRef.current = null;
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Vista ampliada de la receta"
      className="fixed inset-0 z-[200] flex flex-col bg-black/90 backdrop-blur-sm"
      onWheel={handleWheel}
    >
      <header className="flex items-center justify-between gap-2 border-b border-white/10 bg-black/40 px-3 py-2 text-white">
        <p className="text-xs font-semibold uppercase tracking-wider opacity-80">
          {Math.round(scale * 100)}%
        </p>
        <div className="flex items-center gap-1">
          {counterLabel && <span className="px-2 text-xs text-white/70">{counterLabel}</span>}
          <button
            type="button"
            onClick={zoomOut}
            disabled={scale <= MIN_SCALE}
            className="inline-flex items-center gap-1 rounded-md border border-white/20 px-2 py-1 text-xs hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Reducir zoom"
          >
            <ZoomOut size={14} />
          </button>
          <button
            type="button"
            onClick={zoomIn}
            disabled={scale >= MAX_SCALE}
            className="inline-flex items-center gap-1 rounded-md border border-white/20 px-2 py-1 text-xs hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Aumentar zoom"
          >
            <ZoomIn size={14} />
          </button>
          <button
            type="button"
            onClick={() => setRotation(r => (r + 90) % 360)}
            className="inline-flex items-center gap-1 rounded-md border border-white/20 px-2 py-1 text-xs hover:bg-white/10"
            aria-label="Rotar 90°"
          >
            <RotateCw size={14} />
          </button>
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-1 rounded-md border border-white/20 px-2 py-1 text-xs hover:bg-white/10"
            aria-label="Restablecer"
          >
            {scale === 1 ? <Maximize2 size={14} /> : <Minimize2 size={14} />}
          </button>
          {onDelete && (
            <button
              type="button"
              onClick={() => void onDelete()}
              disabled={deletePending}
              className="inline-flex items-center gap-1 rounded-md border border-red-300/40 bg-red-500/20 px-2 py-1 text-xs text-red-100 hover:bg-red-500/30 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Eliminar receta"
            >
              {deletePending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Trash2 size={14} />
              )}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="ml-1 inline-flex items-center gap-1 rounded-md border border-white/20 bg-white/10 px-2 py-1 text-xs hover:bg-white/20"
            aria-label="Cerrar"
          >
            <X size={14} />
          </button>
        </div>
      </header>

      <div
        className="relative flex flex-1 select-none items-center justify-center overflow-hidden"
        onClick={event => {
          if (event.target === event.currentTarget && scale === 1) onClose();
        }}
      >
        {onPrevious && (
          <button
            type="button"
            onClick={event => {
              event.stopPropagation();
              onPrevious();
            }}
            disabled={!canGoPrevious}
            aria-label="Receta anterior"
            className="absolute left-3 top-1/2 z-10 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/40 text-white shadow-lg hover:bg-black/60 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ChevronLeft size={22} />
          </button>
        )}
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={altText}
            draggable={false}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onDoubleClick={() => {
              if (scale > 1) {
                reset();
              } else {
                setScale(2);
              }
            }}
            style={{
              transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale}) rotate(${rotation}deg)`,
              transition: isPanning ? 'none' : 'transform 120ms ease-out',
              cursor: scale > 1 ? (isPanning ? 'grabbing' : 'grab') : 'zoom-in',
              maxWidth: '100%',
              maxHeight: '100%',
            }}
            className="block object-contain"
          />
        ) : (
          <div
            role="status"
            aria-label="Cargando receta"
            className="inline-flex items-center gap-2 rounded-md border border-white/15 bg-black/40 px-3 py-2 text-sm text-white/80"
          >
            <Loader2 size={16} className="animate-spin" />
            Cargando receta
          </div>
        )}
        {onNext && (
          <button
            type="button"
            onClick={event => {
              event.stopPropagation();
              onNext();
            }}
            disabled={!canGoNext}
            aria-label="Receta siguiente"
            className="absolute right-3 top-1/2 z-10 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/40 text-white shadow-lg hover:bg-black/60 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ChevronRight size={22} />
          </button>
        )}
      </div>

      <footer className="border-t border-white/10 bg-black/40 px-3 py-1.5 text-center text-[11px] text-white/70">
        Doble click para zoom · Rueda para acercar · Arrastra cuando esté ampliada · ESC para cerrar
      </footer>
    </div>
  );
};
