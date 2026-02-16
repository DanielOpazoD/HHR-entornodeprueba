import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { BookmarkBarActionsMenu } from '@/components/bookmarks/BookmarkBarActionsMenu';

describe('BookmarkBarActionsMenu', () => {
  it('renders closed state and triggers toggle', () => {
    const onToggle = vi.fn();

    render(
      <BookmarkBarActionsMenu
        bookmarksCount={3}
        alignment="left"
        customOffset={40}
        isOpen={false}
        onToggle={onToggle}
        onClose={vi.fn()}
        onOpenManager={vi.fn()}
        onImport={vi.fn()}
        onExport={vi.fn()}
        onAlignmentChange={vi.fn()}
        onCustomOffsetChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByTitle('Configuración'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('runs callbacks from open menu actions', () => {
    const onClose = vi.fn();
    const onOpenManager = vi.fn();
    const onImport = vi.fn();
    const onExport = vi.fn();
    const onAlignmentChange = vi.fn();

    render(
      <BookmarkBarActionsMenu
        bookmarksCount={7}
        alignment="left"
        customOffset={20}
        isOpen={true}
        onToggle={vi.fn()}
        onClose={onClose}
        onOpenManager={onOpenManager}
        onImport={onImport}
        onExport={onExport}
        onAlignmentChange={onAlignmentChange}
        onCustomOffsetChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText('Gestionar Marcadores'));
    expect(onOpenManager).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('Importar JSON'));
    expect(onImport).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('Exportar JSON'));
    expect(onExport).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTitle('Centro'));
    expect(onAlignmentChange).toHaveBeenCalledWith('center');

    fireEvent.click(screen.getByText('Total: 7 marcadores'));
    expect(onClose).not.toHaveBeenCalled();
  });
});
