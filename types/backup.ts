/**
 * Backup Files Types
 * Types for the cloud backup files system
 */

/**
 * Types of files that can be backed up
 */
export type BackupFileType = 'NURSING_HANDOFF' | 'MEDICAL_HANDOFF' | 'CENSUS';

/**
 * Shift types for handoff backups
 */
export type BackupShiftType = 'day' | 'night';

/**
 * Backup statistics
 */
export interface BackupStats {
    totalRecords: number;
}

/**
 * User information for audit trail
 */
export interface BackupCreator {
    uid: string;
    email: string;
    name: string;
}

/**
 * Metadata for handoff backups
 */
export interface HandoffBackupMetadata {
    deliveryStaff: string;
    receivingStaff: string;
    patientCount: number;
    shiftType: BackupShiftType;
}

/**
 * Generic metadata (extensible for other backup types)
 */
export interface BackupFileMetadata extends Partial<HandoffBackupMetadata> {
    [key: string]: unknown;
}

/**
 * Full backup file with content (for viewing/restoring)
 */
export interface BackupFile {
    id: string;
    type: BackupFileType;
    shiftType?: BackupShiftType;
    date: string;                    // YYYY-MM-DD format
    title: string;                   // Display title
    createdAt: string;               // ISO timestamp
    createdBy: BackupCreator;
    metadata: BackupFileMetadata;
    content: Record<string, unknown>; // Snapshot of the data
}

/**
 * Backup file preview (for listing without loading full content)
 */
export interface BackupFilePreview extends Omit<BackupFile, 'content'> {
    // Used for list views to avoid loading large content
}

/**
 * Data needed to create a new backup
 */
export interface CreateBackupData {
    type: BackupFileType;
    shiftType?: BackupShiftType;
    date: string;
    title: string;
    metadata: BackupFileMetadata;
    content: Record<string, unknown>;
}

/**
 * Filter options for listing backups
 */
export interface BackupFilters {
    type?: BackupFileType;
    shiftType?: BackupShiftType;
    dateFrom?: string;
    dateTo?: string;
    searchQuery?: string;
}

/**
 * Configuration for backup file types
 */
export const BACKUP_TYPE_CONFIG: Record<BackupFileType, {
    label: string;
    icon: string;
    color: string;
}> = {
    NURSING_HANDOFF: {
        label: 'Entrega Enfermería',
        icon: '🏥',
        color: 'teal'
    },
    MEDICAL_HANDOFF: {
        label: 'Entrega Médicos',
        icon: '🩺',
        color: 'blue'
    },
    CENSUS: {
        label: 'Censo Diario',
        icon: '📋',
        color: 'purple'
    }
};

/**
 * Configuration for shift types
 */
export const SHIFT_TYPE_CONFIG: Record<BackupShiftType, {
    label: string;
    shortLabel: string;
}> = {
    day: {
        label: 'Turno Largo',
        shortLabel: 'Día'
    },
    night: {
        label: 'Turno Noche',
        shortLabel: 'Noche'
    }
};
