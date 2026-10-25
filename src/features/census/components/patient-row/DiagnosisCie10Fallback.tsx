import React, { useEffect, useRef } from 'react';
import { reloadAfterChunkLoadFailure } from '@/utils/lazyWithRetry';
import type DiagnosisCie10Cell from './DiagnosisCie10Cell';

type Cie10Cell = typeof DiagnosisCie10Cell;

export function DiagnosisCie10Fallback({
  children,
  onRecovered,
}: {
  children: React.ReactElement<React.ComponentPropsWithRef<'td'>>;
  onRecovered: (cell: Cie10Cell) => void;
}) {
  const cellRef = useRef<HTMLTableCellElement>(null);
  const recovered = useRef<Cie10Cell | null>(null);
  const retryRef = useRef<() => void>(() => {});

  useEffect(() => {
    let active = true;
    let loading = false;
    const retry = async () => {
      if (loading || !navigator.onLine) return;
      loading = true;
      try {
        const module = await import('./DiagnosisCie10Cell');
        if (!active) return;
        recovered.current = module.default;
        // Blurring flushes DebouncedInput before the editor can be replaced.
        if (!cellRef.current?.contains(document.activeElement)) onRecovered(module.default);
      } catch {
        // Browsers may retain a failed import until an explicit page reload.
      } finally {
        loading = false;
      }
    };
    retryRef.current = () => void retry();
    window.addEventListener('online', retry);
    return () => {
      active = false;
      window.removeEventListener('online', retry);
    };
  }, [onRecovered]);

  return React.cloneElement(
    children,
    {
      ref: cellRef,
      onBlur: event => {
        children.props.onBlur?.(event);
        if (recovered.current && !event.currentTarget.contains(event.relatedTarget)) {
          onRecovered(recovered.current);
        }
      },
    },
    children.props.children,
    <div className="text-[11px] text-amber-800">
      <p role="status">Buscador CIE-10 no disponible. Puedes editar en texto libre.</p>
      <button type="button" className="underline mr-2" onClick={() => retryRef.current()}>
        Reintentar buscador CIE-10
      </button>
      <button type="button" className="underline" onClick={reloadAfterChunkLoadFailure}>
        Recargar aplicación
      </button>
    </div>
  );
}
