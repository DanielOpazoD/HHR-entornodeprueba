import React, { useId } from 'react';
import { ChevronLeft } from 'lucide-react';
import type { ScoreReference } from '../../domain/scoreEngine';

interface ToolFrameProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  onBack: () => void;
  reference?: ScoreReference | null;
  testId?: string;
  children: React.ReactNode;
}

export const ToolFrame: React.FC<ToolFrameProps> = ({
  title,
  description,
  icon,
  onBack,
  reference,
  testId,
  children,
}) => {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} data-testid={testId} className="flex min-h-full flex-col">
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={onBack}
          aria-label="Volver a la biblioteca"
          title="Volver a la biblioteca"
          className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-white hover:text-teal-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600"
        >
          <ChevronLeft size={16} aria-hidden="true" />
        </button>
        <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-teal-50 text-teal-700">
          {icon}
        </span>
        <div className="min-w-0">
          <h3 id={headingId} className="text-[14px] font-bold leading-tight text-slate-800">
            {title}
          </h3>
          <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{description}</p>
        </div>
      </div>
      <div className="mt-3 flex-1">{children}</div>
      <footer className="mt-4 border-t border-slate-200 pt-3 text-[10px] leading-relaxed text-slate-500">
        <p>
          Apoyo a la decisión clínica: no reemplaza el juicio clínico, el protocolo local ni la
          validación de farmacia.
        </p>
        {reference && (
          <p className="mt-1">
            Referencia: {reference.citation}
            {reference.url && (
              <>
                {' '}
                <a
                  href={reference.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-teal-700 underline-offset-2 hover:underline"
                >
                  Ver fuente
                </a>
              </>
            )}
          </p>
        )}
      </footer>
    </section>
  );
};
