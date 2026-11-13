import type { GinecobstetriciaType, PatientData } from '@/types/domain/patient';

export const isGinecobstetriciaSpecialty = (specialty?: string): boolean =>
  specialty === 'Ginecobstetricia';

export const isObstetricGinecobstetricia = (ginecobstetriciaType?: GinecobstetriciaType): boolean =>
  ginecobstetriciaType === 'Obstétrica';

export const clearDeliveryRouteFields = (): Pick<
  PatientData,
  'deliveryRoute' | 'deliveryDate' | 'deliveryCesareanLabor'
> => ({
  deliveryRoute: undefined,
  deliveryDate: undefined,
  deliveryCesareanLabor: undefined,
});

export const clearGinecobstetriciaFields = (): Pick<
  PatientData,
  'ginecobstetriciaType' | 'deliveryRoute' | 'deliveryDate' | 'deliveryCesareanLabor'
> => ({
  ginecobstetriciaType: undefined,
  ...clearDeliveryRouteFields(),
});

export const buildPrimarySpecialtyPatch = (specialty: string): Partial<PatientData> => ({
  specialty: specialty as PatientData['specialty'],
  ...(isGinecobstetriciaSpecialty(specialty) ? {} : clearGinecobstetriciaFields()),
});

export const buildGinecobstetriciaTypePatch = (
  ginecobstetriciaType: GinecobstetriciaType
): Partial<PatientData> => ({
  ginecobstetriciaType,
  ...(isObstetricGinecobstetricia(ginecobstetriciaType) ? {} : clearDeliveryRouteFields()),
});

export const resolveGinecobstetriciaBadgeTitle = (): string => 'Definir tipo de atención';

export const resolveGinecobstetriciaBadgeClassName = (): string =>
  'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100';
