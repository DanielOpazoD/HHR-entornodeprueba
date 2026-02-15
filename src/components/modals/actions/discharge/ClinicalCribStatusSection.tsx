import React from 'react';
import type { DischargeStatus } from '@/constants';
import { DischargeStatusRadioGroup } from '@/components/modals/actions/discharge/DischargeStatusRadioGroup';

interface ClinicalCribStatusSectionProps {
  clinicalCribName?: string;
  clinicalCribStatus?: DischargeStatus;
  onClinicalCribStatusChange: (status: DischargeStatus) => void;
  withTopBorder?: boolean;
}

export const ClinicalCribStatusSection: React.FC<ClinicalCribStatusSectionProps> = ({
  clinicalCribName,
  clinicalCribStatus,
  onClinicalCribStatusChange,
  withTopBorder = false,
}) => (
  <div className={withTopBorder ? 'pt-4 border-t border-slate-100 space-y-3' : 'space-y-4'}>
    <DischargeStatusRadioGroup
      inputName="cribStatus"
      label={`Estado RN (${clinicalCribName || 'Recién Nacido'})`}
      status={clinicalCribStatus}
      onChange={onClinicalCribStatusChange}
    />
  </div>
);
