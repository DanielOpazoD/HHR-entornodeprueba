import { useMemo } from 'react';
import { SPECIALTY_OPTIONS } from '@/constants/clinicalSpecialtyConstants';
import type { PatientData } from '@/features/census/components/patient-row/patientRowContracts';
import { Specialty } from '@/types/domain/patientClassification';
import {
  resolveSpecialtyCellState,
  resolveSpecialtyDisplayLabel,
} from '@/features/census/controllers/specialtyCellController';

const WEB_SPECIALTY_LABELS: Record<string, string> = {
  [Specialty.GINECOBSTETRICIA]: 'GyO',
  [Specialty.TRAUMATOLOGIA]: 'TMT',
};

interface UseSpecialtyCellModelParams {
  data: PatientData;
}

interface UseSpecialtyCellModelResult {
  state: ReturnType<typeof resolveSpecialtyCellState>;
  primaryLabel: string | undefined;
}

export const useSpecialtyCellModel = ({
  data,
}: UseSpecialtyCellModelParams): UseSpecialtyCellModelResult => {
  const state = useMemo(
    () =>
      resolveSpecialtyCellState({
        specialty: data.specialty,
        availableSpecialties: SPECIALTY_OPTIONS,
      }),
    [data.specialty]
  );

  const primaryLabel = useMemo(
    () => resolveSpecialtyDisplayLabel(data.specialty, WEB_SPECIALTY_LABELS),
    [data.specialty]
  );

  return {
    state,
    primaryLabel,
  };
};
