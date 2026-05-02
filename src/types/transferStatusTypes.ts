/**
 * Transfer request status progression.
 */
export type TransferStatus =
  | 'REQUESTED'
  | 'RECEIVED'
  | 'ACCEPTED'
  | 'ACCEPTED_WITH_CAPACITY'
  | 'ACCEPTED_WAITING_CAPACITY'
  | 'REJECTED'
  | 'NO_RESPONSE'
  | 'TRANSFERRED'
  | 'CANCELLED';

/**
 * Status display configuration.
 */
export interface TransferStatusDisplay {
  label: string;
  /** Short label used inside grouped dropdown entries (falls back to label) */
  shortLabel?: string;
  color: string;
  bgColor: string;
}

export const TRANSFER_STATUS_CONFIG: Record<TransferStatus, TransferStatusDisplay> = {
  REQUESTED: { label: 'Solicitado', color: 'text-amber-700', bgColor: 'bg-amber-100' },
  RECEIVED: { label: 'Recepcionado', color: 'text-cyan-700', bgColor: 'bg-cyan-100' },
  ACCEPTED: { label: 'Aceptado', color: 'text-emerald-700', bgColor: 'bg-emerald-100' },
  ACCEPTED_WITH_CAPACITY: {
    label: 'Aceptado · Cupo confirmado',
    shortLabel: 'Cupo confirmado',
    color: 'text-emerald-700',
    bgColor: 'bg-emerald-100',
  },
  ACCEPTED_WAITING_CAPACITY: {
    label: 'Aceptado · En espera cupo',
    shortLabel: 'En espera cupo',
    color: 'text-emerald-700',
    bgColor: 'bg-emerald-100',
  },
  REJECTED: { label: 'Rechazado', color: 'text-rose-700', bgColor: 'bg-rose-100' },
  NO_RESPONSE: { label: 'Sin respuesta', color: 'text-orange-700', bgColor: 'bg-orange-100' },
  TRANSFERRED: {
    label: 'Traslado ejecutado',
    shortLabel: 'Ejecutado',
    color: 'text-slate-700',
    bgColor: 'bg-slate-100',
  },
  CANCELLED: { label: 'Cancelado', color: 'text-rose-700', bgColor: 'bg-rose-100' },
};
