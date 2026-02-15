import type React from 'react';
import type { PatientData } from '@/types';

interface ResolveDualSpecialtyStateParams {
  specialty?: string;
  secondarySpecialty?: string;
  availableSpecialties: readonly string[];
}

interface DispatchSpecialtyChangeParams {
  onChange: (
    field: keyof PatientData
  ) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;
  field: keyof PatientData;
  value: string | undefined;
}

export interface DualSpecialtyCellState {
  hasSecondary: boolean;
  isPrimaryOther: boolean;
  isSecondaryOther: boolean;
}

export const isKnownSpecialtyValue = (
  value: string | undefined,
  availableSpecialties: readonly string[]
): boolean => Boolean(value && availableSpecialties.includes(value));

export const resolveDualSpecialtyCellState = ({
  specialty,
  secondarySpecialty,
  availableSpecialties,
}: ResolveDualSpecialtyStateParams): DualSpecialtyCellState => {
  const hasSecondary = secondarySpecialty !== undefined && secondarySpecialty !== null;

  return {
    hasSecondary,
    isPrimaryOther: Boolean(specialty && !isKnownSpecialtyValue(specialty, availableSpecialties)),
    isSecondaryOther:
      hasSecondary &&
      Boolean(
        secondarySpecialty && !isKnownSpecialtyValue(secondarySpecialty, availableSpecialties)
      ),
  };
};

export const resolveSpecialtyDisplayLabel = (
  specialty: string | undefined,
  abbreviations: Record<string, string>
): string | undefined => {
  if (!specialty) {
    return undefined;
  }

  return abbreviations[specialty] || specialty;
};

export const dispatchSpecialtyChange = ({
  onChange,
  field,
  value,
}: DispatchSpecialtyChangeParams): void => {
  const syntheticEvent = { target: { value } } as unknown as React.ChangeEvent<HTMLInputElement>;
  onChange(field)(syntheticEvent);
};
