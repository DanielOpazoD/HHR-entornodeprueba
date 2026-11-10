import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BookmarkManagerModal } from '@/components/bookmarks/BookmarkManagerModal';
import { reorderBookmarks } from '@/services/bookmarks/bookmarkService';
import type { Bookmark } from '@/types/bookmarks';

vi.mock('@/services/bookmarks/bookmarkService', () => ({
  reorderBookmarks: vi.fn().mockResolvedValue(undefined),
  deleteBookmark: vi.fn(),
}));

const bookmarks: Bookmark[] = ['Uno', 'Dos'].map((name, order) => ({
  id: name,
  name,
  url: 'https://example.test',
  order,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}));

describe('BookmarkManagerModal', () => {
  it('keeps the saved order unchanged when closing without edits', () => {
    const onClose = vi.fn();
    render(
      <BookmarkManagerModal isOpen onClose={onClose} bookmarks={bookmarks} onEdit={vi.fn()} />
    );
    expect(
      screen
        .getAllByRole('row')
        .slice(1)
        .map(row => row.textContent)
    ).toEqual(['Unohttps://example.test', 'Doshttps://example.test']);
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(reorderBookmarks).not.toHaveBeenCalled();
  });

  it.each([
    ['Subir', 'Dos', 'Uno'],
    ['Bajar', 'Uno', 'Dos'],
  ])('reorders through the named %s icon', (direction, movable, blocked) => {
    render(
      <BookmarkManagerModal isOpen onClose={vi.fn()} bookmarks={bookmarks} onEdit={vi.fn()} />
    );
    expect(screen.getByRole('button', { name: `${direction} marcador ${blocked}` })).toBeDisabled();
    const button = screen.getByRole('button', { name: `${direction} marcador ${movable}` });
    expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    fireEvent.click(button);
    expect(
      screen
        .getAllByRole('row')
        .slice(1)
        .map(row => row.textContent)
    ).toEqual(['Doshttps://example.test', 'Unohttps://example.test']);
    expect(screen.getByRole('button', { name: 'Guardar Orden' })).toBeInTheDocument();
  });
});
