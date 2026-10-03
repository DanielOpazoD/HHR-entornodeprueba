import { EmailButton } from '../DateStripButtonControls';
import React from 'react';
import { Mail, Settings } from 'lucide-react';
import { useDropdownMenu } from '@/hooks/useDropdownMenu';
import { DateStripDropdownPanel } from './DateStripDropdownPanel';
import { DateStripActionItem } from './DateStripActionItem';
import type { EmailDropdownProps } from './types';

export const EmailDropdown: React.FC<EmailDropdownProps> = ({
  onSendEmail,
  onConfigureEmail,
  emailStatus = 'idle',
  emailErrorMessage,
  emailBlockedReason,
}) => {
  const { isOpen, menuRef, toggle, close } = useDropdownMenu();

  if (!onSendEmail) {
    return null;
  }

  return (
    <div className="relative" ref={menuRef}>
      <div className="flex">
        <EmailButton
          onClick={toggle}
          emailStatus={emailStatus}
          emailErrorMessage={emailErrorMessage}
          isOpen={isOpen}
        />
      </div>

      {isOpen && (
        <DateStripDropdownPanel title="Opciones de Envío" widthClassName="w-56">
          <DateStripActionItem
            disabled={Boolean(emailBlockedReason)}
            onClick={() => {
              close();
              onSendEmail?.();
            }}
            icon={Mail}
            title="Enviar Archivo Excel"
            subtitle="Adjunto clásico con contraseña"
            colorClassName="bg-blue-50 text-blue-600"
            iconHoverColorClassName="group-hover:bg-blue-100"
            className="px-3 py-2"
          />
          {emailBlockedReason && (
            <p role="status" className="mx-3 mb-2 rounded bg-amber-50 p-2 text-xs text-amber-900">
              {emailBlockedReason}
            </p>
          )}

          {onConfigureEmail && (
            <DateStripActionItem
              onClick={() => {
                close();
                onConfigureEmail();
              }}
              icon={Settings}
              title="Configuración"
              subtitle="Destinatarios y mensaje"
              colorClassName="bg-slate-100 text-slate-600"
              iconHoverColorClassName="group-hover:bg-slate-200"
              className="px-3 py-2"
            />
          )}
        </DateStripDropdownPanel>
      )}
    </div>
  );
};
