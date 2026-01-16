import { db } from '../infrastructure/db';

const HEALTH_COLLECTION = 'system_health';
const STATS_DOC = 'stats';
const USERS_SUBCOLLECTION = 'users';

export interface UserHealthStatus {
    uid: string;
    email: string;
    displayName: string;
    lastSeen: string;
    isOnline: boolean;
    isOutdated: boolean;
    pendingMutations: number;
    localErrorCount: number;
    appVersion: string;
    platform: string;
    userAgent: string;
}

export const reportUserHealth = async (status: UserHealthStatus): Promise<void> => {
    try {
        const path = `${STATS_DOC}/${HEALTH_COLLECTION}/${USERS_SUBCOLLECTION}`;
        await db.setDoc(path, status.uid, {
            ...status,
            lastSeen: new Date().toISOString()
        });
    } catch (error) {
        console.error('[HealthService] Failed to report health:', error);
    }
};

export const subscribeToSystemHealth = (onUpdate: (data: UserHealthStatus[]) => void) => {
    const path = `${STATS_DOC}/${HEALTH_COLLECTION}/${USERS_SUBCOLLECTION}`;
    return db.subscribeQuery<UserHealthStatus>(path, {
        orderBy: [{ field: 'lastSeen', direction: 'desc' }],
        limit: 50
    }, (users) => {
        onUpdate(users);
    });
};

export const getSystemHealthSnapshot = async (): Promise<UserHealthStatus[]> => {
    try {
        const path = `${STATS_DOC}/${HEALTH_COLLECTION}/${USERS_SUBCOLLECTION}`;
        return await db.getDocs<UserHealthStatus>(path, {
            orderBy: [{ field: 'lastSeen', direction: 'desc' }],
            limit: 100
        });
    } catch (error) {
        console.error('[HealthService] Failed to fetch health snapshot:', error);
        return [];
    }
};
