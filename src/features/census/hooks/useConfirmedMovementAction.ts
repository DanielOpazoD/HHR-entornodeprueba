import { useCallback, useRef } from 'react';
import type { ConfirmOptions } from '@/context/UIContext';
import { runConfirmedMovementAction } from '@/features/census/controllers/censusMovementActionConfirmController';

interface UseConfirmedMovementActionParams {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  notifyError: (title: string, message?: string) => void;
}

interface ConfirmedActionInput {
  dialog: ConfirmOptions;
  run: () => void | Promise<void>;
  errorTitle: string;
}

export const useConfirmedMovementAction = ({
  confirm,
  notifyError,
}: UseConfirmedMovementActionParams) => {
  const isInFlightRef = useRef(false);

  return useCallback(
    async ({ dialog, run, errorTitle }: ConfirmedActionInput): Promise<void> => {
      if (isInFlightRef.current) {
        return;
      }

      isInFlightRef.current = true;
      const result = await runConfirmedMovementAction({
        runtime: { confirm },
        dialog: {
          title: dialog.title || 'Confirmar acción',
          message: dialog.message,
          confirmText: dialog.confirmText || 'Confirmar',
          cancelText: dialog.cancelText || 'Cancelar',
          variant: dialog.variant || 'warning',
        },
        run,
      }).finally(() => {
        isInFlightRef.current = false;
      });

      if (!result.ok) {
        notifyError(errorTitle, result.error.message);
      }
    },
    [confirm, notifyError]
  );
};
