import React from 'react';
import { Activity, Stethoscope } from 'lucide-react';
import type { MedicalIndicationsKineType } from '@/shared/contracts/medicalIndications';

interface MedicalIndicationsClinicalFieldsProps {
  reposo: string;
  setReposo: (value: string) => void;
  regimen: string;
  setRegimen: (value: string) => void;
  pendingNotes: string;
  setPendingNotes: (value: string) => void;
  kineType: MedicalIndicationsKineType;
  setKineType: (value: MedicalIndicationsKineType) => void;
  kineTimes: string;
  setKineTimes: (value: string) => void;
}

export const MedicalIndicationsClinicalFields: React.FC<MedicalIndicationsClinicalFieldsProps> = ({
  reposo,
  setReposo,
  regimen,
  setRegimen,
  pendingNotes,
  setPendingNotes,
  kineType,
  setKineType,
  kineTimes,
  setKineTimes,
}) => (
  <div className="mb-3 grid gap-x-2.5 gap-y-2 rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2.5 sm:grid-cols-3">
    <div className="group relative">
      <label className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        Reposo
      </label>
      <input
        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] text-slate-700 shadow-sm transition-all placeholder:text-slate-300 focus:border-medical-400 focus:outline-none focus:ring-2 focus:ring-medical-500/10"
        value={reposo}
        onChange={event => setReposo(event.target.value)}
        placeholder="Ej: absoluto"
      />
    </div>

    <div className="group relative">
      <label className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        Régimen
      </label>
      <input
        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] text-slate-700 shadow-sm transition-all placeholder:text-slate-300 focus:border-medical-400 focus:outline-none focus:ring-2 focus:ring-medical-500/10"
        value={regimen}
        onChange={event => setRegimen(event.target.value)}
        placeholder="Ej: liviano"
      />
    </div>

    <div className="group relative">
      <label className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        Pendientes
      </label>
      <input
        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] text-slate-700 shadow-sm transition-all placeholder:text-slate-300 focus:border-medical-400 focus:outline-none focus:ring-2 focus:ring-medical-500/10"
        value={pendingNotes}
        onChange={event => setPendingNotes(event.target.value)}
      />
    </div>

    <div className="group relative">
      <label className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        <Activity size={10} className="text-slate-300" />
        Kinesiología
      </label>
      <select
        className="w-full appearance-none rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] text-slate-700 shadow-sm transition-all focus:border-medical-400 focus:outline-none focus:ring-2 focus:ring-medical-500/10"
        value={kineType}
        onChange={event => setKineType(event.target.value as MedicalIndicationsKineType)}
      >
        <option value="ninguna">Sin indicación</option>
        <option value="motora">Motora</option>
        <option value="respiratoria">Respiratoria</option>
        <option value="ambas">Motora y respiratoria</option>
      </select>
    </div>

    <div className="group relative">
      <label className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        <Stethoscope size={10} className="text-slate-300" />
        Frecuencia
      </label>
      <input
        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] text-slate-700 shadow-sm transition-all placeholder:text-slate-300 focus:border-medical-400 focus:outline-none focus:ring-2 focus:ring-medical-500/10"
        value={kineTimes}
        onChange={event => setKineTimes(event.target.value)}
        placeholder="Ej: 2 veces/día"
      />
    </div>
  </div>
);
