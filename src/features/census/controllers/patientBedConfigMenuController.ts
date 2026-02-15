import clsx from 'clsx';

export interface PatientBedIndicatorsParams {
  isCunaMode: boolean;
  hasCompanion: boolean;
  hasClinicalCrib: boolean;
}

export interface PatientBedIndicator {
  key: 'cuna' | 'rn' | 'cc';
  label: string;
  title?: string;
  className: string;
}

export const resolvePatientBedIndicators = ({
  isCunaMode,
  hasCompanion,
  hasClinicalCrib,
}: PatientBedIndicatorsParams): PatientBedIndicator[] => {
  const indicators: PatientBedIndicator[] = [];

  if (isCunaMode) {
    indicators.push({
      key: 'cuna',
      label: 'CUNA',
      className:
        'text-[8px] bg-pink-100 text-pink-700 font-bold px-1 rounded-sm border border-pink-200',
    });
  }

  if (hasCompanion) {
    indicators.push({
      key: 'rn',
      label: 'RN',
      title: 'RN Sano',
      className:
        'text-[8px] bg-emerald-100 text-emerald-700 font-bold px-1 rounded-sm border border-emerald-200',
    });
  }

  if (hasClinicalCrib) {
    indicators.push({
      key: 'cc',
      label: '+CC',
      title: 'Cuna Clínica',
      className:
        'text-[8px] bg-slate-100 text-slate-600 font-bold px-1 rounded-sm border border-slate-200',
    });
  }

  return indicators;
};

export const resolveBedModeButtonModel = (isCunaMode: boolean) => ({
  emoji: isCunaMode ? '🛏️' : '👶',
  label: isCunaMode ? 'Cambiar a Cama' : 'Cambiar a Cuna Clínica',
  className: clsx(
    'text-[10px] font-bold uppercase tracking-tight px-2 py-2.5 rounded-md flex items-center justify-between transition-all w-full group/item',
    isCunaMode
      ? 'bg-pink-50 text-pink-700 hover:bg-pink-100'
      : 'bg-slate-50 text-slate-700 hover:bg-slate-100'
  ),
  dotClassName: clsx(
    'w-1.5 h-1.5 rounded-full transition-all',
    isCunaMode ? 'bg-pink-500 scale-125 shadow-[0_0_8px_rgba(236,72,153,0.5)]' : 'bg-slate-300'
  ),
});

export const resolveCompanionButtonModel = (hasCompanion: boolean) => ({
  className: clsx(
    'text-[10px] font-bold uppercase tracking-tight px-2 py-2.5 rounded-md flex items-center justify-between transition-all w-full group/item',
    hasCompanion
      ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
      : 'bg-slate-50 text-slate-700 hover:bg-slate-100'
  ),
  dotClassName: clsx(
    'w-1.5 h-1.5 rounded-full transition-all',
    hasCompanion ? 'bg-emerald-500 scale-125 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-slate-300'
  ),
});

export const resolveClinicalCribButtonModel = (hasClinicalCrib: boolean) => ({
  className: clsx(
    'text-[10px] font-bold uppercase tracking-tight px-2 py-2.5 rounded-md flex items-center justify-between transition-all w-full group/item',
    hasClinicalCrib
      ? 'bg-purple-50 text-purple-700 hover:bg-purple-100'
      : 'bg-slate-50 text-slate-700 hover:bg-slate-100'
  ),
  dotClassName: clsx(
    'w-1.5 h-1.5 rounded-full transition-all',
    hasClinicalCrib
      ? 'bg-purple-500 scale-125 shadow-[0_0_8px_rgba(168,85,247,0.5)]'
      : 'bg-slate-300'
  ),
});
