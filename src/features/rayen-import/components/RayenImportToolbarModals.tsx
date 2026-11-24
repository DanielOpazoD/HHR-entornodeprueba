import React, { Suspense } from 'react';
import { lazyWithRetry } from '@/components/ui/lazyWithRetry';
import type { RayenSyncEvent } from '@/types/domain/rayenSync';
import type { NursingStaffingProposal } from '../contracts/nursingShiftInference';
import type { RayenImportPreviewModalProps } from './RayenImportPreviewModal';
import type { RayenSyncRecoveryPresentation } from './rayenSyncRecoveryPresentation';

const LazyRayenSyncHistoryModal = lazyWithRetry(() =>
  import('./RayenSyncHistoryModal').then(module => ({ default: module.RayenSyncHistoryModal }))
);

// Review is opened after a capture; it contains no writes and confirmation remains explicit.
const RayenImportPreviewModal = lazyWithRetry(() =>
  import('./RayenImportPreviewModal').then(module => ({ default: module.RayenImportPreviewModal }))
);

// Staffing review opens only when the operator clicks «Dotación» and Eloísa returns a proposal.
const RayenNursingShiftProposalModal = lazyWithRetry(() =>
  import('./RayenNursingShiftProposalModal').then(module => ({
    default: module.RayenNursingShiftProposalModal,
  }))
);

export interface RayenImportToolbarModalsProps {
  isPreviewOpen: boolean;
  diff: RayenImportPreviewModalProps['diff'];
  stage: RayenImportPreviewModalProps['stage'];
  error: string | null;
  isApplied: boolean;
  targetDate: string | null;
  onConfirmPreview: RayenImportPreviewModalProps['onConfirm'];
  onCancelPreview: () => void;
  historyOpen: boolean;
  onCloseHistory: () => void;
  history: RayenSyncEvent[];
  recovery: RayenSyncRecoveryPresentation | null;
  recoveryBusy: boolean;
  onRecoveryAction: () => void;
  historyTargetDate: string | null;
  staffingReviewOpen: boolean;
  staffingProposal: NursingStaffingProposal | null;
  isStaffingProposalBusy: boolean;
  staffingProposalError: string | null;
  onConfirmStaffingProposal: () => void;
  onCancelStaffingProposal: () => void;
}

export const RayenImportToolbarModals: React.FC<RayenImportToolbarModalsProps> = ({
  isPreviewOpen,
  diff,
  stage,
  error,
  isApplied,
  targetDate,
  onConfirmPreview,
  onCancelPreview,
  historyOpen,
  onCloseHistory,
  history,
  recovery,
  recoveryBusy,
  onRecoveryAction,
  historyTargetDate,
  staffingReviewOpen,
  staffingProposal,
  isStaffingProposalBusy,
  staffingProposalError,
  onConfirmStaffingProposal,
  onCancelStaffingProposal,
}) => (
  <>
    {isPreviewOpen ? (
      <Suspense fallback={null}>
        <RayenImportPreviewModal
          isOpen={isPreviewOpen}
          diff={diff}
          stage={stage}
          error={error}
          isApplied={isApplied}
          targetDate={targetDate}
          onConfirm={onConfirmPreview}
          onCancel={onCancelPreview}
        />
      </Suspense>
    ) : null}
    <Suspense fallback={null}>
      {historyOpen ? (
        <LazyRayenSyncHistoryModal
          isOpen={historyOpen}
          onClose={onCloseHistory}
          history={history}
          recovery={recovery}
          recoveryBusy={recoveryBusy}
          onRecoveryAction={onRecoveryAction}
          targetDate={historyTargetDate}
        />
      ) : null}
    </Suspense>
    {!isPreviewOpen && staffingReviewOpen && staffingProposal ? (
      <Suspense fallback={null}>
        <RayenNursingShiftProposalModal
          proposal={staffingProposal}
          isBusy={isStaffingProposalBusy}
          error={staffingProposalError}
          onConfirm={onConfirmStaffingProposal}
          onCancel={onCancelStaffingProposal}
        />
      </Suspense>
    ) : null}
  </>
);
