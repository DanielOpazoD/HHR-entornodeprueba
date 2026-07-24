import React from 'react';
import { Camera, Images, Loader2, Plus } from 'lucide-react';

interface DocumentPageAddControlsProps {
  readonly busy: boolean;
  readonly adding: boolean;
  readonly pageCount: number;
  readonly maximumPageCount?: number;
  readonly onAddPages: (files: ReadonlyArray<File>) => Promise<void>;
}

const ACCEPTED_DOCUMENT_IMAGES = 'image/*,.heic,.heif';

export const DocumentPageAddControls = ({
  busy,
  adding,
  pageCount,
  maximumPageCount = 12,
  onAddPages,
}: DocumentPageAddControlsProps) => {
  const cameraInputRef = React.useRef<HTMLInputElement>(null);
  const galleryInputRef = React.useRef<HTMLInputElement>(null);
  const maximumReached = pageCount >= maximumPageCount;
  const fileSelectionDisabled = busy || adding || maximumReached;

  const handleFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (fileSelectionDisabled) {
      event.currentTarget.value = '';
      return;
    }
    const remainingSlots = Math.max(0, maximumPageCount - pageCount);
    const files = Array.from(event.currentTarget.files ?? []).slice(0, remainingSlots);
    event.currentTarget.value = '';
    if (files.length) void onAddPages(files);
  };

  return (
    <div className="rounded-xl border border-dashed border-teal-300 bg-teal-50/60 p-3">
      <input
        ref={cameraInputRef}
        type="file"
        accept={ACCEPTED_DOCUMENT_IMAGES}
        capture="environment"
        disabled={fileSelectionDisabled}
        className="sr-only"
        aria-label="Fotografiar página adicional"
        onChange={handleFiles}
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept={ACCEPTED_DOCUMENT_IMAGES}
        multiple
        disabled={fileSelectionDisabled}
        className="sr-only"
        aria-label="Elegir páginas adicionales"
        onChange={handleFiles}
      />

      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
            <Plus size={17} className="text-teal-700" /> Agregar página
          </p>
          <p className="mt-1 text-xs text-slate-600">
            {maximumReached
              ? `Máximo de ${maximumPageCount} páginas alcanzado.`
              : `${pageCount} de ${maximumPageCount} páginas.`}
          </p>
        </div>
        {adding ? <Loader2 size={22} className="animate-spin text-teal-700" /> : null}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => cameraInputRef.current?.click()}
          disabled={fileSelectionDisabled}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-teal-600 px-2 text-xs font-bold text-white disabled:bg-slate-300"
        >
          <Camera size={17} /> Tomar foto
        </button>
        <button
          type="button"
          onClick={() => galleryInputRef.current?.click()}
          disabled={fileSelectionDisabled}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-teal-600 bg-white px-2 text-xs font-bold text-teal-700 disabled:border-slate-300 disabled:text-slate-300"
        >
          <Images size={17} /> Elegir fotos
        </button>
      </div>
    </div>
  );
};
