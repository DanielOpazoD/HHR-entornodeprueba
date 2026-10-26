import React from 'react';
import { render, screen, act, fireEvent, renderHook } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { UIProvider, useUI } from '@/context/UIContext';

// Helper component to test useUI
const TestComponent = () => {
  const { success, error, confirm, alert } = useUI();
  return (
    <div>
      <button onClick={() => success('Success Title', 'Success Message')}>Notify Success</button>
      <button onClick={() => error('Error Title', 'Error Message')}>Notify Error</button>
      <button onClick={() => confirm({ message: 'Confirm Message' })}>Trigger Confirm</button>
      <button onClick={() => alert('Alert Message')}>Trigger Alert</button>
    </div>
  );
};

describe('UIContext', () => {
  it('should show success notification', async () => {
    render(
      <UIProvider>
        <TestComponent />
      </UIProvider>
    );

    const button = screen.getByText('Notify Success');
    act(() => {
      fireEvent.click(button);
    });

    expect(screen.getByText('Success Title')).toBeInTheDocument();
    expect(screen.getByText('Success Message')).toBeInTheDocument();
  });

  it('should show error notification', () => {
    render(
      <UIProvider>
        <TestComponent />
      </UIProvider>
    );

    const button = screen.getByText('Notify Error');
    act(() => {
      fireEvent.click(button);
    });

    expect(screen.getByText('Error Title')).toBeInTheDocument();
  });

  it('should handle confirm dialog (confirm)', async () => {
    let result: boolean | null = null;
    const ConfirmRequester = () => {
      const { confirm } = useUI();
      return (
        <button
          onClick={async () => {
            result = await confirm({ message: 'Are you sure?' });
          }}
        >
          Confirm
        </button>
      );
    };

    render(
      <UIProvider>
        <ConfirmRequester />
      </UIProvider>
    );

    fireEvent.click(screen.getByText('Confirm'));

    expect(screen.getByText('Are you sure?')).toBeInTheDocument();

    const confirmBtn = screen.getByRole('button', { name: /Confirmar/i });
    await act(async () => {
      fireEvent.click(confirmBtn);
    });

    expect(result).toBe(true);
    expect(screen.queryByText('Are you sure?')).not.toBeInTheDocument();
  });

  it('should handle confirm dialog (cancel)', async () => {
    let result: boolean | null = null;
    const ConfirmRequester = () => {
      const { confirm } = useUI();
      return (
        <button
          onClick={async () => {
            result = await confirm({ message: 'Proceed?' });
          }}
        >
          Confirm
        </button>
      );
    };

    render(
      <UIProvider>
        <ConfirmRequester />
      </UIProvider>
    );

    fireEvent.click(screen.getByText('Confirm'));

    const cancelBtn = screen.getByRole('button', { name: /Cancelar/i });
    await act(async () => {
      fireEvent.click(cancelBtn);
    });

    expect(result).toBe(false);
  });

  it('should handle alert dialog', async () => {
    render(
      <UIProvider>
        <TestComponent />
      </UIProvider>
    );

    fireEvent.click(screen.getByText('Trigger Alert'));

    expect(screen.getByText('Alert Message')).toBeInTheDocument();

    const okBtn = screen.getByRole('button', { name: /Aceptar/i });
    await act(async () => {
      fireEvent.click(okBtn);
    });

    expect(screen.queryByText('Alert Message')).not.toBeInTheDocument();
  });

  it('should show warning notification', () => {
    const WarningComponent = () => {
      const { warning } = useUI();
      return <button onClick={() => warning('Warning Title')}>Warn</button>;
    };

    render(
      <UIProvider>
        <WarningComponent />
      </UIProvider>
    );

    fireEvent.click(screen.getByText('Warn'));
    expect(screen.getByText('Warning Title')).toBeInTheDocument();
  });

  it('should show info notification', () => {
    const InfoComponent = () => {
      const { info } = useUI();
      return <button onClick={() => info('Info Title', 'Info Message')}>Info</button>;
    };

    render(
      <UIProvider>
        <InfoComponent />
      </UIProvider>
    );

    fireEvent.click(screen.getByText('Info'));
    expect(screen.getByText('Info Title')).toBeInTheDocument();
  });

  it('should dismiss all notifications', async () => {
    const DismissAllComponent = () => {
      const { success, dismissAll } = useUI();
      return (
        <div>
          <button onClick={() => success('Notification 1')}>Notify 1</button>
          <button onClick={() => success('Notification 2')}>Notify 2</button>
          <button onClick={() => dismissAll()}>Dismiss All</button>
        </div>
      );
    };

    render(
      <UIProvider>
        <DismissAllComponent />
      </UIProvider>
    );

    fireEvent.click(screen.getByText('Notify 1'));
    fireEvent.click(screen.getByText('Notify 2'));

    expect(screen.getByText('Notification 1')).toBeInTheDocument();
    expect(screen.getByText('Notification 2')).toBeInTheDocument();

    act(() => {
      fireEvent.click(screen.getByText('Dismiss All'));
    });

    expect(screen.queryByText('Notification 1')).not.toBeInTheDocument();
    expect(screen.queryByText('Notification 2')).not.toBeInTheDocument();
  });

  it('should auto-dismiss notification after duration', () => {
    vi.useFakeTimers();

    const AutoDismissComponent = () => {
      const { notify } = useUI();
      return (
        <button
          onClick={() =>
            notify({
              type: 'info',
              title: 'Temporal Notification',
              duration: 10,
            })
          }
        >
          Auto Dismiss
        </button>
      );
    };

    render(
      <UIProvider>
        <AutoDismissComponent />
      </UIProvider>
    );

    fireEvent.click(screen.getByText('Auto Dismiss'));
    expect(screen.getByText('Temporal Notification')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(20);
    });

    expect(screen.queryByText('Temporal Notification')).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it('should respect custom confirm options', async () => {
    let resolvedValue: boolean | null = null;
    const CustomConfirmComponent = () => {
      const { confirm } = useUI();
      return (
        <button
          onClick={async () => {
            resolvedValue = await confirm({
              title: 'Custom Title',
              message: 'Custom Message',
              confirmText: 'Yes',
              cancelText: 'No',
              variant: 'danger',
            });
          }}
        >
          Custom Confirm
        </button>
      );
    };

    render(
      <UIProvider>
        <CustomConfirmComponent />
      </UIProvider>
    );

    fireEvent.click(screen.getByText('Custom Confirm'));

    expect(screen.getByText('Custom Title')).toBeInTheDocument();
    expect(screen.getByText('Custom Message')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Yes/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /No/i })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Yes/i }));
    });

    expect(resolvedValue).toBe(true);
  });

  it('should throw error when useUI is used outside provider', () => {
    expect(() => renderHook(() => useUI())).toThrow('useUI must be used within a UIProvider');
  });

  it('announces feedback by severity and dismisses only the chosen toast', () => {
    render(
      <UIProvider>
        <TestComponent />
      </UIProvider>
    );
    fireEvent.click(screen.getByText('Notify Success'));
    fireEvent.click(screen.getByText('Notify Error'));
    expect(screen.getByRole('status')).toHaveTextContent('Success Title');
    expect(screen.getByRole('alert')).toHaveTextContent('Error Title');
    fireEvent.click(screen.getAllByRole('button', { name: 'Cerrar notificación' })[0]);
    expect(screen.queryByText('Success Title')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Error Title');
  });

  it('contains keyboard focus in a confirmation and restores the opener on Escape', async () => {
    render(
      <UIProvider>
        <TestComponent />
      </UIProvider>
    );
    const opener = screen.getByRole('button', { name: 'Trigger Confirm' });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAccessibleDescription('Confirm Message');
    const confirm = screen.getByRole('button', { name: 'Confirmar' });
    expect(confirm).toHaveFocus();
    fireEvent.keyDown(confirm, { key: 'Tab' });
    const close = screen.getByRole('button', { name: 'Cerrar diálogo' });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(confirm).toHaveFocus();
    await act(async () => {
      fireEvent.keyDown(confirm, { key: 'Escape' });
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('preserves the required confirmation phrase and keeps alerts open on Escape', async () => {
    let result: boolean | null = null;
    const Requester = () => {
      const { confirm, alert } = useUI();
      return (
        <>
          <button
            onClick={async () => {
              result = await confirm({
                message: 'Confirmación de prueba',
                requireInputConfirm: 'ELIMINAR',
              });
            }}
          >
            Confirm with phrase
          </button>
          <button onClick={() => alert('Aviso de prueba')}>Open alert</button>
        </>
      );
    };
    render(
      <UIProvider>
        <Requester />
      </UIProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Confirm with phrase' }));
    const input = screen.getByLabelText(/Escriba ELIMINAR para confirmar/);
    const confirm = screen.getByRole('button', { name: 'Confirmar' });
    expect(input).toHaveFocus();
    expect(confirm).toBeDisabled();
    fireEvent.change(input, { target: { value: 'incorrecto' } });
    expect(confirm).toBeDisabled();
    fireEvent.change(input, { target: { value: ' eliminar ' } });
    expect(confirm).toBeDisabled();
    fireEvent.change(input, { target: { value: ' ELIMINAR ' } });
    expect(confirm).toBeEnabled();
    await act(async () => {
      fireEvent.click(confirm);
    });
    expect(result).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Open alert' }));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Aceptar' }), { key: 'Escape' });
    expect(screen.getByRole('dialog')).toHaveTextContent('Aviso de prueba');
    fireEvent.click(screen.getByRole('button', { name: 'Aceptar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
