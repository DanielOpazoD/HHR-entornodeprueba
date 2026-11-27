import { Suspense, useMemo, useState } from 'react';
import { lazyWithRetry } from '@/components/ui/lazyWithRetry';
import { ChevronDown, ListChecks, Sparkles, Settings2 } from 'lucide-react';
import { useDailyRecordBeds } from '@/context/DailyRecordContext';
import { useAuth } from '@/context/AuthContext';
import { useFeatureFlag } from '@/hooks/useFeatureFlag';
import { useDailyRecordFreshnessUi } from '@/features/census/hooks/useDailyRecordFreshnessUi';
import { buildSpecialtyRoundCandidates } from './specialtyRoundModel';
import { getClinicalCalendarDateISO } from '@/utils/clinicalTimeZone';
import { canPublishSpecialtyDecision } from '@/shared/access/operationalAccessPolicy';

const SPECIALTY_TRIGGER_CLASS =
  'inline-flex min-h-8 cursor-pointer list-none items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 [&::-webkit-details-marker]:hidden';

const SpecialtyRoundWindow = lazyWithRetry(() =>
  import('./SpecialtyRoundWindow').then(module => ({
    default: module.SpecialtyRoundWindow,
  }))
);
const SpecialtyRulesWindow = lazyWithRetry(() =>
  import('./SpecialtyRulesWindow').then(module => ({
    default: module.SpecialtyRulesWindow,
  }))
);

export const SpecialtyRoundEntry = ({
  date,
  disabled,
  compact = false,
  onWindowChange,
}: {
  date: string;
  disabled: boolean;
  compact?: boolean;
  onWindowChange?: (open: boolean) => void;
}) => {
  const [open, setOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const enabled = useFeatureFlag('SPECIALTY_JEV_CONSULTATION');
  const { role } = useAuth();
  const isAdmin = canPublishSpecialtyDecision(role);
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
        <summary
          className={
            compact
              ? 'inline-flex min-h-7 min-w-7 cursor-pointer list-none items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700 [&::-webkit-details-marker]:hidden'
              : SPECIALTY_TRIGGER_CLASS
          }
          aria-label={compact ? 'Opciones de especialidades del censo' : undefined}
          title={compact ? 'Opciones de especialidades del censo' : undefined}
        >
          {compact ? (
            <Settings2 size={14} aria-hidden="true" />
          ) : (
            <>
              <ListChecks size={14} aria-hidden="true" /> Especialidades
              <ChevronDown
                size={13}
                className="transition-transform group-open:rotate-180"
                aria-hidden="true"
              />
            </>
          )}
        </summary>
        <div className="absolute right-0 z-50 mt-1 min-w-56 rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
          {isAdmin && (
            <button
              type="button"
              disabled={disabled || freshnessUi.isClinicalEditingBlocked}
              onClick={event => {
                event.currentTarget.closest('details')?.removeAttribute('open');
                setRulesOpen(true);
                onWindowChange?.(true);
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
              onWindowChange?.(true);
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
            onClose={() => {
              setOpen(false);
              onWindowChange?.(false);
            }}
          />
        </Suspense>
      )}
      {rulesOpen && (
        <Suspense fallback={null}>
          <SpecialtyRulesWindow
            date={date}
            disabled={disabled || freshnessUi.isClinicalEditingBlocked || !isAdmin}
            onClose={() => {
              setRulesOpen(false);
              onWindowChange?.(false);
            }}
          />
        </Suspense>
      )}
    </>
  );
};
