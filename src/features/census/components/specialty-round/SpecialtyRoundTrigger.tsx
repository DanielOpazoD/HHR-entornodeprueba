import { ChevronDown, ListChecks } from 'lucide-react';
import { useFeatureFlag } from '@/hooks/useFeatureFlag';

export const SPECIALTY_TRIGGER_CLASS =
  'inline-flex min-h-8 cursor-pointer list-none items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 [&::-webkit-details-marker]:hidden';

export const SpecialtyRoundTriggerLabel = () => (
  <>
    <ListChecks size={14} aria-hidden="true" /> Especialidades
    <ChevronDown
      size={13}
      className="transition-transform group-open:rotate-180"
      aria-hidden="true"
    />
  </>
);

export const SpecialtyRoundLoadingTrigger = () => {
  const enabled = useFeatureFlag('SPECIALTY_JEV_CONSULTATION');
  if (!enabled) return null;
  return (
    <button type="button" disabled className={SPECIALTY_TRIGGER_CLASS}>
      <SpecialtyRoundTriggerLabel />
    </button>
  );
};
