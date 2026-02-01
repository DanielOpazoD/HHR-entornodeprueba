import React from 'react';
import { Share2, Send, CheckCircle, RefreshCw } from 'lucide-react';

interface HandoffWhatsAppActionsProps {
    whatsappSending: boolean;
    whatsappSent: boolean;
    onSendWhatsApp: () => Promise<void>;
    onShareLink: () => void;
    sentTimestamp?: string;
}

export const HandoffWhatsAppActions: React.FC<HandoffWhatsAppActionsProps> = ({
    whatsappSending,
    whatsappSent,
    onSendWhatsApp,
    onShareLink,
    sentTimestamp
}) => {
    return (
        <div className="flex flex-col sm:flex-row items-center gap-3 pt-4 border-t border-slate-200 print:hidden">
            <button
                onClick={onShareLink}
                className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium text-sm transition-colors"
                aria-label="Copiar enlace de entrega al portapapeles"
            >
                <Share2 size={16} aria-hidden="true" />
                Copiar enlace
            </button>

            <button
                onClick={onSendWhatsApp}
                disabled={whatsappSending || whatsappSent}
                className="flex items-center gap-2 px-6 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-bold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label={whatsappSent ? "Entrega enviada" : "Enviar entrega a WhatsApp"}
            >
                {whatsappSending ? (
                    <>
                        <RefreshCw size={16} className="animate-spin" aria-hidden="true" />
                        Enviando...
                    </>
                ) : whatsappSent ? (
                    <>
                        <CheckCircle size={16} aria-hidden="true" />
                        Enviado
                    </>
                ) : (
                    <>
                        <Send size={16} aria-hidden="true" />
                        Enviar a WhatsApp
                    </>
                )}
            </button>

            {whatsappSent && sentTimestamp && (
                <span className="text-xs text-green-600 font-medium flex items-center gap-1">
                    <CheckCircle size={12} />
                    Enviado: {new Date(sentTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
            )}
        </div>
    );
};
