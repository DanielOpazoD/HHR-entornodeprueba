import type React from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Crop,
  Download,
  FileImage,
  FileText,
  Images,
  Loader2,
  RefreshCcw,
  RotateCw,
  ScanSearch,
  Trash2,
  UploadCloud,
  WandSparkles,
} from 'lucide-react';
import type { useDocumentScannerDemoController } from '../hooks/useDocumentScannerDemoController';
import type { DocumentScanFilterMode } from '../services/jscanifyDocumentScannerService';
import { DocumentCropEditor } from './DocumentCropEditor';
import { DocumentPageAddControls } from './DocumentPageAddControls';

type ScannerController = ReturnType<typeof useDocumentScannerDemoController>;

const FILTER_OPTIONS: ReadonlyArray<{
  value: DocumentScanFilterMode;
  label: string;
  description: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}> = [
  {
    value: 'scanner',
    label: 'Escáner',
    description: 'Fondo blanco uniforme, sombras suaves y texto natural.',
    icon: WandSparkles,
  },
  {
    value: 'color',
    label: 'Color',
    description: 'Limpia la hoja y conserva timbres, firmas y anotaciones.',
    icon: Images,
  },
  {
    value: 'grayscale',
    label: 'Grises',
    description: 'Escala de grises neutra sin perder matices del documento.',
    icon: FileImage,
  },
  {
    value: 'original',
    label: 'Original',
    description: 'Mantiene la fotografía sin retoque de luz ni color.',
    icon: FileText,
  },
];

const PageStrip = ({ controller }: { controller: ScannerController }) => (
  <div>
    <div className="mb-2 flex items-center justify-between">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Páginas</p>
      <p className="text-xs text-slate-500">
        {controller.selectedPageIndex + 1} de {controller.pageCount}
      </p>
    </div>
    <div className="flex gap-2 overflow-x-auto pb-2" aria-label="Páginas del documento">
      {controller.pageThumbnails.map(thumbnail => {
        const selected = thumbnail.pageIndex === controller.selectedPageIndex;
        return (
          <button
            key={thumbnail.objectUrl}
            type="button"
            aria-label={`Editar página ${thumbnail.pageIndex + 1}`}
            aria-current={selected ? 'page' : undefined}
            disabled={controller.isBusy}
            onClick={() => void controller.selectPage(thumbnail.pageIndex)}
            className={`relative h-24 w-20 shrink-0 overflow-hidden rounded-lg border-2 bg-white p-1 focus:outline-none focus:ring-4 focus:ring-teal-100 ${
              selected ? 'border-teal-600 shadow-sm' : 'border-slate-200'
            }`}
          >
            <img
              src={thumbnail.objectUrl}
              alt=""
              className="h-full w-full rounded object-contain"
            />
            <span className="absolute bottom-1 right-1 rounded bg-slate-900/75 px-1.5 py-0.5 text-[10px] font-bold text-white">
              {thumbnail.pageIndex + 1}
            </span>
          </button>
        );
      })}
    </div>
  </div>
);

const PageTools = ({ controller }: { controller: ScannerController }) => {
  const tools = [
    {
      label: 'Anterior',
      icon: ArrowLeft,
      disabled: controller.selectedPageIndex === 0,
      action: () => controller.movePage(-1),
    },
    {
      label: 'Siguiente',
      icon: ArrowRight,
      disabled: controller.selectedPageIndex === controller.pageCount - 1,
      action: () => controller.movePage(1),
    },
    { label: 'Rotar', icon: RotateCw, disabled: false, action: controller.rotatePage },
    { label: 'Bordes', icon: Crop, disabled: false, action: controller.openCropEditor },
  ];
  return (
    <div>
      <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
        Editar página {controller.selectedPageIndex + 1}
      </p>
      <div className="grid grid-cols-4 overflow-hidden rounded-xl border border-slate-200">
        {tools.map(({ label, icon: Icon, disabled, action }, index) => (
          <button
            key={label}
            type="button"
            disabled={controller.isBusy || disabled}
            onClick={() => void action()}
            className={`flex min-h-16 flex-col items-center justify-center gap-1 border-slate-200 bg-white px-1 text-[11px] font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-teal-500 disabled:text-slate-300 ${
              index < tools.length - 1 ? 'border-r' : ''
            }`}
          >
            <Icon size={19} /> {label}
          </button>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => void controller.redetectBorders()}
          disabled={controller.isBusy}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-2 text-xs font-bold text-slate-700 disabled:opacity-50"
        >
          <ScanSearch size={17} /> Redetectar bordes
        </button>
        <button
          type="button"
          onClick={() => void controller.deletePage()}
          disabled={controller.isBusy || controller.pageCount === 1}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-red-200 bg-white px-2 text-xs font-bold text-red-700 disabled:border-slate-200 disabled:text-slate-300"
        >
          <Trash2 size={17} /> Eliminar página
        </button>
      </div>
    </div>
  );
};

const AppearanceSelector = ({ controller }: { controller: ScannerController }) => (
  <div>
    <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
      Apariencia de esta página
    </p>
    <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-slate-200">
      {FILTER_OPTIONS.map(option => {
        const Icon = option.icon;
        const selected = controller.filterMode === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => void controller.changeFilter(option.value)}
            disabled={controller.isBusy}
            className={`inline-flex min-h-12 items-center justify-center gap-1.5 border-b border-r border-slate-200 px-2 text-xs font-bold even:border-r-0 [&:nth-last-child(-n+2)]:border-b-0 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-teal-500 disabled:opacity-60 ${
              selected ? 'bg-teal-50 text-teal-700' : 'bg-white text-slate-600'
            }`}
          >
            {controller.phase === 'filtering' && selected ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Icon size={16} />
            )}
            {option.label}
          </button>
        );
      })}
    </div>
    <p className="mt-2 min-h-10 text-xs leading-5 text-slate-600" aria-live="polite">
      {FILTER_OPTIONS.find(option => option.value === controller.filterMode)?.description}
    </p>
  </div>
);

