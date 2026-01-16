/**
 * ============================================================================
 *                    POLÍTICA DE ENTORNOS FIREBASE
 * ============================================================================
 * 
 * Este archivo define la política de acceso a los diferentes entornos
 * de Firebase para el proyecto Hospital Hanga Roa.
 * 
 * ============================================================================
 *                         ⚠️ IMPORTANTE ⚠️
 * ============================================================================
 * 
 * ENTORNO BETA (hhr-pruebas):
 * ---------------------------
 * - Project ID: hhr-pruebas
 * - Permisos: LECTURA y ESCRITURA
 * - Este es el entorno de desarrollo y pruebas
 * - Todos los cambios se guardan aquí
 * - Es seguro experimentar y probar funcionalidades
 * 
 * ENTORNO PRODUCCIÓN (hospital-hanga-roa):
 * ----------------------------------------
 * - Project ID: hospital-hanga-roa
 * - Permisos: SOLO LECTURA (desde este modo beta)
 * - Este es el entorno oficial con datos reales
 * - NO se puede modificar desde este proyecto
 * - Solo se puede leer y copiar información
 * 
 * ============================================================================
 *                         FLUJO DE DATOS
 * ============================================================================
 * 
 *   hospital-hanga-roa (PRODUCCIÓN)
 *           │
 *           │ ──── SOLO LECTURA ────►
 *           │
 *           ▼
 *   hhr-pruebas (BETA)
 *           │
 *           │ ◄─── LECTURA/ESCRITURA ───►
 *           │
 *           ▼
 *   Base de datos local (IndexedDB)
 * 
 * ============================================================================
 */

/**
 * Configuración del entorno BETA (donde se escribe)
 */
export const BETA_ENVIRONMENT = {
    projectId: 'hhr-pruebas',
    name: 'Entorno Beta',
    description: 'Entorno de desarrollo y pruebas',
    permissions: {
        read: true,
        write: true,
        delete: true
    }
} as const;

/**
 * Configuración del entorno PRODUCCIÓN (solo lectura)
 */
export const PRODUCTION_ENVIRONMENT = {
    projectId: 'hospital-hanga-roa',
    name: 'Entorno Producción',
    description: 'Entorno oficial con datos reales',
    permissions: {
        read: true,
        write: false,  // ⛔ NO PERMITIDO desde modo beta
        delete: false  // ⛔ NO PERMITIDO desde modo beta
    }
} as const;

/**
 * Entorno activo actual
 * En este proyecto (HHR-entornoprueba), siempre es BETA
 */
export const ACTIVE_ENVIRONMENT = BETA_ENVIRONMENT;

/**
 * Verifica si el proyecto actual puede escribir en un Firebase específico
 */
export function canWriteTo(projectId: string): boolean {
    if (projectId === BETA_ENVIRONMENT.projectId) {
        return true; // ✅ Puede escribir en hhr-pruebas
    }
    if (projectId === PRODUCTION_ENVIRONMENT.projectId) {
        return false; // ⛔ NO puede escribir en hospital-hanga-roa
    }
    return false;
}

/**
 * Verifica si el proyecto actual puede leer de un Firebase específico
 */
export function canReadFrom(projectId: string): boolean {
    // Puede leer de ambos entornos
    return projectId === BETA_ENVIRONMENT.projectId ||
        projectId === PRODUCTION_ENVIRONMENT.projectId;
}

/**
 * Obtiene el nombre del entorno basado en el projectId
 */
export function getEnvironmentName(projectId: string): string {
    if (projectId === BETA_ENVIRONMENT.projectId) {
        return '🧪 BETA';
    }
    if (projectId === PRODUCTION_ENVIRONMENT.projectId) {
        return '🏥 PRODUCCIÓN';
    }
    return '❓ DESCONOCIDO';
}

/**
 * Valida que una operación de escritura sea permitida
 * Lanza error si se intenta escribir en producción
 */
export function validateWriteOperation(projectId: string): void {
    if (projectId === PRODUCTION_ENVIRONMENT.projectId) {
        throw new Error(
            `⛔ OPERACIÓN NO PERMITIDA: No se puede escribir en el entorno de producción (${PRODUCTION_ENVIRONMENT.projectId}) desde el modo beta. ` +
            `Solo se puede escribir en ${BETA_ENVIRONMENT.projectId}.`
        );
    }
}
