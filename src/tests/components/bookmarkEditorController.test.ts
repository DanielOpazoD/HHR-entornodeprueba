import { describe, expect, it } from 'vitest';
import {
  buildBookmarkInput,
  createBookmarkEditorInitialState,
  DEFAULT_BOOKMARK_ICON,
  normalizeBookmarkUrl,
} from '@/components/bookmarks/controllers/bookmarkEditorController';

describe('bookmarkEditorController', () => {
  it('builds empty initial state when initialData is missing', () => {
    expect(createBookmarkEditorInitialState()).toEqual({
      name: '',
      url: '',
      icon: DEFAULT_BOOKMARK_ICON,
      notes: '',
    });
  });

  it('builds initial state from bookmark data', () => {
    expect(
      createBookmarkEditorInitialState({
        id: 'a1',
        name: 'Fonasa',
        url: 'https://fonasa.cl',
        icon: '🏥',
        notes: 'credenciales',
        order: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      })
    ).toEqual({
      name: 'Fonasa',
      url: 'https://fonasa.cl',
      icon: '🏥',
      notes: 'credenciales',
    });
  });

  it('normalizes url by trimming and adding protocol when needed', () => {
    expect(normalizeBookmarkUrl(' ejemplo.cl ')).toBe('https://ejemplo.cl');
    expect(normalizeBookmarkUrl('http://intranet.local')).toBe('http://intranet.local');
    expect(normalizeBookmarkUrl('')).toBe('');
  });

  it('builds BookmarkInput with normalized url', () => {
    expect(
      buildBookmarkInput({
        name: 'Extranet',
        url: 'extranet.hospital.cl',
        icon: '📋',
        notes: 'ok',
      })
    ).toEqual({
      name: 'Extranet',
      url: 'https://extranet.hospital.cl',
      icon: '📋',
      notes: 'ok',
    });
  });
});
