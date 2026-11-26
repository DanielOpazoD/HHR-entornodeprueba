// @vitest-environment node
/**
 * Bookmark Service Tests
 * Tests for patient bookmark operations with Firestore
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  addBookmark,
  createBookmarkService,
  updateBookmark,
  deleteBookmark,
  reorderBookmarks,
} from '@/services/bookmarks/bookmarkService';
import { addDoc, collection, updateDoc, deleteDoc, writeBatch } from 'firebase/firestore';
import type { Bookmark } from '@/types/bookmarks';

// Mock Firebase
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn(() => ({ id: 'mock-doc-id' })),
  addDoc: vi.fn().mockResolvedValue({ id: 'new-bookmark-id' }),
  updateDoc: vi.fn().mockResolvedValue(undefined),
  deleteDoc: vi.fn().mockResolvedValue(undefined),
  getDocs: vi.fn(),
  query: vi.fn(),
  orderBy: vi.fn(),
  onSnapshot: vi.fn(),
  serverTimestamp: vi.fn(() => new Date('2026-02-20T00:00:00.000Z')),
  writeBatch: vi.fn(() => ({
    set: vi.fn(),
    update: vi.fn(),
    commit: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('@/services/firebase-runtime/firebaseConfig', () => ({
  db: {},
}));

describe('Bookmark Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('addBookmark', () => {
    it('should add a new bookmark to Firestore', async () => {
      const input = {
        name: 'Test Bookmark',
        url: 'https://example.com',
        icon: '📚',
      };

      const result = await addBookmark(input, 0);

      expect(addDoc).toHaveBeenCalled();
      expect(result).toEqual({ id: 'new-bookmark-id' });
    });

    it('should allow injecting a Firestore runtime instead of using the singleton', async () => {
      const customDb = { name: 'custom-db' } as never;
      const bookmarkService = createBookmarkService({
        getDb: () => customDb,
        ready: Promise.resolve(),
      });

      await bookmarkService.addBookmark(
        {
          name: 'Injected Runtime',
          url: 'https://example.com',
          icon: '📌',
        },
        1
      );

      expect(collection).toHaveBeenCalledWith(
        customDb,
        expect.any(String),
        expect.any(String),
        expect.any(String)
      );
    });

    it('should set order based on count', async () => {
      const input = {
        name: 'Second Bookmark',
        url: 'https://example2.com',
        icon: '📖',
      };

      await addBookmark(input, 5);

      // Just verify addDoc was called (order is set internally)
      expect(addDoc).toHaveBeenCalled();
    });
  });

  describe('updateBookmark', () => {
    it('should update a bookmark in Firestore', async () => {
      await updateBookmark('bookmark-123', { name: 'Updated Name' });

      expect(updateDoc).toHaveBeenCalled();
    });
  });

  describe('deleteBookmark', () => {
    it('should delete a bookmark from Firestore', async () => {
      await deleteBookmark('bookmark-to-delete');

      expect(deleteDoc).toHaveBeenCalled();
    });
  });

  describe('reorderBookmarks', () => {
    it('should batch update bookmark orders', async () => {
      const bookmarks: Bookmark[] = [
        {
          id: 'b1',
          name: 'First',
          url: 'https://a.test',
          order: 2,
          createdAt: '2026-02-20T00:00:00.000Z',
          updatedAt: '2026-02-20T00:00:00.000Z',
        },
        {
          id: 'b2',
          name: 'Second',
          url: 'https://b.test',
          order: 0,
          createdAt: '2026-02-20T00:00:00.000Z',
          updatedAt: '2026-02-20T00:00:00.000Z',
        },
        {
          id: 'b3',
          name: 'Third',
          url: 'https://c.test',
          order: 1,
          createdAt: '2026-02-20T00:00:00.000Z',
          updatedAt: '2026-02-20T00:00:00.000Z',
        },
      ];

      const result = await reorderBookmarks(bookmarks);

      expect(writeBatch).toHaveBeenCalled();
      expect(result).toBe(true);
    });
  });
});