export const DocumentReviewEditor = ({ controller }: { controller: ScannerController }) => {
  if (controller.cropEditor) {
    return (
      <DocumentCropEditor
        sourceObjectUrl={controller.cropEditor.sourceObjectUrl}
        initialCorners={controller.cropEditor.corners}
        busy={controller.phase === 'cropping'}
        onCancel={controller.cancelCropEditor}
        onApply={controller.applyCrop}
      />
    );
  }

  return (
    <section className="space-y-4">
      <PageStrip controller={controller} />

      <DocumentPageAddControls
        busy={controller.isBusy}
        adding={controller.phase === 'adding-pages'}
        pageCount={controller.pageCount}
        onAddPages={controller.addPages}
      />

      <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-100 p-2 shadow-inner">
        {controller.phase === 'editing' ? (
          <span className="absolute inset-0 z-10 flex items-center justify-center bg-white/70 text-teal-700">
            <Loader2 size={26} className="animate-spin" aria-label="Actualizando página" />
          </span>
        ) : null}
        <img
          src={controller.previewObjectUrl ?? undefined}
          alt={`Vista previa de la página ${controller.selectedPageIndex + 1}`}
          className="mx-auto block max-h-[48vh] w-full rounded-lg bg-white object-contain shadow-sm"
        />
      </div>

      <PageTools controller={controller} />
      <AppearanceSelector controller={controller} />

      <div
        className={`flex items-center gap-2 text-sm font-semibold ${
          controller.detectedPageCount === controller.pageCount
            ? 'text-emerald-700'
            : 'text-amber-700'
        }`}
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100">
          <Check size={15} strokeWidth={2.5} />
        </span>
        {controller.detectedPageCount === controller.pageCount
          ? 'Recorte y perspectiva aplicados a todas las páginas'
          : `${controller.detectedPageCount} de ${controller.pageCount} páginas detectadas; revisa sus bordes`}
      </div>

      <button
        type="button"
        onClick={() => void controller.reset()}
        disabled={controller.isBusy}
        className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-teal-600 bg-white px-4 py-3 text-sm font-bold text-teal-700 disabled:opacity-60"
      >
        <RefreshCcw size={18} /> Repetir captura
      </button>
      <button
        type="button"
        onClick={() => void controller.downloadPdf()}
        disabled={controller.isBusy}
        className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 py-3 text-base font-bold text-white disabled:bg-teal-300"
      >
        {controller.phase === 'exporting' ? (
          <>
            <Loader2 size={20} className="animate-spin" /> Generando PDF…
          </>
        ) : (
          <>
            <Download size={20} /> Descargar PDF
          </>
        )}
      </button>
      <button
        type="button"
        onClick={() => void controller.uploadDocument()}
        disabled={controller.isBusy || !controller.selectedPatientKey}
        className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 py-3 text-base font-bold text-white disabled:bg-slate-300"
      >
        {controller.phase === 'uploading' ? (
          <>
            <Loader2 size={20} className="animate-spin" /> Subiendo temporalmente…
          </>
        ) : (
          <>
            <UploadCloud size={20} /> Subir a bandeja HHR
          </>
        )}
      </button>
    </section>
  );
};
