import { lazy, Suspense, useMemo, useState } from 'react';
import { ChevronDown, ListChecks, Sparkles } from 'lucide-react';
import { useDailyRecordBeds } from '@/context/DailyRecordContext';
import { useAuth } from '@/context/AuthContext';
import { useFeatureFlag } from '@/hooks/useFeatureFlag';
import { useDailyRecordFreshnessUi } from '@/hooks/useDailyRecordFreshnessUi';
import { buildSpecialtyRoundCandidates } from './specialtyRoundModel';
import { getClinicalCalendarDateISO } from '@/utils/clinicalTimeZone';

const SpecialtyRoundWindow = lazy(() =>
  import('./SpecialtyRoundWindow').then(module => ({
    default: module.SpecialtyRoundWindow,
  }))
);
const SpecialtyRulesWindow = lazy(() =>
  import('./SpecialtyRulesWindow').then(module => ({
    default: module.SpecialtyRulesWindow,
  }))
);

export const SpecialtyRoundEntry = ({ date, disabled }: { date: string; disabled: boolean }) => {
  const [open, setOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const enabled = useFeatureFlag('SPECIALTY_JEV_CONSULTATION');
  const { role } = useAuth();
  const isAdmin = role === 'admin';
  const beds = useDailyRecordBeds();
  const freshnessUi = useDailyRecordFreshnessUi(date);
  const count = useMemo(() => buildSpecialtyRoundCandidates(beds, date).length, [beds, date]);
  const roundDisabled =
    disabled || freshnessUi.isClinicalEditingBlocked || date !== getClinicalCalendarDateISO();
  if (!enabled) return null;
  return (
    <>
      <details
        className="group relative print:hidden"
        data-testid="specialty-actions"
        data-overlay-open={menuOpen ? '' : undefined}
        onToggle={event => setMenuOpen(event.currentTarget.open)}
      >
        <summary className="inline-flex min-h-8 cursor-pointer list-none items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 [&::-webkit-details-marker]:hidden">
          <ListChecks size={14} aria-hidden="true" /> Especialidades
          <ChevronDown
            size={13}
            className="transition-transform group-open:rotate-180"
            aria-hidden="true"
          />
        </summary>
        <div className="absolute right-0 z-50 mt-1 min-w-56 rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
          {isAdmin && (
            <button
              type="button"
              disabled={disabled || freshnessUi.isClinicalEditingBlocked}
              onClick={event => {
                event.currentTarget.closest('details')?.removeAttribute('open');
                setRulesOpen(true);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ListChecks size={14} aria-hidden="true" /> Reglas automáticas
            </button>
          )}
          <button
            type="button"
            onClick={event => {
              event.currentTarget.closest('details')?.removeAttribute('open');
              setOpen(true);
            }}
            disabled={roundDisabled || count === 0}
            title={
              count === 0
                ? 'No hay pacientes pendientes de especialidad'
                : roundDisabled && !disabled
                  ? 'Disponible sólo para el día clínico vigente'
                  : undefined
            }
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Sparkles size={14} aria-hidden="true" /> Asignar especialidades
          </button>
        </div>
      </details>
      {open && (
        <Suspense fallback={null}>
          <SpecialtyRoundWindow
            key={date}
            date={date}
            disabled={roundDisabled}
            onClose={() => setOpen(false)}
          />
        </Suspense>
      )}
      {rulesOpen && (
        <Suspense fallback={null}>
          <SpecialtyRulesWindow date={date} onClose={() => setRulesOpen(false)} />
        </Suspense>
      )}
    </>
  );
};
