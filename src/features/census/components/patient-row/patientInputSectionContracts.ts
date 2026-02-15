import type { PatientData } from '@/types';
import type { DiagnosisMode } from '@/features/census/types/censusTableTypes';
import type {
  DebouncedTextHandler,
  PatientInputChangeHandlers,
} from '@/features/census/components/patient-row/inputCellTypes';

export interface PatientInputSectionSharedProps {
  readonly data: PatientData;
  readonly currentDateString: string;
  readonly isSubRow: boolean;
  readonly isEmpty: boolean;
  readonly isLocked: boolean;
}

export interface PatientInputSectionBindingsParams extends PatientInputSectionSharedProps {
  readonly diagnosisMode: DiagnosisMode;
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
  readonly diagnosisMode: DiagnosisMode;
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
