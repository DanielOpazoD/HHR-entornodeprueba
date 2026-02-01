/**
 * Hospital Config Service
 * Singleton to manage the current hospital identification across the app.
 * Bridges React Context with non-React services (repositories, exporters, etc.)
 */

let currentHospitalId = 'hanga_roa';

export const HospitalConfigService = {
    /**
     * Set the current hospital ID.
     * Should be called by HospitalProvider during initialization.
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
    }
};
