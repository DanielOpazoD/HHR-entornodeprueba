import { doc, getDoc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '@/firebaseConfig';
import { ProfessionalCatalogItem } from '@/types';
import { withRetry } from '@/utils/networkUtils';
import {
  COLLECTIONS,
  getActiveHospitalId,
  HOSPITAL_COLLECTIONS,
  SETTINGS_DOCS,
} from '@/constants/firestorePaths';
import { readStringCatalogFromSnapshot } from '@/services/storage/firestore/firestoreShared';

const getSettingsDocRef = (docId: string) =>
  doc(db, COLLECTIONS.HOSPITALS, getActiveHospitalId(), HOSPITAL_COLLECTIONS.SETTINGS, docId);

const getNurseCatalogDocRef = () => getSettingsDocRef(SETTINGS_DOCS.NURSES);
const getTensCatalogDocRef = () => getSettingsDocRef(SETTINGS_DOCS.TENS);
const getProfessionalsCatalogDocRef = () => getSettingsDocRef('professionals_catalog');

const saveStringCatalog = async (
  docRef: ReturnType<typeof getSettingsDocRef>,
  key: 'nurses' | 'tens',
  values: string[]
): Promise<void> => {
  await withRetry(() =>
    setDoc(docRef, {
      list: values,
      [key]: values,
      lastUpdated: new Date().toISOString(),
    })
  );
};

const subscribeStringCatalog = (
  docRef: ReturnType<typeof getSettingsDocRef>,
  legacyField: 'nurses' | 'tens',
  callback: (values: string[]) => void,
  errorLabel: string
): (() => void) =>
  onSnapshot(
    docRef,
    docSnap => {
      if (docSnap.exists()) {
        const values = readStringCatalogFromSnapshot(
          docSnap as unknown as {
            exists: () => boolean;
            data: () => Record<string, unknown> | undefined;
          },
          legacyField
        );
        callback(values);
      }
    },
    error => {
      console.error(`❌ Error subscribing to ${errorLabel}:`, error);
      callback([]);
    }
  );

export const getNurseCatalogFromFirestore = async (): Promise<string[]> => {
  try {
    const docSnap = await getDoc(getNurseCatalogDocRef());
    return readStringCatalogFromSnapshot(
      docSnap as unknown as {
        exists: () => boolean;
        data: () => Record<string, unknown> | undefined;
      },
      'nurses'
    );
  } catch (error) {
    console.error('Error fetching nurse catalog from Firestore:', error);
    return [];
  }
};

export const saveNurseCatalogToFirestore = async (nurses: string[]): Promise<void> => {
  try {
    await saveStringCatalog(getNurseCatalogDocRef(), 'nurses', nurses);
  } catch (error) {
    console.error('Error saving nurse catalog to Firestore:', error);
    throw error;
  }
};

export const subscribeToNurseCatalog = (callback: (nurses: string[]) => void): (() => void) =>
  subscribeStringCatalog(getNurseCatalogDocRef(), 'nurses', callback, 'nurse catalog');

export const getTensCatalogFromFirestore = async (): Promise<string[]> => {
  try {
    const docSnap = await getDoc(getTensCatalogDocRef());
    return readStringCatalogFromSnapshot(
      docSnap as unknown as {
        exists: () => boolean;
        data: () => Record<string, unknown> | undefined;
      },
      'tens'
    );
  } catch (error) {
    console.error('Error fetching TENS catalog from Firestore:', error);
    return [];
  }
};

export const saveTensCatalogToFirestore = async (tens: string[]): Promise<void> => {
  try {
    await saveStringCatalog(getTensCatalogDocRef(), 'tens', tens);
  } catch (error) {
    console.error('Error saving TENS catalog to Firestore:', error);
    throw error;
  }
};

export const subscribeToTensCatalog = (callback: (tens: string[]) => void): (() => void) =>
  subscribeStringCatalog(getTensCatalogDocRef(), 'tens', callback, 'TENS catalog');

export const getProfessionalsCatalogFromFirestore = async (): Promise<
  ProfessionalCatalogItem[]
> => {
  try {
    const docSnap = await getDoc(getProfessionalsCatalogDocRef());
    if (docSnap.exists()) {
      const data = docSnap.data();
      return (data.list as ProfessionalCatalogItem[]) || [];
    }
    return [];
  } catch (error) {
    console.error('Error fetching professionals catalog from Firestore:', error);
    return [];
  }
};

export const saveProfessionalsCatalogToFirestore = async (
  professionals: ProfessionalCatalogItem[]
): Promise<void> => {
  try {
    await withRetry(() =>
      setDoc(getProfessionalsCatalogDocRef(), {
        list: professionals,
        lastUpdated: new Date().toISOString(),
      })
    );
  } catch (error) {
    console.error('Error saving professionals catalog to Firestore:', error);
    throw error;
  }
};

export const subscribeToProfessionalsCatalog = (
  callback: (professionals: ProfessionalCatalogItem[]) => void
): (() => void) =>
  onSnapshot(
    getProfessionalsCatalogDocRef(),
    docSnap => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        const professionals = (data.list as ProfessionalCatalogItem[]) || [];
        callback(professionals);
      }
    },
    error => {
      console.error('❌ Error subscribing to professionals catalog:', error);
      callback([]);
    }
  );
