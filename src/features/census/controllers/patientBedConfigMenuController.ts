export interface PatientBedIndicatorsParams {
  isCunaMode: boolean;
  hasCompanion: boolean;
  hasClinicalCrib: boolean;
}

export interface PatientBedIndicator {
  key: 'cuna';
  label: string;
  title?: string;
  className: string;
}

export const resolvePatientBedIndicators = ({
  isCunaMode,
  hasCompanion: _hasCompanion,
  hasClinicalCrib: _hasClinicalCrib,
}: PatientBedIndicatorsParams): PatientBedIndicator[] => {
  const indicators: PatientBedIndicator[] = [];

  if (isCunaMode) {
    indicators.push({
      key: 'cuna',
      label: 'CUNA',
      className:
        'text-[9px] bg-pink-100 text-pink-700 font-bold px-1 rounded-sm border border-pink-200',
    });
  }

  return indicators;
};
