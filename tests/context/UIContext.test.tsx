import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { UIProvider, useUI } from '../../context/UIContext';

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
});
