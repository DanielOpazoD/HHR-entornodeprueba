import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ChangeEvent } from 'react';

const mockImportBookmarksFromJson = vi.fn();
const mockAlert = vi.fn();

vi.mock('@/services/bookmarks/bookmarkService', () => ({
  importBookmarksFromJson: (...args: unknown[]) => mockImportBookmarksFromJson(...args),
}));

vi.mock('@/shared/runtime/browserWindowRuntime', () => ({
  defaultBrowserWindowRuntime: {
    alert: (...args: unknown[]) => mockAlert(...args),
  },
}));

import { useBookmarkImport } from '@/components/bookmarks/hooks/useBookmarkImport';

describe('useBookmarkImport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('imports file and shows success alert', async () => {
    mockImportBookmarksFromJson.mockResolvedValue(undefined);

    const { result } = renderHook(() => useBookmarkImport());
    const file = { text: vi.fn().mockResolvedValue('[{"name":"X"}]') } as unknown as File;
    const event = { target: { files: [file] } } as unknown as ChangeEvent<HTMLInputElement>;

    await act(async () => {
      await result.current.handleFileChange(event);
    });

    expect(mockImportBookmarksFromJson).toHaveBeenCalledWith('[{"name":"X"}]');
    expect(mockAlert).toHaveBeenCalledWith('Marcadores importados con éxito');
    expect(result.current.isImporting).toBe(false);
  });

  it('shows error alert when import fails', async () => {
    mockImportBookmarksFromJson.mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useBookmarkImport());
    const file = { text: vi.fn().mockResolvedValue('invalid') } as unknown as File;
    const event = { target: { files: [file] } } as unknown as ChangeEvent<HTMLInputElement>;

    await act(async () => {
      await result.current.handleFileChange(event);
    });

    expect(mockAlert).toHaveBeenCalledWith('Error al importar marcadores');
    expect(result.current.isImporting).toBe(false);
  });
});
