import React from 'react';
import { DischargeModal, MoveCopyModal, TransferModal } from '@/components/modals/ActionModals';
import type { CensusActionModalPropsModel } from '@/features/census/hooks/useCensusActionModalProps';

interface CensusActionModalsProps {
  actionModalProps: CensusActionModalPropsModel;
}

export const CensusActionModals: React.FC<CensusActionModalsProps> = ({ actionModalProps }) => (
  <>
    <MoveCopyModal {...actionModalProps.moveCopyProps} />
    <DischargeModal {...actionModalProps.dischargeProps} />
    <TransferModal {...actionModalProps.transferProps} />
  </>
);
