import { doc, runTransaction } from 'firebase/firestore';
import { firestoreDb } from '@/services/storage/firestore';
import { defaultFirestoreServiceRuntime } from '@/services/storage/firestore/firestoreServiceRuntime';
import {
  getActiveHospitalId,
  getWoundCareMobileUploadSessionsPath,
} from '@/constants/firestorePaths';
import type { WoundCareAuditActor, WoundCareMobileUploadSession } from '@/types/domain/woundCare';
import { safeParseWoundCareMobileUploadSession } from '@/features/wound-care/schemas/woundCare';

const sanitizeForFirestore = <T>(value: T): T => {
  if (Array.isArray(value)) {
    return value.map(item => sanitizeForFirestore(item)).filter(item => item !== undefined) as T;
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, nested]) => nested !== undefined)
        .map(([key, nested]) => [key, sanitizeForFirestore(nested)])
    ) as T;
  }

  return value;
};

export const WoundCareMobileUploadSessionRepository = {
  async getById(
    sessionId: string,
    hospitalId: string = getActiveHospitalId()
  ): Promise<WoundCareMobileUploadSession | null> {
    const session = await firestoreDb.getDoc<WoundCareMobileUploadSession>(
      getWoundCareMobileUploadSessionsPath(hospitalId),
      sessionId
    );
    if (!session) return null;

    const parsed = safeParseWoundCareMobileUploadSession(session);
    return parsed.success ? (parsed.data as WoundCareMobileUploadSession) : null;
  },

  async listByEpisode(
    episodeKey: string,
    hospitalId: string = getActiveHospitalId()
  ): Promise<WoundCareMobileUploadSession[]> {
    const rawSessions = await firestoreDb.getDocs<Record<string, unknown>>(
      getWoundCareMobileUploadSessionsPath(hospitalId),
      {
        where: [{ field: 'episodeKey', operator: '==', value: episodeKey }],
        source: 'server',
      }
    );

    const sessions: WoundCareMobileUploadSession[] = [];
    let invalidActiveCount = 0;

    for (const raw of rawSessions) {
      const parsed = safeParseWoundCareMobileUploadSession(raw);
      if (parsed.success) {
        sessions.push(parsed.data as WoundCareMobileUploadSession);
      } else if (!raw.revokedAt) {
        invalidActiveCount += 1;
      }
    }

    if (invalidActiveCount > 0) {
      throw new Error(
        `No se pudieron validar ${invalidActiveCount} sesiones móviles activas del episodio.`
      );
    }

    return sessions;
  },

  async create(
    session: WoundCareMobileUploadSession,
    hospitalId: string = getActiveHospitalId()
  ): Promise<WoundCareMobileUploadSession> {
    const sanitized = sanitizeForFirestore(session);
    await firestoreDb.setDoc(
      getWoundCareMobileUploadSessionsPath(hospitalId),
      session.sessionId,
      sanitized
    );
    return sanitized;
  },

  async revoke(
    sessionId: string,
    patch: { revokedAt: string; revokedBy: WoundCareAuditActor },
    hospitalId: string = getActiveHospitalId()
  ): Promise<void> {
    const db = defaultFirestoreServiceRuntime.getDb();
    if (!db) {
      throw new Error('Firestore instance is not available yet.');
    }

    const sessionRef = doc(db, getWoundCareMobileUploadSessionsPath(hospitalId), sessionId);
    await runTransaction(db, async transaction => {
      const snapshot = await transaction.get(sessionRef);
      if (!snapshot.exists()) {
        throw new Error('El acceso móvil no existe.');
      }

      const existing = snapshot.data() as Record<string, unknown> | undefined;
      if (existing?.revokedAt != null && existing.revokedAt !== '') {
        // Preserve the first confirmed revocation author and timestamp atomically.
        return;
      }

      transaction.update(sessionRef, {
        revokedAt: patch.revokedAt,
        revokedBy: sanitizeForFirestore(patch.revokedBy),
      });
    });
  },
};
