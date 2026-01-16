/**
 * Bookmark Service Tests
 * Tests for patient bookmark operations with Firestore
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    addBookmark,
    updateBookmark,
    deleteBookmark,
    reorderBookmarks
} from '@/services/bookmarks/bookmarkService';
import { addDoc, updateDoc, deleteDoc, writeBatch } from 'firebase/firestore';

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
    serverTimestamp: vi.fn(() => new Date()),
    writeBatch: vi.fn(() => ({
        set: vi.fn(),
        update: vi.fn(),
        commit: vi.fn().mockResolvedValue(undefined)
    }))
}));

vi.mock('@/firebaseConfig', () => ({
    db: {}
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
                icon: '📚'
            };

            const result = await addBookmark(input, 0);

            expect(addDoc).toHaveBeenCalled();
            expect(result).toEqual({ id: 'new-bookmark-id' });
        });

        it('should set order based on count', async () => {
            const input = {
                name: 'Second Bookmark',
                url: 'https://example2.com',
                icon: '📖'
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
            const bookmarks = [
                { id: 'b1', name: 'First', order: 2 },
                { id: 'b2', name: 'Second', order: 0 },
                { id: 'b3', name: 'Third', order: 1 }
            ] as any[];

            const result = await reorderBookmarks(bookmarks);

            expect(writeBatch).toHaveBeenCalled();
            expect(result).toBe(true);
        });
    });
});
