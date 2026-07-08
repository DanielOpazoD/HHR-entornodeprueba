/**
 * ClinicalDocumentLockBanner
 *
 * Read-only feedback shown above a locked clinical document. The banner
 * explains *why* the document is locked so clinicians don't try to edit
 * something that won't accept changes (the toolbar, title and section
 * editors are already disabled by the surrounding `isLocked` gates — this
 * banner is the visible counterpart).
 *
 * Currently only one lock reason exists (`'episode_closed'`); future
 * reasons can be added without changing the surrounding sheet code.
 */

import React from 'react';
import { Lock } from 'lucide-react';

import type { ClinicalDocumentRecord } from '@/features/clinical-documents/domain/entities';

interface ClinicalDocumentLockBannerProps {
  isLocked: boolean;
  lockedReason?: ClinicalDocumentRecord['lockedReason'];
  lockedAt?: ClinicalDocumentRecord['lockedAt'];
}

const formatLockedDate = (lockedAt: string | undefined): string | null => {
  if (!lockedAt) return null;
  try {
    const date = new Date(lockedAt);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleString('es-CL', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return null;
  }
};

const buildLockMessage = (
  reason: ClinicalDocumentLockBannerProps['lockedReason'],
  lockedAtLabel: string | null
): string => {
  const baseMessage =
    reason === 'episode_closed'
      ? 'Este documento quedó bloqueado al cerrarse la hospitalización del paciente'
      : 'Este documento está bloqueado para edición';
  if (!lockedAtLabel) return `${baseMessage}.`;
  return `${baseMessage} el ${lockedAtLabel}.`;
};

export const ClinicalDocumentLockBanner: React.FC<ClinicalDocumentLockBannerProps> = ({
  isLocked,
  lockedReason,
  lockedAt,
}) => {
  if (!isLocked) return null;

  const lockedAtLabel = formatLockedDate(lockedAt);
  const message = buildLockMessage(lockedReason, lockedAtLabel);

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="clinical-document-lock-banner"
      className="mx-auto flex max-w-6xl items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-900"
    >
      <Lock size={16} className="mt-0.5 shrink-0 text-amber-700" aria-hidden="true" />
      <div className="flex flex-col gap-0.5">
        <span className="font-semibold uppercase tracking-wide text-[10px] text-amber-800">
          Documento bloqueado
        </span>
        <span>{message}</span>
        <span className="text-amber-700">
          Si necesitas registrar información nueva, crea una addenda en un documento aparte.
        </span>
      </div>
    </div>
  );
};
