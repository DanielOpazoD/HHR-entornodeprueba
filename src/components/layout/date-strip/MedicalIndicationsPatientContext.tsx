import React from 'react';
import { CalendarDays, UserRound } from 'lucide-react';
import type { MedicalIndicationsPatientOption } from '@/shared/contracts/medicalIndications';

interface MedicalIndicationsPatientContextProps {
  patient: MedicalIndicationsPatientOption | null;
  targetDate: string;
  targetDateLabel: string;
  daysOfStayForTargetDate: string;
  onTargetDateChange: (value: string) => void;
}

export const MedicalIndicationsPatientContext: React.FC<MedicalIndicationsPatientContextProps> = ({
  patient,
  targetDate,
  targetDateLabel,
  daysOfStayForTargetDate,
  onTargetDateChange,
}) => (
  <>
    {patient && (
      <div className="mb-3 flex items-center gap-3 rounded-xl border border-medical-100 bg-gradient-to-r from-medical-50/80 via-medical-50/40 to-transparent px-4 py-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-medical-100 text-medical-600">
          <UserRound size={16} />
        </div>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
          <span className="font-semibold text-slate-700">{patient.patientName}</span>
          <span className="text-slate-400">|</span>
          <span className="text-slate-500">{patient.rut}</span>
          {patient.diagnosis && (
            <>
              <span className="text-slate-400">|</span>
              <span className="max-w-[200px] truncate text-slate-500" title={patient.diagnosis}>
                {patient.diagnosis}
              </span>
            </>
          )}
          {daysOfStayForTargetDate && (
            <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-medical-100/80 px-2.5 py-0.5 text-[11px] font-semibold text-medical-700">
              {daysOfStayForTargetDate} días para {targetDateLabel}
            </span>
          )}
        </div>
      </div>
    )}

    <div className="mb-3 grid gap-2 rounded-xl border border-slate-100 bg-white px-3 py-2.5 sm:grid-cols-[220px_minmax(0,1fr)]">
      <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        <span className="flex items-center gap-1">
          <CalendarDays size={11} className="text-slate-300" />
          Fecha objetivo
        </span>
        <input
          type="date"
          className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[12px] font-medium normal-case tracking-normal text-slate-700 shadow-sm focus:border-medical-400 focus:outline-none focus:ring-2 focus:ring-medical-500/10"
          value={targetDate}
          onChange={event => onTargetDateChange(event.target.value)}
        />
      </label>
      <div className="flex min-w-0 flex-col justify-center rounded-lg bg-slate-50 px-3 py-2">
        <p className="text-[12px] font-semibold text-slate-700">
          Indicaciones para {targetDateLabel || 'fecha no definida'}
        </p>
        <p className="text-[11px] text-slate-400">
          La generación quedará registrada al guardar o imprimir el PDF.
        </p>
      </div>
    </div>
  </>
);
