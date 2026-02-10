import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PinLockScreen } from '@/components/security/PinLockScreen';
import { useSecurity } from '@/context/SecurityContext';

// Mock useSecurity
vi.mock('@/context/SecurityContext', () => ({
    useSecurity: vi.fn(),
}));

describe('PinLockScreen component', () => {
    const mockUnlock = vi.fn();
    const mockConfig = {
        pin: '1234',
        lockOnStartup: true,
        inactivityTimeoutMinutes: 0
    };

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useSecurity).mockReturnValue({
            isLocked: true,
            unlock: mockUnlock,
            config: mockConfig,
            lock: vi.fn(),
            setPin: vi.fn(),
            setLockOnStartup: vi.fn(),
            setInactivityTimeout: vi.fn(),
            hasPin: true
        });
    });

    it('should not render anything when isLocked is false', () => {
        vi.mocked(useSecurity).mockReturnValue({
            isLocked: false,
            unlock: mockUnlock,
            config: mockConfig,
            lock: vi.fn(),
            setPin: vi.fn(),
            setLockOnStartup: vi.fn(),
            setInactivityTimeout: vi.fn(),
            hasPin: true
        });

        const { container } = render(<PinLockScreen />);
        expect(container.firstChild).toBeNull();
    });

    it('should render the lock screen when isLocked is true', () => {
        render(<PinLockScreen />);
        expect(screen.getByText('Sistema Bloqueado')).toBeInTheDocument();
        expect(screen.getByText('Ingrese su PIN de 4 dígitos para continuar')).toBeInTheDocument();
    });

    it('should handle number pad clicks', () => {
        render(<PinLockScreen />);

        const btn1 = screen.getByText('1');
        const btn2 = screen.getByText('2');

        fireEvent.click(btn1);
        fireEvent.click(btn2);

        // We can't easily check the state of the dots without complex selectors, 
        // but we can verify unlock isn't called until 4 digits.
        expect(mockUnlock).not.toHaveBeenCalled();
    });

    it('should call unlock when 4 digits are entered', () => {
        mockUnlock.mockReturnValue(true);
        render(<PinLockScreen />);

        const btn1 = screen.getByText('1');
        fireEvent.click(btn1);
        fireEvent.click(btn1);
        fireEvent.click(btn1);
        fireEvent.click(btn1);

        expect(mockUnlock).toHaveBeenCalledWith('1111');
    });

    it('should show error message on incorrect PIN', async () => {
        vi.useFakeTimers();
        mockUnlock.mockReturnValue(false);
        render(<PinLockScreen />);

        const btn1 = screen.getByText('1');

        // Clicks in sequence to avoid batching using the same state snapshot
        fireEvent.click(btn1);
        fireEvent.click(btn1);
        fireEvent.click(btn1);
        fireEvent.click(btn1);

        expect(screen.getByText('PIN Incorrecto')).toBeInTheDocument();

        // Error clears after 500ms
        act(() => {
            vi.advanceTimersByTime(500);
        });

        expect(screen.queryByText('PIN Incorrecto')).not.toBeInTheDocument();
        vi.useRealTimers();
    });

    it('should handle keyboard input', () => {
        mockUnlock.mockReturnValue(true);
        render(<PinLockScreen />);

        fireEvent.keyDown(window, { key: '1' });
        fireEvent.keyDown(window, { key: '2' });
        fireEvent.keyDown(window, { key: '3' });
        fireEvent.keyDown(window, { key: '4' });

        expect(mockUnlock).toHaveBeenCalledWith('1234');
    });

    it('should handle Backspace key', () => {
        mockUnlock.mockReturnValue(true);
        render(<PinLockScreen />);

        fireEvent.keyDown(window, { key: '1' });
        fireEvent.keyDown(window, { key: '2' });
        fireEvent.keyDown(window, { key: 'Backspace' });
        fireEvent.keyDown(window, { key: '3' });
        fireEvent.keyDown(window, { key: '4' });
        fireEvent.keyDown(window, { key: '5' });

        expect(mockUnlock).toHaveBeenCalledWith('1345');
    });

    it('should handle BORRAR button', () => {
        mockUnlock.mockReturnValue(true);
        render(<PinLockScreen />);

        fireEvent.click(screen.getByText('1'));
        fireEvent.click(screen.getByText('BORRAR'));
        fireEvent.click(screen.getByText('2'));
        fireEvent.click(screen.getByText('3'));
        fireEvent.click(screen.getByText('4'));
        fireEvent.click(screen.getByText('5'));

        expect(mockUnlock).toHaveBeenCalledWith('2345');
    });
});
