import React, { useEffect, useState } from 'react';
import { Check, ImageOff, Loader2, Maximize2, Pencil, Trash2, X } from 'lucide-react';
import { BaseModal } from '@/components/shared/BaseModal';
import { useConfirmDialog } from '@/context/UIContext';
import { formatDateTimeCL } from '@/utils/dateDisplayUtils';
import {
  PRESCRIPTION_ASSIGNMENT_SCOPE_LABELS,
  PRESCRIPTION_TYPES,
  PRESCRIPTION_TYPE_LABELS,
  resolvePrescriptionAssignmentScope,
  type PrescriptionRecord,
  type PrescriptionType,
} from '@/types/prescriptionTypes';
import { resolvePrescriptionImageDownloadUrl } from '@/features/prescriptions/services/prescriptionStorageImageService';
import { PrescriptionReassignDialog } from '@/features/prescriptions/components/PrescriptionReassignDialog';
import { PrescriptionImageLightbox } from '@/features/prescriptions/components/PrescriptionImageLightbox';

interface PrescriptionDetailModalProps {
  record: PrescriptionRecord;
  canEdit: boolean;
  canDelete: boolean;
  onClose: () => void;
  onReassign: (patch: {
    bedId?: string;
    patientName?: string;
    patientRut?: string;
    clear: boolean;
  }) => Promise<void>;
  onDelete: () => Promise<void>;
  onUpdateType?: (nextType: PrescriptionType) => Promise<void>;
  selectedDate?: string | null;
}

const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

