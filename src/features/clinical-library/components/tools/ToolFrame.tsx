import React, { useId } from 'react';
import { ChevronLeft, X } from 'lucide-react';
import { buttonClassName } from '@/components/ui/base/buttonStyles';
import {
  PANEL_HEADER_CLASS,
  PANEL_TITLE_CLASS,
  PANEL_ICON_CLASS,
} from '@/components/ui/base/panelStyles';
import type { LibraryPatientOption } from '../../domain/libraryCatalogTypes';
import type { ScoreReference } from '../../domain/scoreEngine';

/** Props que recibe cada herramienta desde el panel: volver a la lista y cerrar el panel. */
export interface ToolComponentProps {
  onBack: () => void;
  onClose: () => void;
  /** Pacientes del censo del día, para prellenar documentos. */
  patients: ReadonlyArray<LibraryPatientOption>;
  /** Notify the drawer before a tool with unsaved document data is dismissed. */
  onDirtyChange?: (dirty: boolean) => void;
}

interface ToolFrameProps {
  title: string;
  icon: React.ReactNode;
  onBack: () => void;
  onClose: () => void;
  reference?: ScoreReference | null;
  /** Acción principal de la herramienta (p. ej. imprimir), a la izquierda del botón cerrar. */
  action?: React.ReactNode;
  testId?: string;
  children: React.ReactNode;
}

const ICON_BUTTON_CLASS = buttonClassName('ghost', 'icon', 'shrink-0');

/** Cabecera única de una herramienta: volver, título y cerrar; la referencia va al pie. */
export const ToolFrame: React.FC<ToolFrameProps> = ({
  title,
  icon,
  onBack,
  onClose,
  reference,
  action,
  testId,
  children,
}) => {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} data-testid={testId} className="flex min-h-full flex-col">
      <header className={PANEL_HEADER_CLASS}>
        <button
          type="button"
          onClick={onBack}
          aria-label="Volver a la biblioteca"
          title="Volver a la biblioteca"
          className={ICON_BUTTON_CLASS}
        >
          <ChevronLeft size={16} aria-hidden="true" />
        </button>
        <span aria-hidden="true" className={`${PANEL_ICON_CLASS} text-medical-700`}>
          {icon}
        </span>
        <h3 id={headingId} className={PANEL_TITLE_CLASS}>
          {title}
        </h3>
        {action}
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar documentos"
          title="Cerrar"
          className={ICON_BUTTON_CLASS}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </header>
      <div className="min-w-0 flex-1 py-4">{children}</div>
      {reference && (
        <footer className="mt-4 border-t border-slate-200 pt-2 text-xs leading-relaxed text-slate-600">
          {reference.citation}
          {reference.url && (
            <>
              {' '}
              <a
                href={reference.url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-medical-700 underline-offset-2 hover:underline"
              >
                Ver fuente
              </a>
            </>
          )}
        </footer>
      )}
    </section>
  );
};
