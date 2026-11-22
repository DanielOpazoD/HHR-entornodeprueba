import { useCallback, useRef, useState, type CSSProperties } from 'react';
import type {
  PointerEvent as ReactPointerEvent,
  TouchEvent as ReactTouchEvent,
  WheelEvent as ReactWheelEvent,
} from 'react';

const ZOOM_MIN = 1;
const ZOOM_MAX = 5;
const ZOOM_STEP = 0.5;

export interface PhotoLightboxZoom {
  scale: number;
  isZoomed: boolean;
  style: CSSProperties;
  reset: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  handlers: {
    onWheel: (e: ReactWheelEvent) => void;
    onPointerDown: (e: ReactPointerEvent) => void;
    onPointerMove: (e: ReactPointerEvent) => void;
    onPointerUp: () => void;
    onTouchMove: (e: ReactTouchEvent) => void;
    onTouchEnd: () => void;
  };
}

/**
 * Zoom + pan state for the wound-care photo lightbox.
 *
 * Handles mouse wheel, pinch (two-finger touch), explicit +/− buttons
 * and pointer-based panning once zoomed in. Designed for a single
 * displayed image; call `reset()` when navigating between photos.
 */
export const usePhotoLightboxZoom = (): PhotoLightboxZoom => {
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [isDraggingState, setIsDraggingState] = useState(false);
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const lastTranslate = useRef({ x: 0, y: 0 });
  const lastPinchDist = useRef<number | null>(null);

  const reset = useCallback(() => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
    lastPinchDist.current = null;
  }, []);

  const zoomIn = useCallback(() => {
    setScale(s => Math.min(s + ZOOM_STEP, ZOOM_MAX));
  }, []);

  const zoomOut = useCallback(() => {
    setScale(s => {
      const next = Math.max(s - ZOOM_STEP, ZOOM_MIN);
      if (next <= 1) setTranslate({ x: 0, y: 0 });
      return next;
    });
  }, []);

  const handleWheel = useCallback(
    (e: ReactWheelEvent) => {
      e.preventDefault();
      if (e.deltaY < 0) zoomIn();
      else zoomOut();
    },
    [zoomIn, zoomOut]
  );

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (scale <= 1) return;
      isDragging.current = true;
      setIsDraggingState(true);
      dragStart.current = { x: e.clientX, y: e.clientY };
      lastTranslate.current = { ...translate };
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    },
    [scale, translate]
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent) => {
      if (!isDragging.current || scale <= 1) return;
      setTranslate({
        x: lastTranslate.current.x + (e.clientX - dragStart.current.x),
        y: lastTranslate.current.y + (e.clientY - dragStart.current.y),
      });
    },
    [scale]
  );

  const handlePointerUp = useCallback(() => {
    isDragging.current = false;
    setIsDraggingState(false);
  }, []);

  const handleTouchMove = useCallback((e: ReactTouchEvent) => {
    const firstTouch = e.touches[0];
    const secondTouch = e.touches[1];
    if (e.touches.length !== 2 || !firstTouch || !secondTouch) return;
    e.preventDefault();
    const dist = Math.hypot(
      firstTouch.clientX - secondTouch.clientX,
      firstTouch.clientY - secondTouch.clientY
    );
    if (lastPinchDist.current !== null) {
      const delta = dist - lastPinchDist.current;
      setScale(s => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, s + delta * 0.01)));
    }
    lastPinchDist.current = dist;
  }, []);

  const handleTouchEnd = useCallback(() => {
    lastPinchDist.current = null;
  }, []);

  const isZoomed = scale > 1;

  const style: CSSProperties = {
    transform: `scale(${scale}) translate(${translate.x / scale}px, ${translate.y / scale}px)`,
    transition: isDraggingState ? 'none' : 'transform 200ms ease-out',
    cursor: isZoomed ? 'grab' : 'default',
  };

  return {
    scale,
    isZoomed,
    style,
    reset,
    zoomIn,
    zoomOut,
    handlers: {
      onWheel: handleWheel,
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerUp,
      onTouchMove: handleTouchMove,
      onTouchEnd: handleTouchEnd,
    },
  };
};
