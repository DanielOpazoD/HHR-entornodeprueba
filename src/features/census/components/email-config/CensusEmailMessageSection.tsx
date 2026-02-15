import React from 'react';
import { MessageSquare, RefreshCw } from 'lucide-react';
import { ModalSection } from '@/components/shared/BaseModal';

interface CensusEmailMessageSectionProps {
  message: string;
  onMessageChange: (message: string) => void;
  onResetMessage: () => void;
}

export const CensusEmailMessageSection: React.FC<CensusEmailMessageSectionProps> = ({
  message,
  onMessageChange,
  onResetMessage,
}) => (
  <ModalSection
    title="Cuerpo del Mensaje"
    icon={<MessageSquare size={16} className="text-slate-600" />}
    className="flex-1 flex flex-col"
  >
    <div className="flex-1 flex flex-col space-y-2">
      <textarea
        value={message}
        onChange={event => onMessageChange(event.target.value)}
        rows={10}
        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white flex-1 min-h-[160px] lg:min-h-[280px]"
        placeholder="Escribe el mensaje aquí..."
      />
      <div className="flex justify-end pt-1">
        <button
          onClick={onResetMessage}
          className="flex items-center gap-1 text-[10px] text-blue-600 hover:text-blue-800 font-bold uppercase tracking-wider transition-all"
        >
          <RefreshCw size={10} /> Restablecer
        </button>
      </div>
    </div>
  </ModalSection>
);
