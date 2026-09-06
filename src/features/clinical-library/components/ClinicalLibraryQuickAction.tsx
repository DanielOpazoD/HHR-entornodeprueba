import React, { Suspense, useCallback, useRef, useState } from 'react';
import clsx from 'clsx';
import { FolderOpen } from 'lucide-react';
import { lazyWithRetry } from '@/utils/lazyWithRetry';
import { DATE_STRIP_QUICK_ACTION_BASE_CLASS } from '@/shared/ui/dateStripQuickActionStyles';

const ClinicalLibraryDrawer = lazyWithRetry(() =>
  import('./ClinicalLibraryDrawer').then(module => ({ default: module.ClinicalLibraryDrawer }))
);

export const CLINICAL_LIBRARY_QUICK_ACTION_TITLE = 'Documentos y herramientas clínicas';

/**
 * `toolbar`: botón visible al extremo derecho de la barra de fechas del censo.
 * `quick-action`: misma geometría que Camas / MMRAD / Laboratorio (menú «⋯» o barra inline).
 */
export type ClinicalLibraryQuickActionVariant = 'toolbar' | 'quick-action';

export const CLINICAL_LIBRARY_TOOLBAR_BUTTON_CLASS =
  'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-600 transition-colors hover:border-teal-300 hover:bg-teal-50 hover:text-teal-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600';

interface ClinicalLibraryQuickActionProps {
  variant?: ClinicalLibraryQuickActionVariant;
}

/** Botón «Documentos»: abre el panel lateral de la biblioteca clínica y devuelve el foco al cerrar. */
export const ClinicalLibraryQuickAction: React.FC<ClinicalLibraryQuickActionProps> = ({
  variant = 'quick-action',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setIsOpen(false);
    buttonRef.current?.focus();
  }, []);

  const isToolbar = variant === 'toolbar';

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        data-testid="clinical-library-quick-action"
        data-census-menu-action={isToolbar ? undefined : true}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={() => setIsOpen(true)}
        className={
          isToolbar
            ? CLINICAL_LIBRARY_TOOLBAR_BUTTON_CLASS
            : clsx(
                DATE_STRIP_QUICK_ACTION_BASE_CLASS,
                'border-slate-200 bg-slate-50 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-700'
              )
        }
        title={CLINICAL_LIBRARY_QUICK_ACTION_TITLE}
      >
        <FolderOpen size={isToolbar ? 15 : 13} aria-hidden="true" />
        <span className={isToolbar ? 'hidden md:inline' : 'hidden sm:inline'}>Documentos</span>
      </button>
      {isOpen && (
        <Suspense
          fallback={
            <span role="status" className="text-xs text-slate-600">
              Abriendo documentos…
            </span>
          }
        >
          <ClinicalLibraryDrawer onClose={close} />
        </Suspense>
      )}
    </>
  );
};
