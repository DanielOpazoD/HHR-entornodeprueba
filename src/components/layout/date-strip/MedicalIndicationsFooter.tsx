import React from 'react';
import { Printer, Save, UserRound } from 'lucide-react';

interface MedicalIndicationsFooterProps {
  treatingDoctor: string;
  setTreatingDoctor: (value: string) => void;
  isSavingRecord: boolean;
  isPrinting: boolean;
  canSave: boolean;
  canPrint: boolean;
  onClose: () => void;
  onSave: () => void;
  onPrint: () => void;
}

export const MedicalIndicationsFooter: React.FC<MedicalIndicationsFooterProps> = ({
  treatingDoctor,
  setTreatingDoctor,
  isSavingRecord,
  isPrinting,
  canSave,
  canPrint,
  onClose,
  onSave,
  onPrint,
}) => (
  <div className="mt-3 flex flex-col gap-2.5 sm:flex-row sm:items-center">
    <label className="flex shrink-0 items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 sm:w-auto">
      <UserRound size={10} className="text-slate-300" />
      Médico tratante
    </label>
    <input
      className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] text-slate-700 shadow-sm transition-all placeholder:text-slate-300 focus:border-medical-400 focus:outline-none focus:ring-2 focus:ring-medical-500/10"
      value={treatingDoctor}
      onChange={event => setTreatingDoctor(event.target.value)}
    />
    <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:shrink-0 sm:flex-nowrap">
      <button
        onClick={onClose}
        className="flex-1 rounded-xl border border-slate-200 bg-white px-3.5 py-1.5 text-[12px] font-medium text-slate-500 shadow-sm transition-all hover:border-slate-300 hover:text-slate-700 active:scale-[0.98] sm:flex-none"
      >
        Cerrar
      </button>
      <button
        onClick={onSave}
        disabled={isSavingRecord || isPrinting || !canSave}
        className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-1.5 text-[12px] font-semibold text-emerald-700 shadow-sm transition-all hover:border-emerald-300 hover:bg-emerald-100 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 sm:flex-none"
      >
        <Save size={13} />
        {isSavingRecord ? 'Guardando...' : 'Guardar indicaciones'}
      </button>
      <button
        onClick={onPrint}
        disabled={isSavingRecord || isPrinting || !canPrint}
        className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-b from-medical-500 to-medical-600 px-4 py-1.5 text-[12px] font-semibold text-white shadow-md shadow-medical-600/25 transition-all hover:from-medical-600 hover:to-medical-700 hover:shadow-lg hover:shadow-medical-600/30 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none sm:flex-none"
      >
        <Printer size={13} />
        {isPrinting ? 'Generando...' : 'Imprimir PDF'}
      </button>
    </div>
  </div>
);
