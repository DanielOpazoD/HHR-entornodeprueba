import React, { useEffect, useMemo, useState } from 'react';
import { Camera, CheckCircle2, Loader2, ShieldCheck, UploadCloud } from 'lucide-react';
import {
  uploadWoundCareMobilePhoto,
  validateWoundCareMobileUploadSession,
  type WoundCareMobileUploadSessionPayload,
} from '@/services/wound-care/woundCareMobileUploadService';
import { compressImage, generateThumbnail } from '@/utils/imageCompression';
import {
  formatReadonlyUploadDateTime,
  toClinicalDatetimeLocalValue,
  toClinicalEventIso,
  validatePhotoForUpload,
} from '../controllers/photoUploadController';

const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      resolve(result.includes(',') ? result.split(',')[1] : result);
    };
    reader.onerror = () => reject(new Error('No fue posible leer la imagen.'));
    reader.readAsDataURL(blob);
  });

const resolveSessionIdFromPath = (): string =>
  typeof window === 'undefined'
    ? ''
    : decodeURIComponent(window.location.pathname.split('/').pop() || '');

export const WoundCareMobileUploadView: React.FC = () => {
  const sessionId = useMemo(() => resolveSessionIdFromPath(), []);
  const [session, setSession] = useState<WoundCareMobileUploadSessionPayload | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'uploading' | 'done' | 'error'>(
    'loading'
  );
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [description, setDescription] = useState('');
  const [bodyLocation, setBodyLocation] = useState('');
  const [eventDateTime, setEventDateTime] = useState(() => toClinicalDatetimeLocalValue());

  useEffect(() => {
    let cancelled = false;
    const validate = async () => {
      try {
        const payload = await validateWoundCareMobileUploadSession(sessionId);
        if (cancelled) return;
        setSession(payload);
        setStatus('ready');
      } catch {
        if (cancelled) return;
        setError('El QR expiró, fue revocado o no es válido.');
        setStatus('error');
      }
    };
    void validate();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!file || !session) return;

    const validation = validatePhotoForUpload(file);
    if (!validation.valid) {
      setError(validation.error || 'Archivo no válido.');
      return;
    }

    setStatus('uploading');
    setError(null);
    try {
      const [compressed, thumbnail] = await Promise.all([
        compressImage(file),
        generateThumbnail(file),
      ]);
      const [imageBase64, thumbnailBase64] = await Promise.all([
        blobToBase64(compressed.blob),
        blobToBase64(thumbnail.blob),
      ]);

      await uploadWoundCareMobilePhoto({
        sessionId,
        imageBase64,
        thumbnailBase64,
        mimeType: compressed.blob.type,
        originalFileName: file.name,
        originalFileSize: file.size,
        compressedFileSize: compressed.compressedSize,
        width: compressed.width,
        height: compressed.height,
        description: description.trim() || undefined,
        bodyLocation: bodyLocation.trim() || undefined,
        takenAt: toClinicalEventIso(eventDateTime),
      });

      setStatus('done');
      setFile(null);
      setDescription('');
      setBodyLocation('');
      setEventDateTime(toClinicalDatetimeLocalValue());
    } catch {
      setError('No fue posible subir la foto. Revise conexión o regenere el QR.');
      setStatus('ready');
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 py-5">
        <header className="mb-4">
          <div className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-sky-600 text-white">
            <Camera className="h-5 w-5" />
          </div>
          <h1 className="mt-3 text-xl font-bold leading-tight">Registro clínico audiovisual</h1>
          {session && (
            <p className="mt-1 text-sm text-slate-600">
              {session.patientName}
              <span className="block font-mono text-xs text-slate-400">{session.patientRut}</span>
            </p>
          )}
        </header>

        {status === 'loading' && (
          <div className="mt-10 flex flex-col items-center justify-center rounded-md border border-slate-200 bg-white p-6 text-center">
            <Loader2 className="h-7 w-7 animate-spin text-sky-600" />
            <p className="mt-3 text-sm text-slate-500">Validando QR...</p>
          </div>
        )}

        {status === 'error' && (
          <div className="rounded-md border border-rose-100 bg-white p-4 text-sm text-rose-700">
            {error}
          </div>
        )}

        {(status === 'ready' || status === 'uploading') && (
          <form
            onSubmit={handleSubmit}
            className="space-y-3 rounded-md border border-slate-200 bg-white p-4"
          >
            <label className="block">
              <span className="text-sm font-semibold text-slate-700">Foto clínica</span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={event => setFile(event.target.files?.[0] || null)}
                className="mt-2 block w-full rounded-md border border-slate-200 bg-slate-50 p-3 text-sm"
              />
            </label>

            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-[11px] font-semibold uppercase text-slate-400">Fecha de subida</p>
              <p className="text-sm text-slate-700">{formatReadonlyUploadDateTime()}</p>
            </div>

            <label className="block">
              <span className="text-sm font-semibold text-slate-700">Fecha del evento</span>
              <input
                type="datetime-local"
                value={eventDateTime}
                max={toClinicalDatetimeLocalValue()}
                onChange={event => setEventDateTime(event.target.value)}
                className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
              />
              <span className="mt-1 block text-xs text-slate-400">
                Ajuste esta fecha si la curación corresponde a días previos.
              </span>
            </label>

            <label className="block">
              <span className="text-sm font-semibold text-slate-700">Ubicación</span>
              <input
                value={bodyLocation}
                onChange={event => setBodyLocation(event.target.value)}
                placeholder="Ej: pierna derecha, sacro"
                className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
              />
            </label>

            <label className="block">
              <span className="text-sm font-semibold text-slate-700">Observación breve</span>
              <textarea
                value={description}
                onChange={event => setDescription(event.target.value)}
                rows={3}
                className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
              />
            </label>

            {error && <p className="text-sm font-medium text-rose-600">{error}</p>}

            <button
              type="submit"
              disabled={!file || status === 'uploading'}
              className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-sky-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
            >
              {status === 'uploading' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <UploadCloud className="h-4 w-4" />
              )}
              Subir a hospitalización
            </button>
          </form>
        )}

        {status === 'done' && (
          <div className="rounded-md border border-emerald-100 bg-white p-5 text-center">
            <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-600" />
            <p className="mt-2 text-sm font-semibold text-slate-800">Foto guardada</p>
            <button
              type="button"
              onClick={() => setStatus('ready')}
              className="mt-4 rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700"
            >
              Subir otra foto
            </button>
          </div>
        )}

        <footer className="mt-auto flex items-center gap-2 pt-5 text-xs text-slate-400">
          <ShieldCheck className="h-4 w-4" />
          Acceso temporal limitado a carga de fotos.
        </footer>
      </div>
    </main>
  );
};
