import type { MouseEventHandler } from 'react';

import type { EventTextHandler } from '@/features/census/components/patient-row/inputCellTypes';
import type { PatientBedConfigProps } from '@/features/census/components/patient-row/patientRowContracts';
import type { RowMenuAlign } from '@/features/census/components/patient-row/patientRowUiContracts';

interface PatientBedConfigMenuBindings {
  align: RowMenuAlign;
  clinicalCribModel: {
    className: string;
    dotClassName: string;
  };
  showClinicalCribToggle: boolean;
  showClinicalCribActions: boolean;
  showLegacyCompanionCleanup: boolean;
  onToggleClinicalCrib: () => void;
  onClearLegacyCompanion: () => void;
  onRemoveClinicalCrib: MouseEventHandler<HTMLButtonElement>;
}

interface PatientBedConfigDisplayBindings {
  bedName: string;
  showCunaIcon: boolean;
  showDaysCounter: boolean;
  daysHospitalized: number | null;
  showIndicators: boolean;
  indicators: Array<{
    key: string;
    className: string;
    title?: string;
    label: string;
  }>;
}

interface PatientBedConfigExtraLocationBindings {
  shouldRender: boolean;
  value: string;
  readOnly: boolean;
  onChange: ReturnType<EventTextHandler>;
}

export interface PatientBedConfigSections {
  display: PatientBedConfigDisplayBindings;
  menu: PatientBedConfigMenuBindings;
  extraLocation: PatientBedConfigExtraLocationBindings;
}

interface BuildPatientBedConfigSectionsParams {
  props: Omit<PatientBedConfigProps, 'onToggleMode'>;
  viewState: {
    daysHospitalized: number | null;
    indicators: Array<{
      key: string;
      className: string;
      title?: string;
      label: string;
    }>;
    clinicalCribModel: PatientBedConfigMenuBindings['clinicalCribModel'];
    showDaysCounter: boolean;
    showIndicators: boolean;
    showMenu: boolean;
    showClinicalCribToggle: boolean;
    showClinicalCribActions: boolean;
    showLegacyCompanionCleanup: boolean;
  };
  handlers: {
    handleToggleCompanion: () => void;
    handleToggleClinicalCrib: () => void;
    handleRemoveClinicalCrib: MouseEventHandler<HTMLButtonElement>;
  };
}

export const buildPatientBedConfigSections = ({
  props,
  viewState,
  handlers,
}: BuildPatientBedConfigSectionsParams): PatientBedConfigSections => ({
  display: {
    bedName: props.bed.name,
    showCunaIcon: props.isCunaMode,
    showDaysCounter: viewState.showDaysCounter,
    daysHospitalized: viewState.daysHospitalized,
    showIndicators: viewState.showIndicators,
    indicators: viewState.indicators,
  },
  menu: {
    align: props.align || 'top',
    clinicalCribModel: viewState.clinicalCribModel,
    showClinicalCribToggle: viewState.showClinicalCribToggle,
    showClinicalCribActions: viewState.showClinicalCribActions,
    showLegacyCompanionCleanup: viewState.showLegacyCompanionCleanup,
    onToggleClinicalCrib: handlers.handleToggleClinicalCrib,
    onClearLegacyCompanion: handlers.handleToggleCompanion,
    onRemoveClinicalCrib: handlers.handleRemoveClinicalCrib,
  },
  extraLocation: {
    shouldRender: Boolean(props.bed.isExtra),
    value: props.data.location || '',
    readOnly: Boolean(props.readOnly),
    onChange: props.onTextChange('location'),
  },
});
