import React, { useId } from 'react';
import { ChevronLeft, X } from 'lucide-react';
import type { ScoreReference } from '../../domain/scoreEngine';

/** Props que recibe cada herramienta desde el panel: volver a la lista y cerrar el panel. */
export interface ToolComponentProps {
  onBack: () => void;
  onClose: () => void;
}

interface ToolFrameProps {
  title: string;
  icon: React.ReactNode;
  onBack: () => void;
  onClose: () => void;
  reference?: ScoreReference | null;
  testId?: string;
  children: React.ReactNode;
}

const ICON_BUTTON_CLASS =
  'inline-flex size-8 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-white hover:text-medical-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-medical-600';

/** Cabecera única de una herramienta: volver, título y cerrar; la referencia va al pie. */
export const ToolFrame: React.FC<ToolFrameProps> = ({
  title,
  icon,
  onBack,
  onClose,
  reference,
  testId,
  children,
}) => {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} data-testid={testId} className="flex min-h-full flex-col">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          aria-label="Volver a la biblioteca"
          title="Volver a la biblioteca"
          className={ICON_BUTTON_CLASS}
        >
          <ChevronLeft size={16} aria-hidden="true" />
        </button>
        <span className="text-medical-700">{icon}</span>
        <h3 id={headingId} className="min-w-0 flex-1 truncate text-[14px] font-bold text-slate-800">
          {title}
        </h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar documentos"
          title="Cerrar"
          className={ICON_BUTTON_CLASS}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="mt-3 flex-1">{children}</div>
      {reference && (
        <footer className="mt-4 border-t border-slate-200 pt-2 text-[10px] leading-relaxed text-slate-500">
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
