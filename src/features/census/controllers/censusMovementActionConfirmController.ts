export interface MovementConfirmDialog {
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  variant: 'danger' | 'warning' | 'info';
}

export interface MovementActionConfirmRuntime {
  confirm: (dialog: MovementConfirmDialog) => Promise<boolean>;
}

interface RunConfirmedMovementActionParams {
  runtime: MovementActionConfirmRuntime;
  dialog: MovementConfirmDialog;
  run: () => void | Promise<void>;
}

export type ConfirmedMovementActionResult =
  | { ok: true; executed: boolean }
  | { ok: false; error: Error };

const resolveError = (error: unknown): Error => {
  if (error instanceof Error) {
    return error;
  }
  return new Error('No se pudo resolver el diálogo de confirmación.');
};

export const runConfirmedMovementAction = async ({
  runtime,
  dialog,
  run,
}: RunConfirmedMovementActionParams): Promise<ConfirmedMovementActionResult> => {
  try {
    const accepted = await runtime.confirm(dialog);
    if (!accepted) {
      return { ok: true, executed: false };
    }

    await run();
    return { ok: true, executed: true };
  } catch (error) {
    return { ok: false, error: resolveError(error) };
  }
};

export const DISCHARGE_UNDO_CONFIRM_DIALOG: MovementConfirmDialog = {
  title: 'Deshacer alta',
  message: 'Esta acción restaurará al paciente a su cama. ¿Deseas continuar?',
  confirmText: 'Deshacer',
  cancelText: 'Cancelar',
  variant: 'warning',
};

export const DISCHARGE_DELETE_CONFIRM_DIALOG: MovementConfirmDialog = {
  title: 'Eliminar alta',
  message: 'Esta acción eliminará el registro de alta. ¿Deseas continuar?',
  confirmText: 'Eliminar',
  cancelText: 'Cancelar',
  variant: 'danger',
};

export const TRANSFER_UNDO_CONFIRM_DIALOG: MovementConfirmDialog = {
  title: 'Deshacer traslado',
  message: 'Esta acción restaurará al paciente a su cama. ¿Deseas continuar?',
  confirmText: 'Deshacer',
  cancelText: 'Cancelar',
  variant: 'warning',
};

export const TRANSFER_DELETE_CONFIRM_DIALOG: MovementConfirmDialog = {
  title: 'Eliminar traslado',
  message: 'Esta acción eliminará el registro de traslado. ¿Deseas continuar?',
  confirmText: 'Eliminar',
  cancelText: 'Cancelar',
  variant: 'danger',
};
