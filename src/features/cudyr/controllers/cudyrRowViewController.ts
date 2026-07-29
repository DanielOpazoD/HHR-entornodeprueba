import type { CudyrScore } from '@/types/domain/cudyr';
import type { BedDefinition } from '@/types/domain/beds';
import type { PatientData } from '@/features/cudyr/contracts/cudyrPatientContracts';
import { getCategorization } from '@/services/cudyr/CudyrScoreUtils';
import { hasVisibleCudyrPatientName } from '@/features/cudyr/controllers/cudyrEligibilityController';

export interface CudyrRowViewModel {
  isOccupied: boolean;
  rowReadOnly: boolean;
  rowBgClass: string;
  bedTextClass: string;
  patientCellClass: string;
  patientTitle: string | undefined;
  showBlockedLabel: boolean;
  blockedLabel: string;
  emptyStateLabel: string;
  finalCat: string;
  badgeColor: string;
  displayedDepScore: string | number;
  displayedRiskScore: string | number;
  scores: CudyrScore | undefined;
}

export const buildCudyrRowViewModel = ({
  bed,
  patient,
  readOnly = false,
  isCrib = false,
  eligibilityBlocked = false,
  eligibilityBlockedReason,
}: {
  bed: BedDefinition;
  patient: PatientData | undefined;
  readOnly?: boolean;
  isCrib?: boolean;
  eligibilityBlocked?: boolean;
  eligibilityBlockedReason?: string;
}): CudyrRowViewModel => {
  const isOccupied = hasVisibleCudyrPatientName(patient?.patientName);
  const isUTI = bed.type === 'UTI';
  const scores = eligibilityBlocked ? undefined : patient?.cudyr;
  const rowReadOnly = readOnly || eligibilityBlocked;
  const { finalCat, depScore, riskScore, badgeColor } = getCategorization(scores);

  return {
    isOccupied,
    rowReadOnly,
    rowBgClass: isCrib ? 'bg-purple-50/60' : isUTI ? 'bg-yellow-50/60' : 'bg-white',
    bedTextClass: isCrib ? 'text-purple-700' : 'text-slate-700',
    patientCellClass: eligibilityBlocked ? 'text-amber-700 bg-amber-50/60' : 'text-slate-700',
    patientTitle: eligibilityBlockedReason ?? patient?.patientName,
    showBlockedLabel: eligibilityBlocked,
    blockedLabel: 'Bloqueado CUDYR',
    emptyStateLabel: isCrib ? 'Cuna RN sin paciente' : 'Cama disponible',
    finalCat,
    badgeColor,
    displayedDepScore: eligibilityBlocked ? '' : depScore,
    displayedRiskScore: eligibilityBlocked ? '' : riskScore,
    scores,
  };
};
