import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StaffContext, useStaffContext, type StaffContextType } from '@/context/StaffContext';
import {
  DeferredStaffProvider,
  type StaffProviderComponent,
} from '@/context/DeferredStaffProvider';

vi.unmock('@/context/StaffContext');
vi.unmock('@/context/DeferredStaffProvider');

const createDeferredLoader = () => {
  let resolveLoader!: (component: StaffProviderComponent) => void;
  let rejectLoader!: (error: Error) => void;
  const loader = vi.fn(
    () =>
      new Promise<StaffProviderComponent>((resolve, reject) => {
        resolveLoader = resolve;
        rejectLoader = reject;
      })
  );
  return {
    loader,
    resolveLoader: (c: StaffProviderComponent) => resolveLoader(c),
    rejectLoader: (e: Error) => rejectLoader(e),
  };
};

const FakeStaffProvider: StaffProviderComponent = ({ children }) => {
  const [showNurseManager, setShowNurseManager] = useState(false);
  const [showTensManager, setShowTensManager] = useState(false);
  const value = useMemo<StaffContextType>(
    () => ({
      staffIdentities: [],
      nursesList: ['Enfermera Sintética'],
      setNursesList: vi.fn(),
      nursesLoading: false,
      tensList: ['TENS Sintético'],
      setTensList: vi.fn(),
      tensLoading: false,
      professionalsCatalog: [{ name: 'Médico Sintético', phone: '' }],
      setProfessionalsCatalog: vi.fn(),
      professionalsLoading: false,
      showNurseManager,
      setShowNurseManager,
      showTensManager,
      setShowTensManager,
    }),
    [showNurseManager, showTensManager]
  );
  return <StaffContext.Provider value={value}>{children}</StaffContext.Provider>;
};

describe('DeferredStaffProvider', () => {
  it('renders children immediately in loading state and bridges the loaded provider without remounting children', async () => {
    const { loader, resolveLoader } = createDeferredLoader();
    let mountCount = 0;
    let latest: StaffContextType | undefined;

    const Consumer = () => {
      const ctx = useStaffContext();
      useLayoutEffect(() => {
        latest = ctx;
      });
      useEffect(() => {
        mountCount += 1;
      }, []);
      return <span>{ctx.nursesList.join(',')}</span>;
    };

    render(
      <DeferredStaffProvider loader={loader}>
        <Consumer />
      </DeferredStaffProvider>
    );

    expect(mountCount).toBe(1);
    expect(latest).toMatchObject({
      nursesList: [],
      nursesLoading: true,
      tensList: [],
      tensLoading: true,
      professionalsCatalog: [],
      professionalsLoading: true,
      nursesCatalogUnavailable: false,
      tensCatalogUnavailable: false,
    });

    await act(async () => {
      resolveLoader(FakeStaffProvider);
    });

    await waitFor(() => {
      expect(latest?.nursesLoading).toBe(false);
    });

    expect(mountCount).toBe(1);
    expect(latest).toMatchObject({
      nursesList: ['Enfermera Sintética'],
      tensList: ['TENS Sintético'],
      professionalsCatalog: [{ name: 'Médico Sintético', phone: '' }],
    });
  });

  it('replays manager modal toggles made before StaffProvider finishes loading', async () => {
    const { loader, resolveLoader } = createDeferredLoader();
    let latest: StaffContextType | undefined;

    const Consumer = () => {
      const ctx = useStaffContext();
      useLayoutEffect(() => {
        latest = ctx;
      });
      return null;
    };

    render(
      <DeferredStaffProvider loader={loader}>
        <Consumer />
      </DeferredStaffProvider>
    );

    act(() => {
      latest?.setShowNurseManager(true);
      latest?.setShowTensManager(true);
    });

    expect(latest?.showNurseManager).toBe(true);
    expect(latest?.showTensManager).toBe(true);

    await act(async () => {
      resolveLoader(FakeStaffProvider);
    });

    await waitFor(() => {
      expect(latest?.nursesLoading).toBe(false);
      expect(latest?.showNurseManager).toBe(true);
      expect(latest?.showTensManager).toBe(true);
    });
  });

  it('marks catalogs unavailable on load failure and recovers on retry (SAVE-01)', async () => {
    let shouldFail = true;
    const loader = vi.fn(async () => {
      if (shouldFail) {
        throw new Error('chunk load failed');
      }
      return FakeStaffProvider;
    });
    let latest: StaffContextType | undefined;

    const Consumer = () => {
      const ctx = useStaffContext();
      useLayoutEffect(() => {
        latest = ctx;
      });
      return null;
    };

    render(
      <DeferredStaffProvider loader={loader}>
        <Consumer />
      </DeferredStaffProvider>
    );

    await waitFor(() => {
      expect(latest?.nursesCatalogUnavailable).toBe(true);
      expect(latest?.tensCatalogUnavailable).toBe(true);
      expect(latest?.nursesLoading).toBe(false);
    });

    shouldFail = false;
    act(() => {
      latest?.retryNursesCatalog?.();
    });

    await waitFor(() => {
      expect(latest?.nursesList).toEqual(['Enfermera Sintética']);
      expect(latest?.nursesLoading).toBe(false);
    });
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
