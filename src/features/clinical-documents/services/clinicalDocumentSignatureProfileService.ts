import { firestoreDb, type IDatabaseProvider } from '@/services/storage/firestore';
import { isFirestoreEnabled } from '@/services/repositories/repositoryConfig';

export interface ClinicalDocumentSignatureProfile {
  uid: string;
  email: string;
  displayName: string;
  specialty: string;
  updatedAt: string;
}

export interface ClinicalDocumentSignatureProfileInput {
  uid: string;
  email?: string | null;
  displayName: string;
  specialty: string;
}

interface UserSettingsDocument {
  clinicalSignatureProfile?: Partial<ClinicalDocumentSignatureProfile>;
}

const USER_SETTINGS_COLLECTION = 'userSettings';
const LOCAL_SIGNATURE_PROFILE_STORAGE_KEY = 'hhr_clinical_signature_profiles_v1';

const normalizeSignatureText = (value: string): string => value.trim().replace(/\s+/g, ' ');

const readLocalProfiles = (): Record<string, ClinicalDocumentSignatureProfile> => {
  try {
    const raw = globalThis.localStorage?.getItem(LOCAL_SIGNATURE_PROFILE_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, ClinicalDocumentSignatureProfile>) : {};
  } catch {
    return {};
  }
};

const writeLocalProfile = (profile: ClinicalDocumentSignatureProfile): void => {
  try {
    const profiles = readLocalProfiles();
    globalThis.localStorage?.setItem(
      LOCAL_SIGNATURE_PROFILE_STORAGE_KEY,
      JSON.stringify({ ...profiles, [profile.uid]: profile })
    );
  } catch {
    // Local-only mode should never block clinical document editing.
  }
};

const parseProfile = (
  uid: string,
  value: Partial<ClinicalDocumentSignatureProfile> | undefined
): ClinicalDocumentSignatureProfile | null => {
  const displayName = normalizeSignatureText(String(value?.displayName || ''));
  const specialty = normalizeSignatureText(String(value?.specialty || ''));
  if (!displayName && !specialty) {
    return null;
  }

  return {
    uid,
    email: String(value?.email || ''),
    displayName,
    specialty,
    updatedAt: String(value?.updatedAt || ''),
  };
};

const buildProfile = (
  input: ClinicalDocumentSignatureProfileInput
): ClinicalDocumentSignatureProfile => ({
  uid: input.uid,
  email: String(input.email || '').trim(),
  displayName: normalizeSignatureText(input.displayName),
  specialty: normalizeSignatureText(input.specialty),
  updatedAt: new Date().toISOString(),
});

export const buildClinicalDocumentSignatureProfileFromDraft = (
  user: { uid?: string; email?: string | null; displayName?: string | null },
  draft: { medico: string; especialidad: string }
): ClinicalDocumentSignatureProfileInput => ({
  uid: String(user.uid || '').trim(),
  email: user.email || '',
  displayName: normalizeSignatureText(draft.medico || user.displayName || ''),
  specialty: normalizeSignatureText(draft.especialidad || ''),
});

export const createClinicalDocumentSignatureProfileService = (
  repository: Pick<IDatabaseProvider, 'getDoc' | 'setDoc'> = firestoreDb
) => ({
  async getProfile(uid: string): Promise<ClinicalDocumentSignatureProfile | null> {
    const normalizedUid = uid.trim();
    if (!normalizedUid) {
      return null;
    }

    if (!isFirestoreEnabled()) {
      return readLocalProfiles()[normalizedUid] || null;
    }

    const settings = await repository.getDoc<UserSettingsDocument>(
      USER_SETTINGS_COLLECTION,
      normalizedUid
    );
    return parseProfile(normalizedUid, settings?.clinicalSignatureProfile);
  },

  async saveProfile(
    input: ClinicalDocumentSignatureProfileInput
  ): Promise<ClinicalDocumentSignatureProfile> {
    const profile = buildProfile(input);
    if (!profile.uid || !profile.displayName || !profile.specialty) {
      throw new Error('Completa nombre y especialidad antes de guardar la firma.');
    }

    if (!isFirestoreEnabled()) {
      writeLocalProfile(profile);
      return profile;
    }

    await repository.setDoc<UserSettingsDocument>(
      USER_SETTINGS_COLLECTION,
      profile.uid,
      { clinicalSignatureProfile: profile },
      { merge: true }
    );
    return profile;
  },
});

export const clinicalDocumentSignatureProfileService =
  createClinicalDocumentSignatureProfileService();
