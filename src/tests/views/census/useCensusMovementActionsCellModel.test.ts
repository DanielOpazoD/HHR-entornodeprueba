import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useCensusMovementActionsCellModel } from '@/features/census/hooks/useCensusMovementActionsCellModel';
import type { CensusMovementActionDescriptor } from '@/features/census/types/censusMovementActionTypes';

describe('useCensusMovementActionsCellModel', () => {
  it('preserves typed actions and builds unique keys', () => {
    const actions: CensusMovementActionDescriptor[] = [
      { kind: 'undo', title: 'Undo', onClick: vi.fn() },
      {
        kind: 'viewDocuments',
        title: 'View docs',
        onClick: vi.fn(),
      },
      { kind: 'edit', title: 'Edit', onClick: vi.fn() },
      { kind: 'delete', title: 'Delete', onClick: vi.fn() },
    ];

    const { result } = renderHook(() => useCensusMovementActionsCellModel(actions));

    expect(result.current).toEqual([
      expect.objectContaining({ key: 'undo-0', kind: 'undo', title: 'Undo' }),
      expect.objectContaining({
        key: 'viewDocuments-1',
        kind: 'viewDocuments',
        title: 'View docs',
      }),
      expect.objectContaining({ key: 'edit-2', kind: 'edit', title: 'Edit' }),
      expect.objectContaining({ key: 'delete-3', kind: 'delete', title: 'Delete' }),
    ]);
  });
});
