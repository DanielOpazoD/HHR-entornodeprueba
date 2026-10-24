/**
 * Wound Care Consent Repository
 *
 * Firestore CRUD and real-time subscriptions for informed consent records.
 * One active (signed) consent per hospitalization episode is expected.
 * All reads are validated through {@link safeParseWoundCareConsent};
 * invalid records are logged via operational telemetry and silently dropped.
 */

import { firestoreDb } from '@/services/storage/firestore';
import { getActiveHospitalId, getWoundCareConsentsPath } from '@/constants/firestorePaths';
import type { WoundCareConsent } from '@/types/domain/woundCare';
import { safeParseWoundCareConsent } from '@/schemas/zod/woundCare';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';

// ============================================================================
// Helpers
// ============================================================================

const sanitizeForFirestore = <T>(value: T): T => {
  if (Array.isArray(value)) {
    return value
      .map(item => sanitizeForFirestore(item))
      .filter(item => item !== undefined) as unknown as T;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, nested]) => nested !== undefined)
      .map(([key, nested]) => [key, sanitizeForFirestore(nested)]);
    return Object.fromEntries(entries) as T;
  }

  return value;
};

const validateReadConsent = (record: WoundCareConsent): WoundCareConsent | null => {
  const parsed = safeParseWoundCareConsent(record);
  if (!parsed.success) {
    recordOperationalTelemetry({
      category: 'clinical_document',
      status: 'failed',
      operation: 'consent_repository_invalid_read_record',
      issues: parsed.error.issues.map(
        issue => `${issue.path.map(String).join('.')}: ${issue.message}`
      ),
      context: { consentId: record.id, episodeKey: record.episodeKey },
    });
    return null;
  }
  return parsed.data as WoundCareConsent;
};

// ============================================================================
// Repository
// ============================================================================

export const WoundCareConsentRepository = {
  /**
   * Return the signed consent for a hospitalization episode, or `null` if none exists.
   *
   * Only consents with `status === 'signed'` are returned. Revoked or
   * otherwise non-signed records are ignored.
   *
   * @param episodeKey - Composite key identifying the hospitalization episode.
   * @param hospitalId - Defaults to the active hospital.
   */
  async getByEpisode(
    episodeKey: string,
    hospitalId: string = getActiveHospitalId()
  ): Promise<WoundCareConsent | null> {
    const documents = await firestoreDb.getDocs<WoundCareConsent>(
      getWoundCareConsentsPath(hospitalId),
      {
        where: [
          { field: 'episodeKey', operator: '==', value: episodeKey },
          { field: 'status', operator: '==', value: 'signed' },
        ],
      }
    );

    if (documents.length === 0) return null;

    return validateReadConsent(documents[0]);
  },

  /**
   * Return any consent for a hospitalization episode, preferring signed over revoked.
   *
   * Unlike {@link getByEpisode}, this also returns revoked consents when no
   * signed consent exists, which is useful for displaying consent history.
   *
   * @param episodeKey - Composite key identifying the hospitalization episode.
   * @param hospitalId - Defaults to the active hospital.
   */
  async getAnyByEpisode(
    episodeKey: string,
    hospitalId: string = getActiveHospitalId()
  ): Promise<WoundCareConsent | null> {
    const documents = await firestoreDb.getDocs<WoundCareConsent>(
      getWoundCareConsentsPath(hospitalId),
      {
        where: [{ field: 'episodeKey', operator: '==', value: episodeKey }],
      }
    );

    if (documents.length === 0) return null;

    // Prefer signed over other statuses
    const signed = documents.find(d => d.status === 'signed');
    const record = signed ?? documents[0];
    return validateReadConsent(record);
  },

  /**
   * Return all consent records across every hospitalization episode for a patient.
   *
   * Used by the history view to display consent status per episode.
   * Invalid records are silently filtered out after Zod validation.
   *
   * @param patientRut - Chilean RUT of the patient.
   * @param hospitalId - Defaults to the active hospital.
   */
  async listByPatientRut(
    patientRut: string,
    hospitalId: string = getActiveHospitalId()
  ): Promise<WoundCareConsent[]> {
    const documents = await firestoreDb.getDocs<WoundCareConsent>(
      getWoundCareConsentsPath(hospitalId),
      {
        where: [{ field: 'patientRut', operator: '==', value: patientRut }],
      }
    );

    return documents
      .map(doc => validateReadConsent(doc))
      .filter((doc): doc is WoundCareConsent => Boolean(doc));
  },

  /**
   * Create a new consent record in Firestore.
   *
   * The consent object is sanitized (undefined values stripped) before
   * writing to avoid Firestore serialization errors.
   *
   * @param consent    - Fully populated consent object including its `id`.
   * @param hospitalId - Defaults to the active hospital.
   * @returns The sanitized consent as persisted.
   */
  async create(
    consent: WoundCareConsent,
    hospitalId: string = getActiveHospitalId()
  ): Promise<WoundCareConsent> {
    const sanitized = sanitizeForFirestore(consent);
    await firestoreDb.setDoc(getWoundCareConsentsPath(hospitalId), consent.id, sanitized);
    return sanitized;
  },

  /**
   * Mark an existing consent as revoked with audit data.
   *
   * Sets `status` to `'revoked'` and writes the revocation timestamp,
   * actor, and reason. Does not delete the underlying Storage file.
   *
   * @param consentId  - Firestore document ID of the consent.
   * @param patch      - Revocation details (timestamp, actor, reason).
   * @param hospitalId - Defaults to the active hospital.
   */
  async revoke(
    consentId: string,
    patch: {
      revokedAt: string;
      revokedBy: WoundCareConsent['revokedBy'];
      revocationReason: string;
    },
    hospitalId: string = getActiveHospitalId()
  ): Promise<void> {
    await firestoreDb.updateDoc(getWoundCareConsentsPath(hospitalId), consentId, {
      status: 'revoked',
      revokedAt: patch.revokedAt,
      revokedBy: patch.revokedBy ? sanitizeForFirestore(patch.revokedBy) : undefined,
      revocationReason: patch.revocationReason,
    });
  },

  /**
   * Subscribe to real-time consent updates for a hospitalization episode.
   *
   * The callback receives the current consent (preferring signed) or `null`
   * when no consent exists. Fires immediately with the current state, then
   * on every Firestore snapshot change.
   *
   * @param episodeKey - Composite key identifying the hospitalization episode.
   * @param callback   - Invoked on each snapshot with the resolved consent.
   * @param hospitalId - Defaults to the active hospital.
   * @returns An unsubscribe function to tear down the listener.
   */
  subscribeByEpisode(
    episodeKey: string,
    callback: (consent: WoundCareConsent | null) => void,
    hospitalId: string = getActiveHospitalId()
  ): () => void {
    return firestoreDb.subscribeQuery<WoundCareConsent>(
      getWoundCareConsentsPath(hospitalId),
      { where: [{ field: 'episodeKey', operator: '==', value: episodeKey }] },
      docs => {
        if (docs.length === 0) {
          callback(null);
          return;
        }
        const signed = docs.find(d => d.status === 'signed');
        const record = signed ?? docs[0];
        callback(validateReadConsent(record));
      }
    );
  },
};
