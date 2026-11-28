import { vi } from 'vitest';
import type {
  DailyRecordBedActions,
  DailyRecordMovementActions,
} from '@/context/dailyRecordContextContracts';
import type { useDailyRecordMovements, useDailyRecordStaff } from '@/context/DailyRecordContext';
import type { UIContextType } from '@/context/UIContext';
import type { CensusActionCommandsContextType } from '@/features/census/types/censusActionContextTypes';
import type { StabilityRules } from '@/hooks/useStabilityRules';

type DailyRecordStaffSlice = NonNullable<ReturnType<typeof useDailyRecordStaff>>;
type DailyRecordMovementsSlice = NonNullable<ReturnType<typeof useDailyRecordMovements>>;

export const buildMockUIContext = (overrides: Partial<UIContextType> = {}): UIContextType => ({
  notify: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
  dismiss: vi.fn(),
  dismissAll: vi.fn(),
  confirm: vi.fn(async () => true),
  alert: vi.fn(async () => undefined),
  ...overrides,
});

export const buildMockMovementActions = (
  overrides: Partial<DailyRecordMovementActions> = {}
): DailyRecordMovementActions => ({
  addDischarge: vi.fn(),
  updateDischarge: vi.fn(),
  deleteDischarge: vi.fn(),
  undoDischarge: vi.fn(),
  convertDischargeToCma: vi.fn(),
  convertDischargeToTransfer: vi.fn(),
  addTransfer: vi.fn(),
  updateTransfer: vi.fn(),
  deleteTransfer: vi.fn(),
  undoTransfer: vi.fn(),
  convertTransferToHomeDischarge: vi.fn(),
  convertTransferToCma: vi.fn(),
  addCMA: vi.fn(),
  deleteCMA: vi.fn(),
  updateCMA: vi.fn(),
  undoCMA: vi.fn(),
  convertCmaToHomeDischarge: vi.fn(),
  convertCmaToTransfer: vi.fn(),
  ...overrides,
});

export const buildMockBedActions = (
  overrides: Partial<DailyRecordBedActions> = {}
): DailyRecordBedActions => ({
  updatePatient: vi.fn(),
  confirmUpcRound: vi.fn().mockResolvedValue(true),
  updatePatientMultiple: vi.fn(),
  updateClinicalCrib: vi.fn(),
  updateClinicalCribMultiple: vi.fn(),
  clearPatient: vi.fn(async () => true),
  clearAllBeds: vi.fn(),
  moveOrCopyPatient: vi.fn(),
  toggleBlockBed: vi.fn(),
  updateBlockedReason: vi.fn(),
  toggleBedType: vi.fn(),
  copyPatientToDate: vi.fn(async () => undefined),
  ...overrides,
});

export const buildMockDailyRecordStaff = (
  overrides: Partial<DailyRecordStaffSlice> = {}
): DailyRecordStaffSlice => ({
  date: '2024-12-11',
  nursesDayShift: [],
  nursesNightShift: [],
  tensDayShift: [],
  tensNightShift: [],
  activeExtraBeds: [],
  ...overrides,
});

export const buildMockDailyRecordMovements = (
  overrides: Partial<DailyRecordMovementsSlice> = {}
): DailyRecordMovementsSlice => ({
  discharges: [],
  transfers: [],
  cma: [],
  ...overrides,
});

export const buildMockStabilityRules = (
  overrides: Partial<StabilityRules> = {}
): StabilityRules => ({
  isDateLocked: false,
  isDayShiftLocked: false,
  isNightShiftLocked: false,
  canEditField: () => true,
  canPerformActions: true,
  ...overrides,
});

export const buildMockCensusActionCommands = (
  overrides: Partial<CensusActionCommandsContextType> = {}
): CensusActionCommandsContextType => ({
  executeMoveOrCopy: vi.fn(),
  executeDischarge: vi.fn(),
  handleEditDischarge: vi.fn(),
  executeTransfer: vi.fn(),
  handleEditTransfer: vi.fn(),
  handleRowAction: vi.fn(),
  ...overrides,
});
