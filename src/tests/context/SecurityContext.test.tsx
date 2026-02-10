import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SecurityProvider, useSecurity } from '@/context/SecurityContext';
import { db } from '@/services/infrastructure/db';

// Mock DB
vi.mock('@/services/infrastructure/db', () => ({
    db: {
        getDoc: vi.fn(),
        setDoc: vi.fn(),
    },
}));

// Mock react-use useIdle
vi.mock('react-use', () => ({
    useIdle: vi.fn(() => false),
}));

const TestComponent = () => {
    const { config, isLocked, setPin, unlock, lock, hasPin } = useSecurity();
    return (
        <div>
            <div data-testid="is-locked">{isLocked.toString()}</div>
            <div data-testid="has-pin">{hasPin.toString()}</div>
            <div data-testid="pin-value">{config.pin || 'null'}</div>
            <button onClick={() => setPin('1234')}>Set PIN</button>
            <button onClick={() => unlock('1234')}>Unlock 1234</button>
            <button onClick={() => lock()}>Lock</button>
        </div>
    );
};

describe('SecurityContext', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
    });

    it('should initialize with default config when localStorage is empty', async () => {
        vi.mocked(db.getDoc).mockResolvedValue(null);

        render(
            <SecurityProvider>
                <TestComponent />
            </SecurityProvider>
        );

        expect(screen.getByTestId('is-locked').textContent).toBe('false');
        expect(screen.getByTestId('has-pin').textContent).toBe('false');
    });

    it('should initialize from localStorage if available', async () => {
        const savedConfig = {
            pin: '5555',
            lockOnStartup: true,
            inactivityTimeoutMinutes: 30
        };
        localStorage.setItem('hhr_security_config', JSON.stringify(savedConfig));
        vi.mocked(db.getDoc).mockResolvedValue(null);

        render(
            <SecurityProvider>
                <TestComponent />
            </SecurityProvider>
        );

        // Initial lock state should be true because lockOnStartup is true and we have a PIN
        expect(screen.getByTestId('is-locked').textContent).toBe('true');
        expect(screen.getByTestId('pin-value').textContent).toBe('5555');
    });

    it('should sync with Firestore on mount', async () => {
        const remoteConfig = {
            pin: '9999',
            lockOnStartup: false,
            inactivityTimeoutMinutes: 60
        };
        vi.mocked(db.getDoc).mockResolvedValue(remoteConfig);

        render(
            <SecurityProvider>
                <TestComponent />
            </SecurityProvider>
        );

        await waitFor(() => {
            expect(screen.getByTestId('pin-value').textContent).toBe('9999');
        });

        expect(JSON.parse(localStorage.getItem('hhr_security_config')!)).toEqual(remoteConfig);
    });

    it('should update state, localStorage and Firestore when setting a PIN', async () => {
        vi.mocked(db.getDoc).mockResolvedValue(null);

        render(
            <SecurityProvider>
                <TestComponent />
            </SecurityProvider>
        );

        const setPinBtn = screen.getByText('Set PIN');
        await act(async () => {
            setPinBtn.click();
        });

        expect(screen.getByTestId('pin-value').textContent).toBe('1234');
        expect(JSON.parse(localStorage.getItem('hhr_security_config')!).pin).toBe('1234');
        expect(db.setDoc).toHaveBeenCalledWith('config', 'security', expect.objectContaining({ pin: '1234' }), { merge: true });
    });

    it('should unlock when correct PIN is provided', async () => {
        localStorage.setItem('hhr_security_config', JSON.stringify({
            pin: '1234',
            lockOnStartup: true,
            inactivityTimeoutMinutes: 0
        }));

        render(
            <SecurityProvider>
                <TestComponent />
            </SecurityProvider>
        );

        expect(screen.getByTestId('is-locked').textContent).toBe('true');

        const unlockBtn = screen.getByText('Unlock 1234');
        act(() => {
            unlockBtn.click();
        });

        expect(screen.getByTestId('is-locked').textContent).toBe('false');
    });

    it('should lock when lock is called', async () => {
        localStorage.setItem('hhr_security_config', JSON.stringify({
            pin: '1234',
            lockOnStartup: false,
            inactivityTimeoutMinutes: 0
        }));

        render(
            <SecurityProvider>
                <TestComponent />
            </SecurityProvider>
        );

        expect(screen.getByTestId('is-locked').textContent).toBe('false');

        const lockBtn = screen.getByText('Lock');
        act(() => {
            lockBtn.click();
        });

        expect(screen.getByTestId('is-locked').textContent).toBe('true');
    });
});
