import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Camera, Trash2 } from 'lucide-react';
import type { DicomCapture } from '@/services/radiology/dicomTypes';
import type { useClinicalFormAnnexes } from './useClinicalFormAnnexes';
import { isClinicalFormRut } from '../../../domain/forms/clinicalFormIdentity';

const Radiology = lazy(() =>
  import('@/components/modals/RadiologyViewerModal').then(module => ({
    default: module.RadiologyViewerModal,
  }))
);
const Thumbnail: React.FC<{ image: DicomCapture }> = ({ image }) => {
  const element = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const next = URL.createObjectURL(new Blob([new Uint8Array(image.png)], { type: 'image/png' }));
    if (element.current) element.current.src = next;
    return () => URL.revokeObjectURL(next);
  }, [image.png]);
  return (
    <img
      ref={element}
      alt={image.caption || 'Captura DICOM'}
      className="clinical-form-annex-thumbnail"
    />
  );
};

export const ClinicalFormAnnexPanel: React.FC<{
  annexes: ReturnType<typeof useClinicalFormAnnexes>;
  patientId: string;
  patientName: string;
  disabled: boolean;
}> = ({ annexes, patientId, patientName, disabled }) => {
  const [open, setOpen] = useState(false);
  return (
    <section className="clinical-form-annexes" aria-label="Anexos para Word">
      <div className="clinical-form-actions">
        <strong>
          Anexos para Word{annexes.images.length ? ` · ${annexes.images.length}/10` : ''}
        </strong>
        <button
          type="button"
          className="clinical-form-button"
          disabled={disabled || !isClinicalFormRut(patientId)}
          title={
            isClinicalFormRut(patientId)
              ? 'Seleccionar imágenes de MMRAD'
              : 'Completa el RUT para buscar imágenes'
          }
          onClick={() => setOpen(true)}
        >
          <Camera size={15} />
          Imágenes MMRAD
        </button>
      </div>
      {annexes.images.length > 0 && (
        <>
          <p className="clinical-form-annex-note">
            Se incluyen al final del Word. El borrador JSON guarda sólo los campos.
          </p>
          <ol className="clinical-form-annex-list">
            {annexes.images.map((image, index) => (
              <li key={image.id}>
                <Thumbnail image={image} />
                <label>
                  Anexo {index + 1}
                  <input
                    className="clinical-form-input"
                    aria-label={`Descripción anexo ${index + 1}`}
                    value={image.caption}
                    maxLength={500}
                    disabled={disabled}
                    onChange={event => annexes.caption(image.id, event.target.value)}
                  />
                </label>
                <div className="clinical-form-actions">
                  <button
                    type="button"
                    className="clinical-form-icon"
                    disabled={disabled || index === 0}
                    aria-label={`Subir anexo ${index + 1}`}
                    onClick={() => annexes.move(image.id, -1)}
                  >
                    <ArrowUp size={15} />
                  </button>
                  <button
                    type="button"
                    className="clinical-form-icon"
                    disabled={disabled || index === annexes.images.length - 1}
                    aria-label={`Bajar anexo ${index + 1}`}
                    onClick={() => annexes.move(image.id, 1)}
                  >
                    <ArrowDown size={15} />
                  </button>
                  <button
                    type="button"
                    className="clinical-form-icon"
                    disabled={disabled}
                    aria-label={`Eliminar anexo ${index + 1}`}
                    onClick={() => annexes.remove(image.id)}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
      {open && !disabled && (
        <Suspense fallback={<p role="status">Abriendo MMRAD…</p>}>
          <Radiology
            isOpen
            onClose={() => setOpen(false)}
            initialPatientRut={patientId}
            autoSearchInitialPatient
            patients={[
              { bedId: 'informe', label: patientName || patientId, patientName, rut: patientId },
            ]}
            onCapture={annexes.add}
          />
        </Suspense>
      )}
    </section>
  );
};
