import * as z from 'zod/mini';
import { isValidRut } from '@/utils/rutUtils';
import type { PharmacyProfessional } from '../../../domain/pharmacy/pharmacyTypes';

const professionalSchema = z.strictObject({
  name: z.string().check(z.trim(), z.minLength(1), z.maxLength(160)),
  rut: z.string().check(
    z.trim(),
    z.maxLength(16),
    z.refine(value => !value || (/^[\d.]+-?[\dkK]$/.test(value) && isValidRut(value)))
  ),
  role: z.string().check(z.trim(), z.minLength(1), z.maxLength(160)),
  unit: z.string().check(z.trim(), z.minLength(1), z.maxLength(160)),
});

const storedProfileSchema = z.strictObject({
  version: z.literal(1),
  uid: z.string().check(z.minLength(1), z.maxLength(256)),
  professional: professionalSchema,
});

export const pharmacyProfileStorageKey = (uid: string): string =>
  `hhr_pharmacy_professional_v1_${encodeURIComponent(uid)}`;

const browserStorage = (): Storage | null => {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
};

/** Only a professional profile belongs on disk; medication and patient data stay in memory. */
export const loadPharmacyProfessional = (
  uid: string | null,
  displayName: string | null,
  storage: Pick<Storage, 'getItem'> | null = browserStorage(),
  sessionDefaults: Pick<PharmacyProfessional, 'rut' | 'role'> = { rut: '', role: '' }
): PharmacyProfessional => {
  const fallback = { name: displayName ?? '', ...sessionDefaults, unit: 'Hospitalizados' };
  if (!uid || !storage) return fallback;
  try {
    const text = storage.getItem(pharmacyProfileStorageKey(uid));
    if (!text || text.length > 4000) return fallback;
    const parsed: unknown = JSON.parse(text);
    const result = storedProfileSchema.safeParse(parsed);
    if (!result.success || result.data.uid !== uid) return fallback;
    return {
      ...result.data.professional,
      rut: result.data.professional.rut || sessionDefaults.rut,
    };
  } catch {
    return fallback;
  }
};

export const savePharmacyProfessional = (
  uid: string | null,
  professional: PharmacyProfessional,
  storage: Pick<Storage, 'setItem'> | null = browserStorage()
): string | null => {
  if (!uid) return 'Inicia sesión para guardar tus datos del responsable.';
  const result = storedProfileSchema.safeParse({ version: 1, uid, professional });
  if (!result.success) return 'Completa nombre, cargo y unidad; revisa el RUT si lo informaste.';
  if (!storage) return 'El navegador no permite guardar tus datos en este equipo.';
  try {
    storage.setItem(pharmacyProfileStorageKey(uid), JSON.stringify(result.data));
    return null;
  } catch {
    return 'No se pudieron guardar tus datos en este equipo.';
  }
};
