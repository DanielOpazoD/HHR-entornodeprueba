import React, { useEffect, useMemo, useState } from 'react';
import { useConfirmDialog } from '@/context/UIContext';
import type { PrescriptionRecord } from '@/types/prescriptionTypes';
import { PrescriptionImageLightbox } from '@/features/prescriptions/components/PrescriptionImageLightbox';
import { resolvePrescriptionImageDownloadUrl } from '@/features/prescriptions/services/prescriptionStorageImageService';

interface PrescriptionPatientLightboxProps {
  record: PrescriptionRecord;
  records: PrescriptionRecord[];
  initialUrl: string;
  onClose: () => void;
  onDelete?: (record: PrescriptionRecord) => Promise<void>;
}

const resolvePatientGroupKey = (record: PrescriptionRecord): string =>
  record.patientRut?.trim() || record.bedId?.trim() || record.patientName?.trim() || record.id;

export const PrescriptionPatientLightbox: React.FC<PrescriptionPatientLightboxProps> = ({
  record,
  records,
  initialUrl,
  onClose,
  onDelete,
}) => {
  const { confirm } = useConfirmDialog();
  const group = useMemo(() => {
    const groupKey = resolvePatientGroupKey(record);
    const matches = records
      .filter(candidate => resolvePatientGroupKey(candidate) === groupKey)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    return matches.length > 0 ? matches : [record];
  }, [record, records]);

  const [index, setIndex] = useState(() =>
    Math.max(
      0,
      group.findIndex(candidate => candidate.id === record.id)
    )
  );
  const [urls, setUrls] = useState<Record<string, string>>({ [record.id]: initialUrl });
  const [imageUrl, setImageUrl] = useState<string | null>(initialUrl);
  const [imageError, setImageError] = useState<string | null>(null);
  const [deletePending, setDeletePending] = useState(false);

  const current = group[index] ?? record;

  useEffect(() => {
    const nextIndex = Math.max(
      0,
      group.findIndex(candidate => candidate.id === record.id)
    );
    setIndex(nextIndex);
    setUrls(prev => ({ ...prev, [record.id]: initialUrl }));
  }, [group, initialUrl, record.id]);

  useEffect(() => {
    const cachedUrl = urls[current.id];
    if (cachedUrl) {
      setImageUrl(cachedUrl);
      setImageError(null);
      return;
    }

    let cancelled = false;
    setImageUrl(null);
    setImageError(null);
    resolvePrescriptionImageDownloadUrl(current.image.storagePath)
      .then(url => {
        if (cancelled) return;
        setImageUrl(url);
        setUrls(prev => ({ ...prev, [current.id]: url }));
      })
      .catch(caught => {
        if (!cancelled) {
          setImageError(caught instanceof Error ? caught.message : 'No se pudo cargar la receta.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [current.id, current.image.storagePath, urls]);

  const handleDelete = async () => {
    if (!onDelete) return;
    const accepted = await confirm({
      title: 'Eliminar receta',
      message:
        'Confirme que el respaldo mensual ya fue realizado antes de eliminar esta receta. Esta acción no se puede deshacer.',
      confirmText: 'Eliminar respaldo',
      cancelText: 'Cancelar',
      variant: 'danger',
    });
    if (!accepted) return;

    setDeletePending(true);
    try {
      await onDelete(current);
      onClose();
    } finally {
      setDeletePending(false);
    }
  };

  if (imageError) {
    return (
      <p
        role="alert"
        className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
      >
        {imageError}
      </p>
    );
  }

  return (
    <PrescriptionImageLightbox
      imageUrl={imageUrl}
      altText={`Receta ${index + 1} de ${group.length}`}
      counterLabel={`${index + 1} / ${group.length}`}
      onClose={onClose}
      onPrevious={() => setIndex(currentIndex => Math.max(0, currentIndex - 1))}
      onNext={() => setIndex(currentIndex => Math.min(group.length - 1, currentIndex + 1))}
      canGoPrevious={index > 0}
      canGoNext={index < group.length - 1}
      onDelete={onDelete ? handleDelete : undefined}
      deletePending={deletePending}
    />
  );
};
