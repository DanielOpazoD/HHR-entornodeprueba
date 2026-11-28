import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TableConfigContext,
  useTableConfig,
  type TableConfigContextType,
} from '@/context/TableConfigContext';
import {
  DeferredTableConfigProvider,
  type TableConfigProviderComponent,
} from '@/context/DeferredTableConfigProvider';
import {
  DEFAULT_COLUMN_WIDTHS,
  cacheTableConfigLocally,
  getDefaultConfig,
} from '@/services/storage/tableConfigService';

const mockUseAuth = vi.fn();

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

const createDeferredLoader = () => {
  let resolveLoader!: (component: TableConfigProviderComponent) => void;
  const loader = vi.fn(
    () =>
      new Promise<TableConfigProviderComponent>(resolve => {
        resolveLoader = resolve;
      })
  );
  return {
    loader,
    resolveLoader: (component: TableConfigProviderComponent) => resolveLoader(component),
  };
};

const FakeTableConfigProvider: TableConfigProviderComponent = ({ children }) => {
  const [isEditMode, setEditMode] = useState(false);
  const config = useMemo(
    () => ({
      ...getDefaultConfig(),
      columns: { ...DEFAULT_COLUMN_WIDTHS, name: 168 },
    }),
    []
  );
  const value = useMemo<TableConfigContextType>(
    () => ({
      config,
      isEditMode,
      isLoading: false,
      setEditMode,
      updateColumnWidth: vi.fn(),
      updatePageMargin: vi.fn(),
      resetToDefaults: vi.fn(),
      exportConfig: vi.fn(),
      importConfig: vi.fn().mockResolvedValue(undefined),
    }),
    [config, isEditMode]
  );
  return <TableConfigContext.Provider value={value}>{children}</TableConfigContext.Provider>;
};

describe('DeferredTableConfigProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    mockUseAuth.mockReturnValue({ remoteSyncStatus: 'ready' });
  });

  it('hydrates cached widths on render 0 and bridges the loaded provider without remounting children', async () => {
    cacheTableConfigLocally({
      ...getDefaultConfig(),
      columns: { ...DEFAULT_COLUMN_WIDTHS, name: 155 },
    });
    const { loader, resolveLoader } = createDeferredLoader();
    let mountCount = 0;
    let latest: TableConfigContextType | undefined;

    const Consumer = () => {
      const ctx = useTableConfig();
      useLayoutEffect(() => {
        latest = ctx;
      });
      useEffect(() => {
        mountCount += 1;
      }, []);
      return <span>{ctx.config.columns.name}</span>;
    };

    render(
      <DeferredTableConfigProvider loader={loader}>
        <Consumer />
      </DeferredTableConfigProvider>
    );

    expect(mountCount).toBe(1);
    expect(latest?.isLoading).toBe(true);
    expect(latest?.config.columns.name).toBe(155);

    act(() => {
      latest?.setEditMode(true);
    });
    expect(latest?.isEditMode).toBe(true);

    await act(async () => {
      resolveLoader(FakeTableConfigProvider);
    });

    await waitFor(() => {
      expect(latest?.isLoading).toBe(false);
      expect(latest?.config.columns.name).toBe(168);
      expect(latest?.isEditMode).toBe(true);
    });
    expect(mountCount).toBe(1);
  });
});
