import type { PatientData } from '@/types/domain/patient';

import type {
  DebouncedTextHandler,
  PatientInputChangeHandlers,
} from '@/features/census/components/patient-row/inputCellTypes';

export interface PatientInputSectionSharedProps {
  readonly data: PatientData;
  readonly currentDateString: string;
  readonly isNewAdmission?: boolean;
  readonly isSubRow: boolean;
  readonly isEmpty: boolean;
  readonly isLocked: boolean;
  readonly clinicalEditingDisabled?: boolean;
}

export interface PatientInputSectionBindingsParams extends PatientInputSectionSharedProps {
  readonly hasRutError: boolean;
  readonly handleDebouncedText: DebouncedTextHandler;
  readonly onDemo: () => void;
  readonly onChange: PatientInputChangeHandlers;
}

export interface PatientInputIdentitySectionBindings {
  readonly shared: PatientInputSectionSharedProps;
  readonly hasRutError: boolean;
  readonly handleDebouncedText: DebouncedTextHandler;
  readonly onDemo: () => void;
  readonly onChange: PatientInputChangeHandlers;
}

export interface PatientInputClinicalSectionBindings {
  readonly shared: PatientInputSectionSharedProps;
  readonly handleDebouncedText: DebouncedTextHandler;
  readonly onChange: PatientInputChangeHandlers;
}

export interface PatientInputFlowSectionBindings {
  readonly shared: PatientInputSectionSharedProps;
  readonly handleDebouncedText: DebouncedTextHandler;
  readonly onChange: PatientInputChangeHandlers;
}

export interface PatientInputFlagsSectionBindings {
  readonly shared: PatientInputSectionSharedProps;
  readonly onChange: PatientInputChangeHandlers;
}

export interface PatientInputSectionBindings {
  readonly identity: PatientInputIdentitySectionBindings;
  readonly clinical: PatientInputClinicalSectionBindings;
  readonly flow: PatientInputFlowSectionBindings;
  readonly flags: PatientInputFlagsSectionBindings;
}
