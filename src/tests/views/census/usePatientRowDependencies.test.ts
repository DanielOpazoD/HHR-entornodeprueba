import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { usePatientRowDependencies } from '@/features/census/components/patient-row/usePatientRowDependencies';
import { useDailyRecordBedActions } from '@/context/useDailyRecordScopedActions';
import { useConfirmDialog } from '@/context/UIContext';

vi.mock('@/context/useDailyRecordScopedActions', () => ({
  useDailyRecordBedActions: vi.fn(),
}));

vi.mock('@/context/UIContext', () => ({
  useConfirmDialog: vi.fn(),
}));

type BedActions = ReturnType<typeof useDailyRecordBedActions>;
type DialogActions = ReturnType<typeof useConfirmDialog>;

const bedActions = {
  updatePatient: vi.fn<BedActions['updatePatient']>(),
  updatePatientMultiple: vi.fn<BedActions['updatePatientMultiple']>().mockResolvedValue(true),
  clearPatient: vi.fn<BedActions['clearPatient']>().mockResolvedValue(false),
  updateClinicalCrib: vi.fn<BedActions['updateClinicalCrib']>().mockResolvedValue(false),
  updateClinicalCribMultiple: vi
    .fn<BedActions['updateClinicalCribMultiple']>()
    .mockResolvedValue(true),
  toggleBedType: vi.fn<BedActions['toggleBedType']>(),
  updateClinicalCribCudyr: vi.fn<BedActions['updateClinicalCribCudyr']>(),
  updateCudyr: vi.fn<BedActions['updateCudyr']>(),
  clearAllBeds: vi.fn<BedActions['clearAllBeds']>(),
  moveOrCopyPatient: vi.fn<BedActions['moveOrCopyPatient']>(),
  toggleBlockBed: vi.fn<BedActions['toggleBlockBed']>(),
  updateBlockedReason: vi.fn<BedActions['updateBlockedReason']>(),
  toggleExtraBed: vi.fn<BedActions['toggleExtraBed']>(),
  copyPatientToDate: vi.fn<BedActions['copyPatientToDate']>(),
} satisfies BedActions;

const dialogActions = {
  confirm: vi.fn<DialogActions['confirm']>(),
  alert: vi.fn<DialogActions['alert']>().mockResolvedValue(undefined),
  notify: vi.fn<DialogActions['notify']>(),
  success: vi.fn<DialogActions['success']>(),
  error: vi.fn<DialogActions['error']>(),
  warning: vi.fn<DialogActions['warning']>(),
  info: vi.fn<DialogActions['info']>(),
  dismiss: vi.fn<DialogActions['dismiss']>(),
  dismissAll: vi.fn<DialogActions['dismissAll']>(),
} satisfies DialogActions;

describe('usePatientRowDependencies', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(useDailyRecordBedActions).mockReturnValue(bedActions);
    vi.mocked(useConfirmDialog).mockReturnValue(dialogActions);
  });

  it('delivers patient edits, confirmed clearing and bed changes to their context actions', async () => {
    const { result } = renderHook(() => usePatientRowDependencies());
    const fields = { patientName: 'Paciente de prueba', age: '40' };
    const confirmedOccupant = { clinicalEpisodeId: 'episode-bed-test' };
    const confirmedAssociatedCrib = { clinicalEpisodeId: 'episode-crib-test' };

    result.current.updatePatient('R1', 'bedMode', 'Cuna');
    await expect(result.current.updatePatientMultiple('R2', fields)).resolves.toBe(true);
    await expect(
      result.current.clearPatient(
        'R3',
        '2026-10-21T12:00:00Z',
        confirmedOccupant,
        confirmedAssociatedCrib
      )
    ).resolves.toBe(false);
    result.current.toggleBedType('R4');

    expect(bedActions.updatePatient).toHaveBeenCalledExactlyOnceWith('R1', 'bedMode', 'Cuna');
    expect(bedActions.updatePatientMultiple).toHaveBeenCalledExactlyOnceWith('R2', fields);
    expect(bedActions.clearPatient).toHaveBeenCalledExactlyOnceWith(
      'R3',
      '2026-10-21T12:00:00Z',
      confirmedOccupant,
      confirmedAssociatedCrib
    );
    expect(bedActions.toggleBedType).toHaveBeenCalledExactlyOnceWith('R4');
  });

  it('delivers crib edits, confirmed removal and multiple fields with their results', async () => {
    const { result } = renderHook(() => usePatientRowDependencies());
    const confirmedOccupant = { clinicalEpisodeId: 'episode-crib-remove-test' };
    const fields = { patientName: 'Recién nacido de prueba', age: '2d' };

    await expect(result.current.updateClinicalCrib('R5', 'age', '3d')).resolves.toBe(false);
    await expect(
      result.current.updateClinicalCrib(
        'R6',
        'remove',
        undefined,
        '2026-10-21T13:00:00Z',
        confirmedOccupant
      )
    ).resolves.toBe(false);
    await expect(result.current.updateClinicalCribMultiple('R7', fields)).resolves.toBe(true);

    expect(bedActions.updateClinicalCrib).toHaveBeenCalledTimes(2);
    expect(bedActions.updateClinicalCrib).toHaveBeenNthCalledWith(1, 'R5', 'age', '3d');
    expect(bedActions.updateClinicalCrib).toHaveBeenNthCalledWith(
      2,
      'R6',
      'remove',
      undefined,
      '2026-10-21T13:00:00Z',
      confirmedOccupant
    );
    expect(bedActions.updateClinicalCribMultiple).toHaveBeenCalledExactlyOnceWith('R7', fields);
  });

  it('preserves accepted and cancelled confirmations and alert completion', async () => {
    dialogActions.confirm.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const { result } = renderHook(() => usePatientRowDependencies());
    const confirmOptions = {
      title: 'Limpiar cuna',
      message: '¿Está seguro de limpiar los datos de esta cuna?',
      confirmText: 'Sí, limpiar',
      cancelText: 'Cancelar',
      variant: 'warning',
    } satisfies Parameters<DialogActions['confirm']>[0];
    const cancelOptions = { message: '¿Cambiar a cuna?' };

    await expect(result.current.confirm(confirmOptions)).resolves.toBe(true);
    await expect(result.current.confirm(cancelOptions)).resolves.toBe(false);
    await expect(
      result.current.alert('La cama no tiene una cuna asociada.', 'Acción bloqueada')
    ).resolves.toBeUndefined();

    expect(dialogActions.confirm).toHaveBeenCalledTimes(2);
    expect(dialogActions.confirm).toHaveBeenNthCalledWith(1, confirmOptions);
    expect(dialogActions.confirm).toHaveBeenNthCalledWith(2, cancelOptions);
    expect(dialogActions.alert).toHaveBeenCalledExactlyOnceWith(
      'La cama no tiene una cuna asociada.',
      'Acción bloqueada'
    );
  });
});
