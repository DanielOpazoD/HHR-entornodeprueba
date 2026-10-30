import React from 'react';
import { DebouncedTextarea } from '@/components/ui/DebouncedTextarea';

interface HandoffObservationsCellProps {
  noteValue: string;
  onNoteChange: (val: string) => void;
  isFieldReadOnly: boolean;
}

export const HandoffObservationsCell: React.FC<HandoffObservationsCellProps> = ({
  noteValue,
  onNoteChange,
  isFieldReadOnly,
}) => (
  <td className="handoff-observations p-2 w-full min-w-[300px] align-top print:w-auto print:min-w-0 print:text-[8px] print:p-0.5">
    {isFieldReadOnly ? (
      <div className="whitespace-pre-wrap break-words text-sm text-slate-800 p-2 min-h-[50px] print:min-h-0 print:p-0 print:text-[8px] print:leading-tight">
        {noteValue || <span className="text-slate-400 italic">Sin observaciones</span>}
      </div>
    ) : (
      <>
        <div className="print:hidden">
          <DebouncedTextarea
            aria-label="Observaciones del paciente"
            value={noteValue}
            onChangeValue={onNoteChange}
            className="w-full p-2 text-sm border border-slate-300 rounded focus:ring-2 focus:ring-medical-500 focus:outline-none bg-white"
            minRows={2}
            debounceMs={1500}
          />
        </div>
        <div className="hidden print:block w-full whitespace-pre-wrap break-words text-slate-800 print:text-[8px] print:leading-tight">
          {noteValue}
        </div>
      </>
    )}
  </td>
);
