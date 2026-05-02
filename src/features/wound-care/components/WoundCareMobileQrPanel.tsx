import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Check, Copy, QrCode, RefreshCw, XCircle } from 'lucide-react';
import type { EpisodeContext } from '@/application/wound-care/woundCareUseCases';
import { useWoundCareMobileUploadSession } from '../hooks/useWoundCareMobileUploadSession';

interface WoundCareMobileQrPanelProps {
  episodeContext: EpisodeContext;
}

const formatExpiry = (expiresAt?: string): string => {
  if (!expiresAt) return '';
  return new Intl.DateTimeFormat('es-CL', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(expiresAt));
};

const copyTextToClipboard = async (text: string): Promise<void> => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
};

export const WoundCareMobileQrPanel: React.FC<WoundCareMobileQrPanelProps> = ({
  episodeContext,
}) => {
  const { session, uploadUrl, isBusy, error, createSession, revokeSession } =
    useWoundCareMobileUploadSession(episodeContext);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    void createSession();
  }, [createSession]);

  useEffect(() => {
    let cancelled = false;
    if (!uploadUrl) {
      return;
    }

    QRCode.toDataURL(uploadUrl, {
      margin: 1,
      width: 224,
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
    }).then(dataUrl => {
      if (!cancelled) setQrDataUrl(dataUrl);
    });

    return () => {
      cancelled = true;
    };
  }, [uploadUrl]);

  const handleCopyLink = async () => {
    if (!uploadUrl) return;

    try {
      await copyTextToClipboard(uploadUrl);
      setCopyStatus('copied');
      window.setTimeout(() => setCopyStatus('idle'), 1800);
    } catch {
      setCopyStatus('failed');
    }
  };

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50/60 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
            <QrCode className="w-4 h-4 text-sky-600" />
            QR móvil
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Acceso transitorio para subir fotos a esta hospitalización.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void createSession()}
          disabled={isBusy}
          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-60"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Regenerar
        </button>
      </div>

      <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="w-56 h-56 rounded-md border border-slate-200 bg-white flex items-center justify-center">
          {uploadUrl && qrDataUrl ? (
            <img src={qrDataUrl} alt="QR para subir fotos clínicas" className="w-52 h-52" />
          ) : (
            <div className="text-xs text-slate-400">Generando QR...</div>
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          {session && (
            <p className="text-xs text-slate-600">
              Válido hasta <span className="font-semibold">{formatExpiry(session.expiresAt)}</span>.
            </p>
          )}
          <p className="text-xs text-slate-500">
            El enlace permite subir fotos, no abre el censo ni otros datos clínicos.
          </p>
          {uploadUrl && (
            <p className="break-all rounded bg-white px-2 py-1 text-[11px] text-slate-400 border border-slate-100">
              {uploadUrl}
            </p>
          )}
          {session && uploadUrl && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handleCopyLink()}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
              >
                {copyStatus === 'copied' ? (
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                {copyStatus === 'copied' ? 'Copiado' : 'Copiar link'}
              </button>
              <button
                type="button"
                onClick={() => void revokeSession()}
                disabled={isBusy}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-60"
              >
                <XCircle className="w-3.5 h-3.5" />
                Revocar QR
              </button>
            </div>
          )}
          {copyStatus === 'failed' && (
            <p className="text-xs font-medium text-rose-600">No fue posible copiar el link.</p>
          )}
          {error && <p className="text-xs font-medium text-rose-600">{error}</p>}
        </div>
      </div>
    </div>
  );
};
