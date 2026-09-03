import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useInitialLabViewerAutoSearch } from '@/features/laboratory/hooks/useInitialLabViewerAutoSearch';
import type { SyslabAccessModel } from '@/features/laboratory/hooks/useSyslabAccess';

describe('useInitialLabViewerAutoSearch', () => {
  it('waits for Syslab and searches the initial patient only once per opening', () => {
    const search = vi.fn().mockResolvedValue(undefined);
    const initialProps = {
      isOpen: true,
      enabled: true,
      initialPatientRut: '12345678-9',
      accessState: 'checking' as SyslabAccessModel['state'],
      search,
    };
    const { rerender } = renderHook(props => useInitialLabViewerAutoSearch(props), {
      initialProps,
    });

    expect(search).not.toHaveBeenCalled();

    rerender({ ...initialProps, accessState: 'connected' });
    expect(search).toHaveBeenCalledTimes(1);

    rerender({ ...initialProps, accessState: 'connected' });
    expect(search).toHaveBeenCalledTimes(1);

    rerender({ ...initialProps, isOpen: false });
    rerender({ ...initialProps, isOpen: true, accessState: 'connected' });
    expect(search).toHaveBeenCalledTimes(2);
  });

  it('does not search when automatic loading is disabled or the RUT is missing', () => {
    const search = vi.fn().mockResolvedValue(undefined);
    const initialProps = {
      isOpen: true,
      enabled: false,
      initialPatientRut: '12345678-9' as string | undefined,
      accessState: 'connected' as const,
      search,
    };
    const { rerender } = renderHook(props => useInitialLabViewerAutoSearch(props), {
      initialProps,
    });

    rerender({ ...initialProps, enabled: true, initialPatientRut: undefined });

    expect(search).not.toHaveBeenCalled();
  });
});
