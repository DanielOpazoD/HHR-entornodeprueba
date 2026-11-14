import { render, screen, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  SecurityProvider,
  resolveSecurityIdleTimeoutMs,
  useSecurity,
} from '@/context/SecurityContext';

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
      inactivityTimeoutMinutes: 30,
    };
    localStorage.setItem('hhr_security_config', JSON.stringify(savedConfig));

    render(
      <SecurityProvider>
        <TestComponent />
      </SecurityProvider>
    );

    // Initial lock state should be true because lockOnStartup is true and we have a PIN
    expect(screen.getByTestId('is-locked').textContent).toBe('true');
    expect(screen.getByTestId('pin-value').textContent).toBe('5555');
  });

  it('should keep privacy lock config as local-only (no remote sync on mount)', async () => {
    render(
      <SecurityProvider>
        <TestComponent />
      </SecurityProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('pin-value').textContent).toBe('null');
    });

    expect(localStorage.getItem('hhr_security_config')).toBeNull();
  });

  it('should update state and localStorage when setting a PIN', async () => {
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
  });

  it('should unlock when correct PIN is provided', async () => {
    localStorage.setItem(
      'hhr_security_config',
      JSON.stringify({
        pin: '1234',
        lockOnStartup: true,
        inactivityTimeoutMinutes: 0,
      })
    );

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
    localStorage.setItem(
      'hhr_security_config',
      JSON.stringify({
        pin: '1234',
        lockOnStartup: false,
        inactivityTimeoutMinutes: 0,
      })
    );

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

  it('should clamp huge inactivity timeout to avoid timer overflow', async () => {
    expect(resolveSecurityIdleTimeoutMs(99_999_999)).toBe(2147483647);
  });
});
