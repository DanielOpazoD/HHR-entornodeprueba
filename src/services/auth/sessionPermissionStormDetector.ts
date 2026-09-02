/**
 * Detector de «tormenta de permisos»: la sesión aparenta estar viva (hay
 * usuario en Firebase Auth) pero Firestore deniega las lecturas básicas que
 * TODO rol tiene permitidas (registros del censo, catálogos). Visto en vivo el
 * 01-09: 17 sitios distintos fallaban cada uno por su cuenta, el botón de
 * sincronización gastaba 9 s en una corrida condenada y el usuario no tenía
 * forma de saber que su sesión había perdido los permisos.
 *
 * Es un detector, no un control: cuenta fuentes DISTINTAS denegadas dentro de
 * una ventana corta. Una sola fuente denegada puede ser un permiso legítimo por
 * rol; dos fuentes básicas distintas en pocos segundos no lo son. Solo deben
 * reportar aquí lecturas que cualquier rol autorizado puede hacer.
 *
 * Estado de módulo a propósito: hay varias instancias de useAuthState y todas
 * deben ver la MISMA ventana. Por eso el armado es por uid e idempotente:
 * re-armar con el mismo uid no borra las denegaciones ya acumuladas (las
 * suscripciones denegadas no vuelven a fallar: si se borrara la ráfaga inicial,
 * la tormenta nunca se detectaría).
 */
export const SESSION_PERMISSION_STORM_WINDOW_MS = 10_000;
export const SESSION_PERMISSION_STORM_DISTINCT_SOURCES = 2;

export interface SessionPermissionStorm {
  sources: string[];
  detectedAt: number;
}

type StormListener = (storm: SessionPermissionStorm) => void;

const recentDenials = new Map<string, number>();
const listeners = new Set<StormListener>();
let stormAnnouncedAt: number | null = null;
let armedUid: string | null = null;

const pruneOutsideWindow = (now: number): void => {
  for (const [source, at] of recentDenials) {
    if (now - at > SESSION_PERMISSION_STORM_WINDOW_MS) recentDenials.delete(source);
  }
};

/** Registra una lectura básica denegada por permisos. Idempotente por fuente dentro de la ventana. */
export const reportBasicReadPermissionDenied = (source: string, now: number = Date.now()): void => {
  const key = source.trim();
  if (!key) return;
  pruneOutsideWindow(now);
  recentDenials.set(key, now);
  if (recentDenials.size < SESSION_PERMISSION_STORM_DISTINCT_SOURCES) return;
  // Una tormenta se anuncia UNA vez por ventana: el remedio (cerrar sesión con
  // razón visible) es terminal y no debe repetirse mientras se ejecuta.
  if (stormAnnouncedAt !== null && now - stormAnnouncedAt <= SESSION_PERMISSION_STORM_WINDOW_MS) {
    return;
  }
  stormAnnouncedAt = now;
  const storm: SessionPermissionStorm = {
    sources: [...recentDenials.keys()].sort(),
    detectedAt: now,
  };
  listeners.forEach(listener => listener(storm));
};

export const subscribeToSessionPermissionStorm = (listener: StormListener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/**
 * Arma el detector para una sesión. Solo un uid NUEVO limpia el historial;
 * volver a armar con el mismo uid (otra instancia del hook, otro estado de
 * sesión de la misma persona) no borra nada.
 */
export const armSessionPermissionStormDetector = (uid: string): void => {
  if (armedUid === uid) return;
  armedUid = uid;
  recentDenials.clear();
  stormAnnouncedAt = null;
};

/** Limpia todo el estado (tests). */
export const resetSessionPermissionStormDetector = (): void => {
  recentDenials.clear();
  stormAnnouncedAt = null;
  armedUid = null;
};
