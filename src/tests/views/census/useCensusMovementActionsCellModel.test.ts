import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useCensusMovementActionsCellModel } from '@/features/census/hooks/useCensusMovementActionsCellModel';
import type { CensusMovementActionDescriptor } from '@/features/census/types/censusMovementActionTypes';

describe('useCensusMovementActionsCellModel', () => {
  it('builds stable view models with keys and icon names', () => {
    const actions: CensusMovementActionDescriptor[] = [
      { kind: 'undo', title: 'Undo', className: 'u', onClick: vi.fn() },
      {
        kind: 'viewDocuments',
        title: 'View docs',
        className: 'v',
        onClick: vi.fn(),
      },
      { kind: 'edit', title: 'Edit', className: 'e', onClick: vi.fn() },
      { kind: 'delete', title: 'Delete', className: 'd', onClick: vi.fn() },
    ];

    const { result } = renderHook(() => useCensusMovementActionsCellModel(actions));

    expect(result.current).toEqual([
      expect.objectContaining({ key: 'undo-0', iconName: 'undo', title: 'Undo' }),
      expect.objectContaining({
        key: 'viewDocuments-1',
        iconName: 'viewDocuments',
        title: 'View docs',
      }),
      expect.objectContaining({ key: 'edit-2', iconName: 'edit', title: 'Edit' }),
      expect.objectContaining({ key: 'delete-3', iconName: 'delete', title: 'Delete' }),
    ]);
  });
});
