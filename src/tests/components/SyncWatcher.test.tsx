import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncWatcher } from '@/components/shared/SyncWatcher';

const watcherState = vi.hoisted(() => ({
  connected: true,
  warning: vi.fn(),
}));

vi.mock('@/context/UIContext', () => ({
  useNotification: () => ({ warning: watcherState.warning }),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ isFirebaseConnected: watcherState.connected }),
}));

describe('SyncWatcher', () => {
  beforeEach(() => {
    watcherState.connected = true;
    watcherState.warning.mockReset();
  });

  it('does not duplicate operation feedback when connectivity changes', () => {
    const view = render(<SyncWatcher />);

    watcherState.connected = false;
    view.rerender(<SyncWatcher />);
    view.rerender(<SyncWatcher />);

    expect(watcherState.warning).not.toHaveBeenCalled();
  });
});
