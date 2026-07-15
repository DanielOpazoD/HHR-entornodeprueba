import type { DailyRecord } from '@/features/admin/contracts/publicMedicalSignatureContracts';
import type { DailyRecordContextType } from '@/context/dailyRecordContextContracts';
import type { MedicalHandoffScope } from '@/types/medicalHandoff';

const noop = () => {};
const asyncNoop = async () => {};

const buildEmptyInventory = () => ({
  occupiedCount: 0,
  blockedCount: 0,
  availableCount: 0,
  occupancyRate: 0,
  occupiedBeds: [],
  freeBeds: [],
  blockedBeds: [],
  isFull: false,
});

const buildEmptyStabilityRules = () => ({
  isDateLocked: true,
  isDayShiftLocked: true,
  isNightShiftLocked: true,
  canEditField: () => false,
  canPerformActions: false,
  lockReason: 'Modo público de solo lectura.',
});

export const createPublicMedicalSignatureContextValue = ({
  record,
  onSign,
}: {
  record: DailyRecord | null;
  onSign: (doctorName: string, scope?: MedicalHandoffScope) => Promise<void>;
}): DailyRecordContextType => ({
  record,
  syncStatus: 'saved',
  lastSyncTime: record?.lastUpdated ? new Date(record.lastUpdated) : null,
  bootstrapPhase: 'record_ready',
  inventory: buildEmptyInventory(),
  stabilityRules: buildEmptyStabilityRules(),
  createDay: noop,
  resetDay: asyncNoop,
  refresh: noop,
  validateRecordSchema: () => ({
    isValid: true,
    errors: [],
  }),
  canMovePatient: () => ({ canMove: false, reason: 'Modo solo lectura.' }),
  canDischargePatient: () => false,
  updatePatient: noop,
  updatePatientMultiple: noop,
  updateClinicalCrib: noop,
  updateClinicalCribMultiple: noop,
  updateClinicalCribCudyr: noop,
  updateCudyr: noop,
  clearPatient: noop,
  clearAllBeds: noop,
  moveOrCopyPatient: noop,
  toggleBlockBed: noop,
  updateBlockedReason: noop,
  toggleExtraBed: noop,
  toggleBedType: noop,
  copyPatientToDate: asyncNoop,
  updateNurse: noop,
  updateTens: noop,
  updateDetailedStaffing: noop,
  addDischarge: noop,
  updateDischarge: noop,
  deleteDischarge: noop,
  undoDischarge: noop,
  convertDischargeToCma: noop,
  convertDischargeToTransfer: noop,
  addTransfer: noop,
  updateTransfer: noop,
  deleteTransfer: noop,
  undoTransfer: noop,
  convertTransferToHomeDischarge: noop,
  convertTransferToCma: noop,
  addCMA: noop,
  deleteCMA: noop,
  updateCMA: noop,
  undoCMA: noop,
  convertCmaToHomeDischarge: noop,
  convertCmaToTransfer: noop,
  updateHandoffChecklist: noop,
  updateHandoffNovedades: noop,
  updateMedicalSpecialtyNote: asyncNoop,
  confirmMedicalSpecialtyNoChanges: asyncNoop,
  updateHandoffStaff: noop,
  updateMedicalSignature: onSign,
  updateMedicalHandoffDoctor: asyncNoop,
  markMedicalHandoffAsSent: asyncNoop,
  ensureMedicalHandoffSignatureLink: async () => ({
    status: 'failed',
    data: null,
    issues: [
      {
        kind: 'validation',
        message: 'No se puede generar el enlace de firma en este contexto.',
      },
    ],
  }),
  resetMedicalHandoffState: asyncNoop,
  sendMedicalHandoff: asyncNoop,
});
