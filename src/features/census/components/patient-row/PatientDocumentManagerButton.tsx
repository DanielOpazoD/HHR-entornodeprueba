import React from 'react';
import { Folder } from 'lucide-react';
import { ClinicalActionButton } from './ClinicalActionButton';

interface PatientDocumentManagerButtonProps {
  patientName: string;
  count: number | null;
  loading?: boolean;
  onOpen: () => void;
}

export const PatientDocumentManagerButton: React.FC<PatientDocumentManagerButtonProps> = ({
  patientName,
  count,
  loading = false,
  onOpen,
}) => {
  const title = loading
    ? `Cargando documentos de ${patientName}`
    : count === null
      ? `Abrir Gestor documental de ${patientName}; cantidad no disponible`
      : count === 0
        ? `Abrir Gestor documental de ${patientName}; sin archivos`
        : `Abrir Gestor documental de ${patientName}; ${count} ${count === 1 ? 'archivo' : 'archivos'}`;

  return (
    <ClinicalActionButton
      tone="documents"
      label={title}
      title={title}
      loading={loading}
      muted={count === 0}
      badge={count ?? undefined}
      onClick={onOpen}
    >
      <Folder />
    </ClinicalActionButton>
  );
};
