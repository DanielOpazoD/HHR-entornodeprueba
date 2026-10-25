import React, { useEffect, useRef } from 'react';
import { reloadAfterChunkLoadFailure } from '@/utils/lazyWithRetry';
import type DiagnosisCie10Cell from './DiagnosisCie10Cell';

type Cie10Cell = typeof DiagnosisCie10Cell;

export function DiagnosisCie10Fallback({
  children,
  onRecovered,
  readOnly,
}: {
  children: React.ReactElement<React.ComponentPropsWithRef<'td'>>;
  onRecovered: (cell: Cie10Cell) => void;
  readOnly: boolean;
}) {
  const cellRef = useRef<HTMLTableCellElement>(null);
  const focused = useRef(false);
  const recovered = useRef<Cie10Cell | null>(null);

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
        if (!focused.current) onRecovered(module.default);
      } catch {
        // Browsers may retain a failed import until an explicit page reload.
      } finally {
        loading = false;
      }
    };
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
      // React focus events include the free-text editor's portalled popovers.
      onFocusCapture: event => {
        focused.current = true;
        children.props.onFocusCapture?.(event);
      },
      onBlur: event => {
        children.props.onBlur?.(event);
        focused.current = false;
        setTimeout(() => {
          if (cellRef.current && !focused.current && recovered.current) {
            onRecovered(recovered.current);
          }
        }, 0);
      },
    },
    children.props.children,
    <div className="text-[11px] text-amber-800">
      <p role="status">
        Buscador CIE-10 no disponible.{!readOnly && ' Puedes editar en texto libre.'}
      </p>
      <button type="button" className="underline" onClick={reloadAfterChunkLoadFailure}>
        Recargar aplicación
      </button>
    </div>
  );
}
