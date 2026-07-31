import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTreatingPhysicianCatalogSync } from '@/features/rayen-import/hooks/useTreatingPhysicianCatalogSync';
import type { RayenCensusSnapshot } from '@/features/rayen-import/contracts/rayenSnapshot';

const staffQuery = vi.hoisted(() => ({
  catalog: undefined as Array<{ name: string; phone: string }> | undefined,
  isSuccess: false,
  save: vi.fn(),
}));

vi.mock('@/hooks/useStaffQuery', () => ({
  useProfessionalsQuery: () => ({ data: staffQuery.catalog, isSuccess: staffQuery.isSuccess }),
  useSaveProfessionalsMutation: () => ({ mutate: staffQuery.save }),
}));

const snapshot: RayenCensusSnapshot = {
  capturedAt: '2026-07-31T12:00:00.000Z',
  facilityId: 1342,
  encounters: [],
  physicians: [{ practitionerId: '7947', displayName: 'Angelica Vargas' }],
};

describe('useTreatingPhysicianCatalogSync', () => {
  beforeEach(() => {
    staffQuery.catalog = undefined;
    staffQuery.isSuccess = false;
    staffQuery.save.mockReset();
  });

  it('does not replace the shared catalog before its authoritative query succeeds', () => {
    const { result } = renderHook(() => useTreatingPhysicianCatalogSync());

    expect(result.current(snapshot)).toBe(snapshot);
    expect(staffQuery.save).not.toHaveBeenCalled();
  });

  it('persists physicians discovered after the catalog has loaded', () => {
    staffQuery.catalog = [{ name: 'Médico local', phone: '123' }];
    staffQuery.isSuccess = true;
    const { result } = renderHook(() => useTreatingPhysicianCatalogSync());

    result.current(snapshot);

    expect(staffQuery.save).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Angelica Vargas',
          rayenPractitionerId: '7947',
          source: 'rayen',
        }),
        expect.objectContaining({ name: 'Médico local', phone: '123' }),
      ])
    );
  });
});
