import React, { useCallback, useEffect, useRef } from 'react';
import { ArrowLeft } from 'lucide-react';
import { closeClinicalExplorer, restoreClinicalExplorerFocus } from './clinicalExplorerStore';

interface ClinicalExplorerBarProps {
  bedId: string;
}

/**
 * The way back to the census. It lives in the census chunk, above the online-only explorer, so
 * «Volver al censo» and Escape work while the explorer loads, if it never loads, and once it is
 * open. Dialogs opened from the explorer own the keyboard while they are open.
 */
export const ClinicalExplorerBar: React.FC<ClinicalExplorerBarProps> = ({ bedId }) => {
  const backRef = useRef<HTMLButtonElement>(null);

  const close = useCallback((): void => {
    const opener = closeClinicalExplorer();
    // Once the census is visible again, the focus goes back to where the explorer was opened.
    window.setTimeout(() => restoreClinicalExplorerFocus(bedId, opener), 0);
  }, [bedId]);

  useEffect(() => {
    backRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !document.querySelector('[role="dialog"]')) close();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [close]);

  return (
    <div className="sticky top-[var(--hhr-chrome-height)] z-30 self-start lg:col-start-1 lg:row-start-1">
      <button
        ref={backRef}
        type="button"
        onClick={close}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-slate-600 hover:bg-white hover:text-teal-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
      >
        <ArrowLeft size={14} aria-hidden="true" />
        Volver al censo
      </button>
    </div>
  );
};
