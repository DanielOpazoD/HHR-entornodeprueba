/**
 * Hospital Config Service
 * Singleton holding the current hospital id for repositories, exporters and Firestore paths.
 */

let currentHospitalId = 'hanga_roa';

export const HospitalConfigService = {
  /**
   * Set the current hospital ID (the emulator tests use it to switch hospitals).
   */
  setHospitalId(id: string) {
    if (!id) return;
    currentHospitalId = id;
  },

  /**
   * Get the current hospital ID.
   */
  getHospitalId(): string {
    return currentHospitalId;
  },
};
