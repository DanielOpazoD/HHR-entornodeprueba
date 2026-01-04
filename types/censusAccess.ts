import { Timestamp } from 'firebase/firestore';

export type CensusAccessRole = 'viewer' | 'downloader';

export interface CensusAccessUser {
    id: string;                    // Firebase Auth UID
    email: string;                 // Gmail
    displayName: string;
    role: CensusAccessRole;
    createdAt: Timestamp | Date;
    createdBy: string;             // Admin UID
    lastAccess?: Timestamp | Date;
    expiresAt: Timestamp | Date;
    isActive: boolean;
}

export interface CensusAccessInvitation {
    id: string;                    // Random ID for the link
    email?: string;                // Optional: restricted to this email
    role: CensusAccessRole;
    createdAt: Timestamp | Date;
    createdBy: string;             // Admin UID
    expiresAt: Timestamp | Date;   // End of next month
    status: 'pending' | 'used' | 'expired';
    usedBy?: string;               // UID of the user who redeemed it
}

export interface CensusAccessLog {
    id: string;
    userId: string;
    email: string;
    action: 'list_files' | 'download_file' | 'view_file';
    filePath?: string;
    fileName?: string;
    timestamp: Timestamp | Date;
    userAgent?: string;
}

export interface CensusAuthorizedEmail {
    email: string;
    role: CensusAccessRole;
    addedAt: Timestamp | Date;
    addedBy: string;
}

