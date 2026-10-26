import React, { useId } from 'react';
import { MessageCircle } from 'lucide-react';
import { DebouncedTextarea } from '@/components/ui/DebouncedTextarea';
import clsx from 'clsx';

interface HandoffNovedadesProps {
  value: string;
  onChange: (val: string) => void;
  readOnly?: boolean;
}

/**
 * Sanitizes text for print output by removing invisible characters,
 * replacement characters, box symbols, and trimming trailing whitespace.
 */
const sanitizeForPrint = (text: string): string => {
  if (!text) return '';
  return (
    text
      // Remove zero-width characters
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      // Remove replacement character (often renders as ■)
      .replace(/\uFFFD/g, '')
      // Remove black square and similar box/bullet characters
      .replace(/[\u25A0-\u25FF]/g, '') // Geometric shapes block (■ ● ○ etc)
      .replace(/[\u2022\u2023\u2043\u204C\u204D]/g, '') // Various bullet characters
      // Remove other common invisible control characters
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      // Normalize line endings
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      // Trim trailing whitespace from each line and the whole text
      .split('\n')
      .map(line => line.trimEnd())
      .join('\n')
      .trimEnd()
  );
};

export const HandoffNovedades: React.FC<HandoffNovedadesProps> = ({
  value,
  onChange,
  readOnly = false,
}) => {
  const headingId = useId();

  return (
    <div className="min-w-0 max-w-full bg-white border border-slate-200/80 rounded-2xl shadow-sm p-4 mt-4 print:rounded-lg print:shadow-none print:border-none print:p-0 print:mt-2 print:bg-transparent">
      <h3
        id={headingId}
        className="font-semibold text-sm text-slate-700 mb-3 flex items-center gap-2 print:font-bold print:text-sm print:mb-1 print:text-black"
      >
        <MessageCircle
          size={16}
          className="shrink-0 text-teal-600 print:w-4 print:h-4 print:text-amber-500"
          aria-hidden="true"
        />
        Novedades
      </h3>

      {/* Screen: Textarea */}
      <div className="print:hidden">
        <DebouncedTextarea
          value={value || ''}
          onChangeValue={onChange}
          disabled={readOnly}
          placeholder={
            readOnly ? 'Sin novedades registradas.' : 'Escriba las novedades del turno aquí...'
          }
          className={clsx(
            'min-w-0 max-w-full w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none text-sm text-slate-700 min-h-[100px]',
            readOnly && 'bg-slate-50 cursor-not-allowed text-slate-500'
          )}
          debounceMs={1500}
          aria-labelledby={headingId}
        />
      </div>

      {/* Print: Sanitized Full Content Div */}
      <div className="hidden print:block whitespace-pre-wrap break-words text-slate-800 text-sm print:text-[9px] print:leading-snug print:list-none">
        {sanitizeForPrint(value) || (
          <span className="italic text-slate-400">Sin novedades registradas.</span>
        )}
      </div>
    </div>
  );
};
