/**
 * Security Constants
 * Configuration for session management and access control.
 */

// Cierre automático de sesión por inactividad (sin actividad de mouse,
// teclado, toque ni scroll durante este lapso). La guía MINSAL para sistemas
// clínicos suele situarse en 10–20 minutos; aquí es 1 hora por decisión del
// responsable (01-11-2026): varias personas se turnan en un mismo computador.
// Independiente del bloqueo con PIN de SecurityContext, que es opcional y se
// configura en Ajustes de seguridad.
export const SESSION_TIMEOUT_MS = 60 * 60 * 1000;

// Events that count as user activity for resetting the session timer
export const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll'];
