import { useCallback, useMemo } from 'react';
import { SPECIALTY_OPTIONS, SPECIALTY_ABBREVIATIONS } from '@/constants';
import type { PatientData } from '@/types';
import type { EventTextHandler } from '@/features/census/components/patient-row/inputCellTypes';
import {
  dispatchSpecialtyChange,
  resolveDualSpecialtyCellState,
  resolveSpecialtyDisplayLabel,
} from '@/features/census/controllers/dualSpecialtyCellController';

interface UseDualSpecialtyCellModelParams {
  data: PatientData;
  onChange: EventTextHandler;
}

interface UseDualSpecialtyCellModelResult {
  state: ReturnType<typeof resolveDualSpecialtyCellState>;
  primaryLabel: string | undefined;
  secondaryLabel: string | undefined;
  handleAddSecondary: (e: React.MouseEvent) => void;
  handleRemoveSecondary: (e: React.MouseEvent) => void;
}

export const useDualSpecialtyCellModel = ({
  data,
  onChange,
}: UseDualSpecialtyCellModelParams): UseDualSpecialtyCellModelResult => {
  const state = useMemo(
    () =>
      resolveDualSpecialtyCellState({
        specialty: data.specialty,
        secondarySpecialty: data.secondarySpecialty,
        availableSpecialties: SPECIALTY_OPTIONS,
      }),
    [data.secondarySpecialty, data.specialty]
  );

  const primaryLabel = useMemo(
    () => resolveSpecialtyDisplayLabel(data.specialty, SPECIALTY_ABBREVIATIONS),
    [data.specialty]
  );
  const secondaryLabel = useMemo(
    () => resolveSpecialtyDisplayLabel(data.secondarySpecialty, SPECIALTY_ABBREVIATIONS),
    [data.secondarySpecialty]
  );

  const handleAddSecondary = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dispatchSpecialtyChange({
        onChange,
        field: 'secondarySpecialty',
        value: '',
      });
    },
    [onChange]
  );

  const handleRemoveSecondary = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dispatchSpecialtyChange({
        onChange,
        field: 'secondarySpecialty',
        value: undefined,
      });
    },
    [onChange]
  );

  return {
    state,
    primaryLabel,
    secondaryLabel,
    handleAddSecondary,
    handleRemoveSecondary,
  };
};
