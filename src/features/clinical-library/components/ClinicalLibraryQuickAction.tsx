import React, { Suspense, useCallback, useRef, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { lazyWithRetry } from '@/utils/lazyWithRetry';
import { DATE_STRIP_TRAILING_ACTION_BASE_CLASS } from '@/shared/ui/dateStripQuickActionStyles';

const ClinicalLibraryDrawer = lazyWithRetry(() =>
  import('./ClinicalLibraryDrawer').then(module => ({ default: module.ClinicalLibraryDrawer }))
);

export const CLINICAL_LIBRARY_QUICK_ACTION_TITLE = 'Documentos y herramientas clínicas';

/** Botón «Documentos» de la barra de fechas del censo; abre el panel y recupera el foco al cerrar. */
export const ClinicalLibraryQuickAction: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setIsOpen(false);
    buttonRef.current?.focus();
  }, []);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        data-testid="clinical-library-quick-action"
        aria-label="Documentos"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={() => setIsOpen(true)}
        className={`${DATE_STRIP_TRAILING_ACTION_BASE_CLASS} text-slate-600 transition-colors hover:border-medical-300 hover:bg-medical-50 hover:text-medical-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-medical-600`}
        title={CLINICAL_LIBRARY_QUICK_ACTION_TITLE}
      >
        <FolderOpen size={15} aria-hidden="true" />
        <span className="hidden md:inline">Documentos</span>
      </button>
      {isOpen && (
        <Suspense fallback={null}>
          <ClinicalLibraryDrawer onClose={close} />
        </Suspense>
      )}
    </>
  );
};
