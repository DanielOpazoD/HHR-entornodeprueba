import { CircleAlert, Info, type LucideIcon } from 'lucide-react';
import type { RayenSyncBarTone } from './rayenSyncBarViewModel';

/**
 * Única fuente del tono del cuadro de sincronización. Hay tres niveles y solo tres:
 *
 * - `info`: en curso, al día o contexto. No pide nada.
 * - `review`: algo para mirar cuando se pueda; la persona sigue trabajando.
 * - `action`: solo lo que SAVE-01 obliga a decir (una edición que no se guardó y no se
 *   recuperará sola, o datos en riesgo).
 *
 * Ningún nivel usa rojo, naranja ni amarillo de alarma. El nivel `action` se distingue por forma
 * (borde marcado, ! en círculo y texto en negrita con lo que hay que hacer), no por color.
 */
export type SyncToneLevel = 'info' | 'review' | 'action';

export const SYNC_TONE_LEVELS: readonly SyncToneLevel[] = ['info', 'review', 'action'];

export interface SyncToneClasses {
  /** Texto de una línea de estado. */
  text: string;
  /** Ícono junto al texto. */
  icon: string;
  /** Punto de estado (siempre acompañado de texto). */
  dot: string;
  /** Recuadro de un aviso. */
  surface: string;
  /** Borde y texto (sin fondo) de un botón pequeño que refleja el estado. */
  control: string;
  /** Realce al pasar el puntero. */
  hover: string;
}

export const SYNC_TONE: Record<SyncToneLevel, SyncToneClasses> = {
  info: {
    text: 'text-slate-600',
    icon: 'text-slate-500',
    dot: 'bg-slate-400',
    surface: 'border-slate-200 bg-slate-50 text-slate-700',
    control: 'border-slate-200 text-slate-600',
    hover: 'hover:bg-slate-50',
  },
  review: {
    text: 'text-sky-800',
    icon: 'text-sky-600',
    dot: 'bg-sky-500',
    surface: 'border-sky-200 bg-sky-50 text-sky-900',
    control: 'border-sky-200 text-sky-800',
    hover: 'hover:bg-sky-50',
  },
  action: {
    text: 'font-semibold text-slate-900',
    icon: 'text-slate-900',
    dot: 'bg-slate-900',
    surface: 'border-2 border-slate-500 bg-white text-slate-900',
    control: 'border-slate-500 text-slate-900',
    hover: 'hover:bg-slate-100',
  },
};

/** Variantes del nivel informativo: conectado o al día, en curso y sin datos. */
export const SYNC_TONE_INFO_VARIANT = {
  ok: {
    text: 'text-teal-700',
    dot: 'bg-teal-500',
    surface: 'border-slate-200 bg-white text-teal-700',
  },
  progress: {
    text: 'text-teal-700',
    icon: 'text-teal-600',
    dot: 'bg-teal-500',
    surface: 'border-teal-200 bg-teal-100 text-teal-700',
  },
  idle: { dot: 'bg-slate-300' },
} as const;

/** Ícono que distingue los niveles que piden algo; el informativo no lleva ícono de advertencia. */
export const SYNC_TONE_ICON: Record<Exclude<SyncToneLevel, 'info'>, LucideIcon> = {
  review: Info,
  action: CircleAlert,
};

const rank: Record<SyncToneLevel, number> = { info: 0, review: 1, action: 2 };

/** El nivel más exigente entre los presentes; `null` cuando no hay nada que mostrar. */
export const highestSyncTone = (
  ...levels: Array<SyncToneLevel | null | undefined>
): SyncToneLevel | null =>
  levels.reduce<SyncToneLevel | null>(
    (highest, level) => (level && (!highest || rank[level] > rank[highest]) ? level : highest),
    null
  );

/** La línea de estado nunca llega al nivel `action`: una lectura de Eloísa pendiente no pierde ediciones. */
export const SYNC_BAR_TONE_LEVEL: Record<RayenSyncBarTone, SyncToneLevel> = {
  neutral: 'info',
  progress: 'info',
  success: 'info',
  warning: 'review',
};
