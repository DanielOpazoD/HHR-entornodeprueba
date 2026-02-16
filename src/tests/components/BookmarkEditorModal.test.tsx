import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const mockAlert = vi.fn();

vi.mock('@/shared/runtime/browserWindowRuntime', () => ({
  defaultBrowserWindowRuntime: {
    alert: (...args: unknown[]) => mockAlert(...args),
  },
}));

import { BookmarkEditorModal } from '@/components/bookmarks/BookmarkEditorModal';

describe('BookmarkEditorModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows runtime alert when save fails', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('save failed'));

    render(<BookmarkEditorModal isOpen={true} onClose={vi.fn()} onSave={onSave} />);

    fireEvent.change(screen.getByPlaceholderText('Ej: Fonasa'), { target: { value: 'Sistema' } });
    fireEvent.change(screen.getByPlaceholderText('ejemplo.cl'), { target: { value: 'test.cl' } });

    fireEvent.click(screen.getByRole('button', { name: 'Crear' }));

    await waitFor(() => {
      expect(mockAlert).toHaveBeenCalledWith('No se pudo guardar el marcador. Intente nuevamente.');
    });
  });
});
