import React from 'react';
import { ShieldCheck, ShieldAlert, ShieldOff } from 'lucide-react';
import type { WoundCareConsent } from '@/types/domain/woundCare';

export type ConsentDisplayState = 'none' | 'signed' | 'revoked';

export const deriveConsentDisplayState = (
  consent: WoundCareConsent | null | undefined
): ConsentDisplayState => {
  if (!consent) return 'none';
  if (consent.status === 'signed') return 'signed';
  if (consent.status === 'revoked') return 'revoked';
  return 'none';
};

export const consentStatusLabel: Record<ConsentDisplayState, string> = {
  none: 'Sin consentimiento',
  signed: 'Consentimiento firmado',
  revoked: 'Consentimiento revocado',
};

export const consentStatusColor: Record<ConsentDisplayState, string> = {
  none: 'text-amber-600 bg-amber-50 border-amber-200',
  signed: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  revoked: 'text-red-600 bg-red-50 border-red-200',
};

interface ConsentStatusProps {
  consent: WoundCareConsent | null;
  onAction: () => void;
  readOnly?: boolean;
}

const StatusIcon: React.FC<{ state: ConsentDisplayState }> = ({ state }) => {
  const iconClass = 'w-4 h-4';
  switch (state) {
    case 'signed':
      return <ShieldCheck className={iconClass} />;
    case 'revoked':
      return <ShieldOff className={iconClass} />;
    default:
      return <ShieldAlert className={`${iconClass} animate-pulse`} />;
  }
};

export const ConsentStatus: React.FC<ConsentStatusProps> = ({
  consent,
  onAction,
  readOnly = false,
}) => {
  const state = deriveConsentDisplayState(consent);
  const label = consentStatusLabel[state];
  const colorClass = consentStatusColor[state];

  return (
    <button
      type="button"
      onClick={onAction}
      disabled={readOnly && state === 'signed'}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${colorClass} ${
        readOnly && state === 'signed' ? 'cursor-default' : 'hover:opacity-80 cursor-pointer'
      }`}
    >
      <StatusIcon state={state} />
      {label}
    </button>
  );
};
