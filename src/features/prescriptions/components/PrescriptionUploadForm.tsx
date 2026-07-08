import React, { useRef, useState } from 'react';
import {
  Camera,
  Eye,
  ImagePlus,
  Loader2,
  Package,
  Pill,
  Upload,
  UserMinus,
  Users,
  XCircle,
} from 'lucide-react';
import {
  PRESCRIPTION_ASSIGNMENT_SCOPE_LABELS,
  PRESCRIPTION_TYPE_LABELS,
  PRESCRIPTION_TYPES,
  type PrescriptionAssignmentScope,
  type PrescriptionType,
} from '@/types/prescriptionTypes';
import { PrescriptionUploadReadonlyViewer } from '@/features/prescriptions/components/PrescriptionUploadReadonlyViewer';
import { PrescriptionUploadSuccessState } from '@/features/prescriptions/components/PrescriptionUploadSuccessState';
import type { PrescriptionUploadControllerHandle } from '@/features/prescriptions/hooks/usePrescriptionUploadController';

interface PrescriptionUploadFormProps {
  controller: PrescriptionUploadControllerHandle;
}

const renderPrescriptionTypeIcon = (type: PrescriptionType) => {
  if (type === 'comun') {
    return <Pill size={18} className="shrink-0 text-sky-600" aria-hidden data-testid="icon-pill" />;
  }

  if (type === 'psicotropicos') {
    return (
      <span
        aria-hidden
        data-testid="icon-white-circle"
        className="h-4 w-4 shrink-0 rounded-full border border-slate-400 bg-white shadow-inner"
      />
    );
  }

  return (
    <span
      aria-hidden
      data-testid="icon-green-circle"
      className="h-4 w-4 shrink-0 rounded-full border border-emerald-700 bg-emerald-500 shadow-inner"
    />
  );
};

const ASSIGNMENT_SCOPE_OPTIONS: readonly PrescriptionAssignmentScope[] = [
  'patient',
  'unassigned',
  'hospitalized_stock',
] as const;

const formatIsoDate = (iso: string): string => {
  const [year, month, day] = iso.split('-').map(Number);
  if (!year || !month || !day) return iso;
  return new Date(year, month - 1, day).toLocaleDateString('es-CL');
};

type PatientOptionStatus = NonNullable<
  PrescriptionUploadControllerHandle['patientOptions'][number]['patientStatus']
>;

const formatPatientStatus = (status: PatientOptionStatus | undefined): string => {
  if (status === 'discharge') return 'Alta (egreso)';
  if (status === 'transfer') return 'Traslado';
  return 'Activo';
};

const renderAssignmentScopeIcon = (scope: PrescriptionAssignmentScope) => {
  if (scope === 'patient') return <Users size={16} className="shrink-0 text-sky-600" />;
  if (scope === 'hospitalized_stock') {
    return <Package size={16} className="shrink-0 text-violet-700" />;
  }
  return <UserMinus size={16} className="shrink-0 text-amber-700" />;
};

