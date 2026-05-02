import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Link2, MessageCircle } from 'lucide-react';
import clsx from 'clsx';
import type { MedicalHandoffScope } from '@/types/medicalHandoff';

interface MedicalShareActionsProps {
  medicalSignature?: {
    doctorName: string;
    signedAt: string;
  } | null;
  onSendWhatsApp: () => void;
  onShareLink: (scope: MedicalHandoffScope) => void;
}

const LINK_OPTIONS: Array<{ scope: MedicalHandoffScope; label: string; className: string }> = [
  { scope: 'all', label: 'Link: todos', className: 'text-slate-700 hover:bg-slate-50' },
  { scope: 'upc', label: 'Link: UPC', className: 'text-red-700 hover:bg-red-50' },
  { scope: 'no-upc', label: 'Link: No UPC', className: 'text-emerald-700 hover:bg-emerald-50' },
];

export const MedicalShareActions: React.FC<MedicalShareActionsProps> = ({
  medicalSignature,
  onSendWhatsApp,
  onShareLink,
}) => {
  const [showShareMenu, setShowShareMenu] = useState(false);
  const shareMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showShareMenu) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (shareMenuRef.current && !shareMenuRef.current.contains(event.target as Node)) {
        setShowShareMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showShareMenu]);

  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={onSendWhatsApp}
        data-testid="medical-handoff-send-whatsapp-button"
        disabled={!!medicalSignature}
        className={clsx(
          'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors',
          medicalSignature
            ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
            : 'bg-green-500 text-white hover:bg-green-600 active:scale-[0.98]'
        )}
        title="Enviar por WhatsApp"
      >
        <MessageCircle size={13} />
        Enviar
      </button>
      <div className="relative" ref={shareMenuRef}>
        <button
          onClick={() => setShowShareMenu(previous => !previous)}
          data-testid="medical-handoff-share-links-button"
          className={clsx(
            'inline-flex items-center gap-1 rounded-lg p-1.5 transition-colors',
            showShareMenu
              ? 'bg-sky-100 text-sky-700'
              : 'bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700'
          )}
          title="Links de firma"
        >
          <Link2 size={14} />
          <ChevronDown
            size={10}
            className={clsx('transition-transform', showShareMenu && 'rotate-180')}
          />
        </button>

        {showShareMenu && (
          <div className="absolute right-0 top-full mt-1 min-w-[180px] rounded-xl border border-slate-200 bg-white py-1 shadow-xl ring-1 ring-black/[0.04] z-50">
            {LINK_OPTIONS.map(option => (
              <button
                key={option.scope}
                onClick={() => {
                  onShareLink(option.scope);
                  setShowShareMenu(false);
                }}
                data-testid={`medical-handoff-share-link-${option.scope}`}
                className={clsx(
                  'w-full px-3 py-1.5 text-left text-[12px] font-medium transition-colors',
                  option.className
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
