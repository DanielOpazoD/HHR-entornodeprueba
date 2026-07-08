import React from 'react';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TableConfigProvider, useTableConfig } from '@/context/TableConfigContext';
import {
  DEFAULT_COLUMN_WIDTHS,
  cacheTableConfigLocally,
  getDefaultConfig,
} from '@/services/storage/tableConfigService';

const mockUseAuth = vi.fn();

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

describe('TableConfigProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it('uses the last-known table config during auth bootstrapping to avoid first-paint width shifts', () => {
    mockUseAuth.mockReturnValue({ remoteSyncStatus: 'bootstrapping' });
    cacheTableConfigLocally({
      ...getDefaultConfig(),
      columns: {
        ...DEFAULT_COLUMN_WIDTHS,
        name: 94,
        diagnosis: 116,
      },
    });

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <TableConfigProvider>{children}</TableConfigProvider>
    );

    const { result } = renderHook(() => useTableConfig(), { wrapper });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.config.columns.name).toBe(94);
    expect(result.current.config.columns.diagnosis).toBe(116);
  });

  it('does not wait for a remote table-config snapshot in E2E bootstrap runtime', () => {
    mockUseAuth.mockReturnValue({ remoteSyncStatus: 'ready' });
    window.localStorage.setItem(
      'hhr_e2e_bootstrap_user',
      JSON.stringify({ uid: 'preview', role: 'admin' })
    );
    cacheTableConfigLocally({
      ...getDefaultConfig(),
      columns: {
        ...DEFAULT_COLUMN_WIDTHS,
        name: 96,
      },
    });

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <TableConfigProvider>{children}</TableConfigProvider>
    );

    const { result } = renderHook(() => useTableConfig(), { wrapper });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.config.columns.name).toBe(96);
  });
});
