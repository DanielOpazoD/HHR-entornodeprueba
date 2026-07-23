import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSyslabAccess } from '@/features/laboratory/hooks/useSyslabAccess';
import {
  openSyslabLoginWindow,
  requestSyslabExtensionStatus,
} from '@/services/laboratory/syslabExtensionBridge';

vi.mock('@/services/laboratory/syslabExtensionBridge', () => ({
  requestSyslabExtensionStatus: vi.fn(),
  openSyslabLoginWindow: vi.fn(),
}));

describe('useSyslabAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requestSyslabExtensionStatus).mockResolvedValue({
      bridgeAvailable: true,
      connected: false,
      loginRequired: true,
      message: 'Syslab requiere iniciar sesión.',
    });
    vi.mocked(openSyslabLoginWindow).mockResolvedValue({
      bridgeAvailable: true,
      opened: true,
    });
  });

  it('opens the extension form and follows the session until it is connected', async () => {
    const { result } = renderHook(() => useSyslabAccess(true));

    await waitFor(() => expect(result.current.state).toBe('login-required'));
    await act(async () => result.current.openLogin());

    expect(openSyslabLoginWindow).toHaveBeenCalledTimes(1);
    expect(result.current.isAwaitingLogin).toBe(true);
    expect(result.current.message).toContain('ventana de la extensión');

    vi.mocked(requestSyslabExtensionStatus).mockResolvedValue({
      bridgeAvailable: true,
      connected: true,
      loginRequired: false,
      message: 'Sesión de Syslab activa.',
    });
    await act(async () => result.current.refresh());

    expect(result.current.state).toBe('connected');
    expect(result.current.isAwaitingLogin).toBe(false);
  });
});
