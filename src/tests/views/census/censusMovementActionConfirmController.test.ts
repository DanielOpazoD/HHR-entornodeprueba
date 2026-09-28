// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  buildDischargeWithActiveTransferConfirmDialog,
  DISCHARGE_DELETE_CONFIRM_DIALOG,
  DISCHARGE_UNDO_CONFIRM_DIALOG,
  TRANSFER_DELETE_CONFIRM_DIALOG,
  TRANSFER_UNDO_CONFIRM_DIALOG,
  runConfirmedMovementAction,
} from '@/features/census/controllers/censusMovementActionConfirmController';

describe('censusMovementActionConfirmController', () => {
  it('executes action when confirm resolves true', async () => {
    const run = vi.fn();
    const confirm = vi.fn().mockResolvedValue(true);

    const result = await runConfirmedMovementAction({
      runtime: { confirm },
      dialog: DISCHARGE_UNDO_CONFIRM_DIALOG,
      run,
    });

    expect(confirm).toHaveBeenCalledWith(DISCHARGE_UNDO_CONFIRM_DIALOG);
    expect(run).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true, executed: true });
  });

  it('skips action when confirm resolves false', async () => {
    const run = vi.fn();
    const confirm = vi.fn().mockResolvedValue(false);

    const result = await runConfirmedMovementAction({
      runtime: { confirm },
      dialog: TRANSFER_DELETE_CONFIRM_DIALOG,
      run,
    });

    expect(confirm).toHaveBeenCalledWith(TRANSFER_DELETE_CONFIRM_DIALOG);
    expect(run).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, executed: false });
  });

  it('returns explicit error when confirm throws', async () => {
    const run = vi.fn();
    const confirm = vi.fn().mockRejectedValue(new Error('confirm crashed'));

    const result = await runConfirmedMovementAction({
      runtime: { confirm },
      dialog: DISCHARGE_DELETE_CONFIRM_DIALOG,
      run,
    });

    expect(run).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('confirm crashed');
    }
  });

  it('returns explicit error when confirmed action rejects asynchronously', async () => {
    const run = vi.fn().mockRejectedValue(new Error('action failed'));
    const confirm = vi.fn().mockResolvedValue(true);

    const result = await runConfirmedMovementAction({
      runtime: { confirm },
      dialog: DISCHARGE_DELETE_CONFIRM_DIALOG,
      run,
    });

    expect(confirm).toHaveBeenCalledWith(DISCHARGE_DELETE_CONFIRM_DIALOG);
    expect(run).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('action failed');
    }
  });

  it('exports expected transfer undo dialog metadata', () => {
    expect(TRANSFER_UNDO_CONFIRM_DIALOG).toEqual({
      title: 'Deshacer traslado',
      message: 'Esta acción restaurará al paciente a su cama. ¿Deseas continuar?',
      confirmText: 'Deshacer',
      cancelText: 'Cancelar',
      variant: 'warning',
    });
  });

  it('builds the active-transfer discharge warning with patient name', () => {
    const dialog = buildDischargeWithActiveTransferConfirmDialog('Juan Perez');

    expect(dialog).toEqual({
      title: 'Traslado en curso',
      message:
        'El paciente Juan Perez tiene una gestión de traslado activa. La acción más probable en este caso es usar el botón "Trasladar" para registrar el traslado efectivo. ¿Deseas darlo de alta de todas formas?',
      confirmText: 'Dar de alta igualmente',
      cancelText: 'Cancelar',
      variant: 'warning',
    });
  });

  it('builds the active-transfer discharge warning without patient name', () => {
    const dialog = buildDischargeWithActiveTransferConfirmDialog();

    expect(dialog.message).toContain('Este paciente tiene una gestión de traslado activa.');
    expect(dialog.message).toContain('usar el botón "Trasladar"');
    expect(dialog.message).toContain('registrar el traslado efectivo');
  });
});
