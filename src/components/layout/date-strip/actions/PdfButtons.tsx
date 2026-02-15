import React from 'react';
import { Printer } from 'lucide-react';
import type { ActionButtonsProps } from './types';

export const PdfButtons: React.FC<Pick<ActionButtonsProps, 'onExportPDF'>> = ({ onExportPDF }) => {
  if (!onExportPDF) {
    return null;
  }

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={onExportPDF}
        className="btn btn-secondary bg-teal-700 text-white hover:bg-teal-800 border-none !px-3 !py-1.5 text-[10px]"
        title="Descargar PDF (rápido)"
      >
        <Printer size={14} />
        PDF
      </button>
    </div>
  );
};
