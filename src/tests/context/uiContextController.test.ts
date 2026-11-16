// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  createAlertDialogState,
  createConfirmDialogState,
  createInitialDialogState,
  createNotification,
  resolveNotificationDuration,
} from '@/context/ui/uiContextController';

describe('uiContextController', () => {
  it('creates notifications with generated ids and default duration', () => {
    const notification = createNotification(
      { type: 'success', title: 'Guardado', message: 'Documento actualizado' },
      () => 'notification-fixed'
    );

    expect(notification).toEqual({
      id: 'notification-fixed',
      type: 'success',
      title: 'Guardado',
      message: 'Documento actualizado',
    });
    expect(resolveNotificationDuration(notification)).toBe(5000);
  });

  it('keeps explicit notification duration values', () => {
    expect(resolveNotificationDuration({ type: 'info', title: 'Persistente', duration: 0 })).toBe(
      0
    );
    expect(resolveNotificationDuration({ type: 'error', title: 'Lento', duration: 8000 })).toBe(
      8000
    );
  });

  it('builds confirm dialogs with clinical-safe defaults', () => {
    const resolve = vi.fn();

    expect(createConfirmDialogState({ message: 'Confirmar alta?' }, resolve)).toEqual({
      isOpen: true,
      title: 'Confirmar acción',
      message: 'Confirmar alta?',
      confirmText: 'Confirmar',
      cancelText: 'Cancelar',
      variant: 'warning',
      isAlert: false,
      requireInputConfirm: undefined,
      inputConfirmCaseSensitive: true,
      resolve,
    });
  });

  it('builds alert dialogs that resolve without cancel affordance', () => {
    const resolve = vi.fn();
    const dialog = createAlertDialogState('Revisar documento', 'Aviso clínico', resolve);

    expect(dialog).toMatchObject({
      isOpen: true,
      title: 'Aviso clínico',
      message: 'Revisar documento',
      confirmText: 'Aceptar',
      cancelText: '',
      variant: 'info',
      isAlert: true,
      requireInputConfirm: undefined,
      inputConfirmCaseSensitive: true,
    });

    dialog.resolve?.(true);

    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('exposes a closed initial dialog state', () => {
    expect(createInitialDialogState()).toEqual({
      isOpen: false,
      title: '',
      message: '',
      confirmText: 'Confirmar',
      cancelText: 'Cancelar',
      variant: 'warning',
      isAlert: false,
      requireInputConfirm: undefined,
      inputConfirmCaseSensitive: true,
      resolve: null,
    });
  });
});