export const PrescriptionDetailModal: React.FC<PrescriptionDetailModalProps> = ({
  record,
  canEdit,
  canDelete,
  onClose,
  onReassign,
  onDelete,
  onUpdateType,
  selectedDate,
}) => {
  const [resolvedFullImage, setResolvedFullImage] = useState<{ path: string; url: string } | null>(
    null
  );
  const [imageErrorPath, setImageErrorPath] = useState<string | null>(null);
  const [showReassign, setShowReassign] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [showLightbox, setShowLightbox] = useState(false);
  const [editingType, setEditingType] = useState(false);
  const [pendingType, setPendingType] = useState<PrescriptionType>(record.prescriptionType);
  const [savingType, setSavingType] = useState(false);
  const [typeError, setTypeError] = useState<string | null>(null);
  const { confirm } = useConfirmDialog();
  const readonlyFullUrl = record.image.fullDownloadUrl;
  const fullImagePath = record.image.storagePath;
  const fullUrl =
    readonlyFullUrl ?? (resolvedFullImage?.path === fullImagePath ? resolvedFullImage.url : null);
  const imageError = !readonlyFullUrl && imageErrorPath === fullImagePath;

  useEffect(() => {
    setPendingType(record.prescriptionType);
  }, [record.prescriptionType]);

  useEffect(() => {
    let cancelled = false;

    if (readonlyFullUrl) {
      return () => {
        cancelled = true;
      };
    }

    resolvePrescriptionImageDownloadUrl(fullImagePath)
      .then(url => {
        if (!cancelled) setResolvedFullImage({ path: fullImagePath, url });
      })
      .catch(() => {
        if (!cancelled) setImageErrorPath(fullImagePath);
      });
    return () => {
      cancelled = true;
    };
  }, [fullImagePath, readonlyFullUrl]);

  const handleSaveType = async () => {
    if (!onUpdateType) return;
    if (pendingType === record.prescriptionType) {
      setEditingType(false);
      return;
    }
    setSavingType(true);
    setTypeError(null);
    try {
      await onUpdateType(pendingType);
      setEditingType(false);
    } catch (caught) {
      setTypeError(
        caught instanceof Error ? caught.message : 'No se pudo actualizar el tipo de receta.'
      );
    } finally {
      setSavingType(false);
    }
  };

  const handleCancelEditType = () => {
    setPendingType(record.prescriptionType);
    setEditingType(false);
    setTypeError(null);
  };

  const handleDelete = async () => {
    const accepted = await confirm({
      title: 'Eliminar receta',
      message:
        'Confirme que el respaldo mensual ya fue realizado antes de eliminar esta receta. Esta acción no se puede deshacer.',
      confirmText: 'Eliminar respaldo',
      cancelText: 'Cancelar',
      variant: 'danger',
    });
    if (!accepted) {
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    try {
      await onDelete();
      onClose();
    } catch (caught) {
      setDeleteError(caught instanceof Error ? caught.message : 'No se pudo eliminar la receta.');
    } finally {
      setDeleting(false);
    }
  };

  const assignmentScope = resolvePrescriptionAssignmentScope(record);
  const isUnassigned = assignmentScope === 'unassigned';
  const isStock = assignmentScope === 'hospitalized_stock';

  return (
    <BaseModal
      isOpen
      onClose={onClose}
      title="Detalle de receta"
      size="2xl"
      dataTestId="prescription-detail-modal"
    >
      <div className="space-y-4">
        <section className="grid gap-4 md:grid-cols-2">
          <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
            {imageError ? (
              <div className="flex h-72 items-center justify-center text-slate-400">
                <ImageOff size={36} />
              </div>
            ) : fullUrl ? (
              <>
                <button
                  type="button"
                  onClick={() => setShowLightbox(true)}
                  className="block w-full"
                  aria-label="Ver imagen ampliada"
                >
                  <img
                    src={fullUrl}
                    alt="Receta"
                    className="block max-h-96 w-full cursor-zoom-in object-contain bg-slate-50 transition-transform hover:scale-[1.01]"
                  />
                </button>
                <button
                  type="button"
                  onClick={() => setShowLightbox(true)}
                  aria-label="Abrir en pantalla completa"
                  className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md bg-black/60 px-2 py-1 text-[11px] font-semibold text-white shadow hover:bg-black/80"
                >
                  <Maximize2 size={12} /> Ampliar
                </button>
              </>
            ) : (
              <div className="flex h-72 items-center justify-center text-slate-400">
                <Loader2 size={28} className="animate-spin" />
              </div>
            )}
          </div>

          <dl className="space-y-2 text-sm">
            <div>
              <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Tipo</dt>
              <dd className="text-slate-800">
                {editingType && canEdit && onUpdateType ? (
                  <div className="space-y-2">
                    <select
                      value={pendingType}
                      onChange={event => setPendingType(event.target.value as PrescriptionType)}
                      disabled={savingType}
                      className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200 disabled:bg-slate-100"
                    >
                      {PRESCRIPTION_TYPES.map(type => (
                        <option key={type} value={type}>
                          {PRESCRIPTION_TYPE_LABELS[type]}
                        </option>
                      ))}
                    </select>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleSaveType}
                        disabled={savingType}
                        className="inline-flex items-center gap-1 rounded-md bg-sky-600 px-2 py-1 text-xs font-semibold text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                      >
                        {savingType ? (
                          <Loader2 size={11} className="animate-spin" />
                        ) : (
                          <Check size={11} />
                        )}
                        Guardar
                      </button>
                      <button
                        type="button"
                        onClick={handleCancelEditType}
                        disabled={savingType}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <X size={11} /> Cancelar
                      </button>
                    </div>
                    {typeError && (
                      <p role="alert" className="text-xs text-red-700">
                        {typeError}
                      </p>
                    )}
                  </div>
                ) : (
                  <span className="inline-flex items-center gap-2">
                    {PRESCRIPTION_TYPE_LABELS[record.prescriptionType] || record.prescriptionType}
                    {canEdit && onUpdateType && (
                      <button
                        type="button"
                        onClick={() => setEditingType(true)}
                        className="inline-flex items-center gap-1 rounded border border-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-50"
                      >
                        <Pencil size={10} /> Cambiar
                      </button>
                    )}
                  </span>
                )}
                {record.typeUpdatedAt && (
                  <p className="mt-1 text-[10px] text-slate-400">
                    Actualizado {formatDateTimeCL(record.typeUpdatedAt)}
                    {record.typeUpdatedBy ? ` · ${record.typeUpdatedBy}` : ''}
                  </p>
                )}
              </dd>
            </div>

            <div>
              <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                Paciente
              </dt>
              <dd className="text-slate-800">
                {isStock
                  ? PRESCRIPTION_ASSIGNMENT_SCOPE_LABELS.hospitalized_stock
                  : isUnassigned
                    ? 'Sin paciente asignado'
                    : `${record.bedId ?? '—'} · ${record.patientName ?? '—'}`}
                {record.patientRut ? (
                  <span className="ml-1 text-xs text-slate-500">({record.patientRut})</span>
                ) : null}
              </dd>
            </div>

            {record.notes && (
              <div>
                <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                  Notas
                </dt>
                <dd className="text-slate-700 whitespace-pre-wrap">{record.notes}</dd>
              </div>
            )}

            <div>
              <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                Subido
              </dt>
              <dd className="text-slate-700">
                {formatDateTimeCL(record.createdAt)} ·{' '}
                {record.uploader?.displayName ||
                  record.uploader?.email ||
                  (record.uploader?.source === 'qr_pin' ? 'Vía QR + PIN' : 'Personal autenticado')}
              </dd>
            </div>

            <div>
              <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                Respaldo sugerido
              </dt>
              <dd className="text-slate-700">{formatDateTimeCL(record.expiresAt)}</dd>
            </div>

            <div>
              <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                Imagen
              </dt>
              <dd className="text-slate-700">
                {record.image.width}×{record.image.height} px ·{' '}
                <span className="font-semibold">{formatBytes(record.image.byteSize)}</span>{' '}
                <span className="text-slate-400">({record.image.contentType})</span>
              </dd>
            </div>

            {record.patientReassignedAt && (
              <div>
                <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                  Reasignado
                </dt>
                <dd className="text-slate-700">
                  {formatDateTimeCL(record.patientReassignedAt)}
                  {record.patientReassignedBy ? ` · ${record.patientReassignedBy}` : ''}
                </dd>
              </div>
            )}
          </dl>
        </section>

        {showReassign && canEdit ? (
          <PrescriptionReassignDialog
            record={record}
            onClose={() => setShowReassign(false)}
            onSubmit={onReassign}
            selectedDate={selectedDate ?? null}
          />
        ) : (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {deleteError && (
              <p role="alert" className="mr-auto text-xs text-red-700">
                {deleteError}
              </p>
            )}
            {canEdit && (
              <button
                type="button"
                onClick={() => setShowReassign(true)}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                <Pencil size={14} /> Reasignar paciente
              </button>
            )}
            {canDelete && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                Eliminar
              </button>
            )}
          </div>
        )}
      </div>
      {showLightbox && fullUrl && (
        <PrescriptionImageLightbox
          imageUrl={fullUrl}
          onClose={() => setShowLightbox(false)}
          onDelete={canDelete ? handleDelete : undefined}
          deletePending={deleting}
        />
      )}
    </BaseModal>
  );
};
