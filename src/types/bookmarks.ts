/**
 * Bookmarks Types
 * Defines the structure for favorites/bookmarks in the application.
 */

export interface Bookmark {
    id: string;
    name: string;
    url: string;
    icon?: string;     // Emoji or short string identifier for icon
    notes?: string;    // Free text for notes (e.g., credentials)
    order: number;     // For manual sorting
    createdAt: string; // ISO 8601
    updatedAt: string; // ISO 8601
}

export type BookmarkInput = Omit<Bookmark, 'id' | 'createdAt' | 'updatedAt' | 'order'>;
