import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';
import { useCmaSectionModel } from '@/features/census/hooks/useCmaSectionModel';
import { useCmaSectionActions } from '@/features/census/hooks/useCmaSectionActions';

vi.mock('@/features/census/hooks/useCmaSectionActions', () => ({
  useCmaSectionActions: vi.fn(),
}));

const asHookValue = <T>(value: Partial<T>): T => value as T;

describe('useCmaSectionModel', () => {
  const handleUpdate = vi.fn();
  const handleUndo = vi.fn();
  const handleDelete = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useCmaSectionActions).mockReturnValue(
      asHookValue<ReturnType<typeof useCmaSectionActions>>({
        handleUpdate,
        handleUndo,
        handleDelete,
      })
    );
  });

  it('returns non-renderable state when source cma list is null', () => {
    const { result } = renderHook(() =>
      useCmaSectionModel({
        cma: null,
        confirm: vi.fn(),
        notifyError: vi.fn(),
        updateCMA: vi.fn(),
        updatePatientMultiple: vi.fn(),
        deleteCMA: vi.fn(),
      })
    );

    expect(result.current).toEqual({
      isRenderable: false,
      isEmpty: true,
      items: [],
      handleUpdate,
      handleUndo,
      handleDelete,
    });
  });

  it('returns section state and action handlers for populated cma list', () => {
    const cmaItem = DataFactory.createMockCMA({ id: 'cma-1' });

    const { result } = renderHook(() =>
      useCmaSectionModel({
        cma: [cmaItem],
        confirm: vi.fn(),
        notifyError: vi.fn(),
        updateCMA: vi.fn(),
        updatePatientMultiple: vi.fn(),
        deleteCMA: vi.fn(),
      })
    );

    expect(result.current.isRenderable).toBe(true);
    expect(result.current.isEmpty).toBe(false);
    expect(result.current.items).toEqual([cmaItem]);
    expect(result.current.handleUpdate).toBe(handleUpdate);
    expect(result.current.handleUndo).toBe(handleUndo);
    expect(result.current.handleDelete).toBe(handleDelete);
  });
});
