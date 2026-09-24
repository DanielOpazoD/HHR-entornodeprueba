import { lazy, Suspense, useMemo, useState } from 'react';
import { ListChecks, Sparkles } from 'lucide-react';
import { useDailyRecordBeds } from '@/context/DailyRecordContext';
import { useAuth } from '@/context/AuthContext';
import { useFeatureFlag } from '@/hooks/useFeatureFlag';
import { buildSpecialtyRoundCandidates } from './specialtyRoundModel';
import { getClinicalCalendarDateISO } from '@/utils/clinicalTimeZone';

const SpecialtyRoundWindow = lazy(() => import('./SpecialtyRoundWindow').then(module => ({
  default: module.SpecialtyRoundWindow,
})));
const SpecialtyRulesWindow = lazy(() => import('./SpecialtyRulesWindow').then(module => ({
  default: module.SpecialtyRulesWindow,
})));

export const SpecialtyRoundEntry = ({ date, disabled }: { date: string; disabled: boolean }) => {
  const [open, setOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const enabled = useFeatureFlag('SPECIALTY_JEV_CONSULTATION');
  const { role } = useAuth();
  const isAdmin = role === 'admin';
  const beds = useDailyRecordBeds();
  const count = useMemo(() => buildSpecialtyRoundCandidates(beds, date).length, [beds, date]);
  const roundDisabled = disabled || date !== getClinicalCalendarDateISO();
  if (!enabled || (!open && !rulesOpen && !isAdmin && (roundDisabled || count === 0))) return null;
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-teal-100 bg-teal-50/70 px-3 py-2 print:hidden">
        <span className="text-xs font-medium text-teal-900">
          {count} {count === 1 ? 'especialidad pendiente' : 'especialidades pendientes'} en este censo
        </span>
        <div className="flex flex-wrap gap-2">
          {isAdmin && <button type="button" onClick={() => setRulesOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-teal-200 bg-white px-3 py-1.5 text-xs font-semibold text-teal-800 hover:bg-teal-100">
            <ListChecks size={14} aria-hidden="true" /> Reglas automáticas
          </button>}
          <button type="button" onClick={() => setOpen(true)} disabled={roundDisabled || count === 0}
            title={roundDisabled && !disabled ? 'Disponible sólo para el día clínico vigente' : undefined}
            className="inline-flex items-center gap-1.5 rounded-lg border border-teal-300 bg-white px-3 py-1.5 text-xs font-semibold text-teal-800 shadow-sm hover:bg-teal-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:opacity-50">
            <Sparkles size={14} aria-hidden="true" /> Asignar especialidades con Jev
          </button>
        </div>
      </div>
      {open && <Suspense fallback={null}>
        <SpecialtyRoundWindow key={date} date={date} disabled={roundDisabled}
          onClose={() => setOpen(false)} />
      </Suspense>}
      {rulesOpen && <Suspense fallback={null}>
        <SpecialtyRulesWindow onClose={() => setRulesOpen(false)} />
      </Suspense>}
    </>
  );
};
