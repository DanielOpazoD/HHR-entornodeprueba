interface ResolveSpecialtyStateParams {
  specialty?: string;
  availableSpecialties: readonly string[];
}

export interface SpecialtyCellState {
  isPrimaryOther: boolean;
}

export const isKnownSpecialtyValue = (
  value: string | undefined,
  availableSpecialties: readonly string[]
): boolean => Boolean(value && availableSpecialties.includes(value));

export const resolveSpecialtyCellState = ({
  specialty,
  availableSpecialties,
}: ResolveSpecialtyStateParams): SpecialtyCellState => {
  return {
    isPrimaryOther: Boolean(specialty && !isKnownSpecialtyValue(specialty, availableSpecialties)),
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
