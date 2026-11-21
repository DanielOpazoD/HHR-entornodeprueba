/**
 * Active hospital identifier for Firestore paths and multi-tenant repositories.
 * Kept in the pure constants layer so path builders do not depend on services.
 */

let currentHospitalId = 'hanga_roa';

export const getActiveHospitalId = (): string => currentHospitalId;

export const setActiveHospitalId = (id: string): void => {
  if (!id) return;
  currentHospitalId = id;
};
