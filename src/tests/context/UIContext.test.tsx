import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
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
            return <button onClick={async () => { result = await confirm({ message: 'Are you sure?' }); }}>Confirm</button>;
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
            return <button onClick={async () => { result = await confirm({ message: 'Proceed?' }); }}>Confirm</button>;
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
        const ErrorComponent = () => {
            try {
                useUI();
                return <div>No error</div>;
            } catch (_error) {
                return <div>Error thrown</div>;
            }
        };

        render(<ErrorComponent />);
        expect(screen.getByText('Error thrown')).toBeInTheDocument();
    });
});
