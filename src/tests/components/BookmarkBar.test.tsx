import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

const mockSubscribeToBookmarks = vi.fn();
const mockAddBookmark = vi.fn();
const mockUpdateBookmark = vi.fn();
const mockExportBookmarksToJson = vi.fn();

const mockOpenFilePicker = vi.fn();
const mockHandleFileChange = vi.fn();

vi.mock('@/services/bookmarks/bookmarkService', () => ({
  subscribeToBookmarks: (...args: unknown[]) => mockSubscribeToBookmarks(...args),
  addBookmark: (...args: unknown[]) => mockAddBookmark(...args),
  updateBookmark: (...args: unknown[]) => mockUpdateBookmark(...args),
  exportBookmarksToJson: (...args: unknown[]) => mockExportBookmarksToJson(...args),
}));

vi.mock('@/components/bookmarks/hooks/useBookmarkBarPreferences', () => ({
  useBookmarkBarPreferences: () => ({
    alignment: 'left',
    customOffset: 50,
    alignmentClass: 'justify-start',
    customPaddingStyle: undefined,
    setAlignmentPreference: vi.fn(),
    setCustomOffsetPreference: vi.fn(),
  }),
}));

vi.mock('@/components/bookmarks/hooks/useBookmarkImport', () => ({
  useBookmarkImport: () => ({
    fileInputRef: { current: null },
    handleFileChange: mockHandleFileChange,
    openFilePicker: mockOpenFilePicker,
    isImporting: false,
  }),
}));

vi.mock('@/components/bookmarks/BookmarkEditorModal', () => ({
  BookmarkEditorModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="bookmark-editor-modal">editor</div> : null,
}));

vi.mock('@/components/bookmarks/BookmarkManagerModal', () => ({
  BookmarkManagerModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="bookmark-manager-modal">manager</div> : null,
}));

import { BookmarkBar } from '@/components/bookmarks/BookmarkBar';

describe('BookmarkBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockSubscribeToBookmarks.mockImplementation((onUpdate: (bookmarks: unknown[]) => void) => {
      onUpdate([
        { id: 'b1', name: 'Intranet', url: 'https://intranet', icon: '🔗', notes: '' },
        { id: 'b2', name: 'Lab', url: 'https://lab', icon: '📋', notes: '' },
      ]);
      return vi.fn();
    });
  });

  it('opens actions menu from configuration button', () => {
    render(<BookmarkBar />);

    expect(screen.queryByText('Importar JSON')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Configuración'));

    expect(screen.getByText('Importar JSON')).toBeInTheDocument();
    expect(screen.getByText('Exportar JSON')).toBeInTheDocument();
  });

  it('runs import and export actions from menu', () => {
    render(<BookmarkBar />);

    fireEvent.click(screen.getByTitle('Configuración'));

    fireEvent.click(screen.getByText('Importar JSON'));
    expect(mockOpenFilePicker).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('Exportar JSON'));
    expect(mockExportBookmarksToJson).toHaveBeenCalledTimes(1);
  });
});
