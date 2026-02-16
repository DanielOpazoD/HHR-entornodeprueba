import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useCensusMovementActionsCellModel } from '@/features/census/hooks/useCensusMovementActionsCellModel';

describe('useCensusMovementActionsCellModel', () => {
  it('builds stable view models with keys and icon names', () => {
    const actions = [
      { kind: 'undo', title: 'Undo', className: 'u', onClick: vi.fn() },
      { kind: 'edit', title: 'Edit', className: 'e', onClick: vi.fn() },
      { kind: 'delete', title: 'Delete', className: 'd', onClick: vi.fn() },
    ] as const;

    const { result } = renderHook(() => useCensusMovementActionsCellModel(actions as any));

    expect(result.current).toEqual([
      expect.objectContaining({ key: 'undo-0', iconName: 'undo', title: 'Undo' }),
      expect.objectContaining({ key: 'edit-1', iconName: 'edit', title: 'Edit' }),
      expect.objectContaining({ key: 'delete-2', iconName: 'delete', title: 'Delete' }),
    ]);
  });
});