export const PrescriptionUploadForm: React.FC<PrescriptionUploadFormProps> = ({ controller }) => {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const [isReadonlyViewerOpen, setIsReadonlyViewerOpen] = useState(false);
  const {
    phase,
    values,
    setField,
    errorMessage,
    previewObjectUrl,
    handleImageFile,
    clearCompressedImage,
    submitForm,
    resetAfterSuccess,
    lastResult,
    hasCompressedImage,
    patientOptions,
    patientOptionsPhase,
    patientOptionsError,
    patientOptionsSourceDate,
    isPatientOptionsFallbackFromPreviousDay,
    readonlyViewerAccessPin,
  } = controller;

  const isBusy = phase === 'compressing' || phase === 'uploading';
  const submitDisabled = isBusy || !hasCompressedImage;

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await handleImageFile(file);
    event.target.value = '';
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await submitForm();
  };

  if (phase === 'success' && lastResult) {
    return (
      <>
        <PrescriptionUploadSuccessState
          expiresAt={lastResult.expiresAt}
          onReset={resetAfterSuccess}
          onOpenViewer={() => setIsReadonlyViewerOpen(true)}
        />
        <PrescriptionUploadReadonlyViewer
          isOpen={isReadonlyViewerOpen}
          onClose={() => setIsReadonlyViewerOpen(false)}
          accessPin={readonlyViewerAccessPin}
        />
      </>
    );
  }

  return (
    <>
      <form
        onSubmit={handleSubmit}
        className="mx-auto max-w-md space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        <header className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="text-lg font-semibold text-slate-800">Subir foto de receta</h1>
              <p className="mt-1 text-xs text-slate-500">
                Respaldo mensual del servicio. La receta original queda en farmacia; la eliminación
                manual la realiza el administrador después del respaldo.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsReadonlyViewerOpen(true)}
              className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:border-sky-300 hover:bg-sky-50 hover:text-sky-800"
            >
              <Eye size={16} /> Ver recetas subidas
            </button>
          </div>
        </header>

        <fieldset className="space-y-2">
          <legend className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Tipo de receta
          </legend>
          <div className="flex flex-col gap-2">
            {PRESCRIPTION_TYPES.map(type => (
              <label
                key={type}
                data-testid={`prescription-type-option-${type}`}
                className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                  values.prescriptionType === type
                    ? 'border-sky-500 bg-sky-50 text-sky-900'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <input
                  type="radio"
                  name="prescriptionType"
                  value={type}
                  checked={values.prescriptionType === type}
                  onChange={() => setField('prescriptionType', type as PrescriptionType)}
                  disabled={isBusy}
                  className="accent-sky-600"
                />
                {renderPrescriptionTypeIcon(type)}
                {PRESCRIPTION_TYPE_LABELS[type]}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Paciente
          </legend>
          <div className="grid gap-2">
            {ASSIGNMENT_SCOPE_OPTIONS.map(scope => (
              <label
                key={scope}
                className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                  values.assignmentScope === scope
                    ? 'border-sky-500 bg-sky-50 text-sky-900'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <input
                  type="radio"
                  name="assignmentScope"
                  value={scope}
                  checked={values.assignmentScope === scope}
                  onChange={() => setField('assignmentScope', scope)}
                  disabled={isBusy}
                  className="accent-sky-600"
                />
                {renderAssignmentScopeIcon(scope)}
                {PRESCRIPTION_ASSIGNMENT_SCOPE_LABELS[scope]}
              </label>
            ))}
          </div>
          {values.assignmentScope === 'patient' && (
            <div className="space-y-2">
              <label className="block">
                <span className="text-xs text-slate-500">Cama / paciente / RUT</span>
                <select
                  value={values.selectedPatientKey}
                  onChange={event => setField('selectedPatientKey', event.target.value)}
                  disabled={isBusy || patientOptionsPhase === 'loading'}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200 disabled:bg-slate-100"
                >
                  <option value="">
                    {patientOptionsPhase === 'loading'
                      ? 'Cargando camas del censo...'
                      : 'Selecciona cama - paciente - RUT'}
                  </option>
                  {patientOptions.map(option => (
                    <option key={option.key} value={option.key}>
                      {option.bedId} - {option.patientName || 'Sin nombre'}
                      {option.patientRut ? ` - ${option.patientRut}` : ''} -{' '}
                      {formatPatientStatus(option.patientStatus)}
                    </option>
                  ))}
                </select>
              </label>
              {patientOptionsPhase === 'ready' &&
                isPatientOptionsFallbackFromPreviousDay &&
                patientOptionsSourceDate && (
                  <p className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
                    Pacientes mostrados desde el censo del día previo (
                    {formatIsoDate(patientOptionsSourceDate)}). La receta se sube con la fecha
                    actual.
                  </p>
                )}
              {patientOptionsPhase === 'error' && (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  {patientOptionsError ?? 'No se pudo cargar el censo diario.'} Puedes elegir sin
                  paciente asignado y asignar después en el visor.
                </p>
              )}
              {patientOptionsPhase === 'ready' && patientOptions.length === 0 && (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  No hay camas activas con paciente en el censo de hoy. Elige sin paciente asignado
                  para subir la receta y asignarla después.
                </p>
              )}
            </div>
          )}
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Foto
          </legend>
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            data-testid="prescription-camera-input"
            onChange={handleFileChange}
            className="hidden"
          />
          <input
            ref={galleryInputRef}
            type="file"
            accept="image/*"
            data-testid="prescription-gallery-input"
            onChange={handleFileChange}
            className="hidden"
          />
          {!hasCompressedImage ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                disabled={isBusy}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 px-4 py-5 text-sm font-semibold text-slate-600 transition-colors hover:border-sky-400 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {phase === 'compressing' ? (
                  <>
                    <Loader2 size={18} className="animate-spin" /> Comprimiendo…
                  </>
                ) : (
                  <>
                    <Camera size={18} /> Tomar foto
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => galleryInputRef.current?.click()}
                disabled={isBusy}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-4 py-5 text-sm font-semibold text-slate-700 transition-colors hover:border-sky-300 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {phase === 'compressing' ? (
                  <>
                    <Loader2 size={18} className="animate-spin" /> Comprimiendo…
                  </>
                ) : (
                  <>
                    <ImagePlus size={18} /> Subir imagen existente
                  </>
                )}
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="overflow-hidden rounded-lg border border-slate-200">
                {previewObjectUrl && (
                  <img
                    src={previewObjectUrl}
                    alt="Vista previa de la receta"
                    className="block max-h-72 w-full object-contain bg-slate-50"
                  />
                )}
              </div>
              <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                <span>Imagen lista para subir.</span>
                <button
                  type="button"
                  onClick={clearCompressedImage}
                  disabled={isBusy}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-slate-600 hover:bg-slate-50"
                >
                  <XCircle size={12} /> Cambiar
                </button>
              </div>
            </div>
          )}
        </fieldset>

        {errorMessage && (
          <p
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {errorMessage}
          </p>
        )}

        <button
          type="submit"
          disabled={submitDisabled}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {phase === 'uploading' ? (
            <>
              <Loader2 size={16} className="animate-spin" /> Subiendo…
            </>
          ) : (
            <>
              <Upload size={16} /> Subir receta
            </>
          )}
        </button>
      </form>
      <PrescriptionUploadReadonlyViewer
        isOpen={isReadonlyViewerOpen}
        onClose={() => setIsReadonlyViewerOpen(false)}
        accessPin={readonlyViewerAccessPin}
      />
    </>
  );
};
