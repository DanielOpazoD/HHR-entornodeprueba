import React, { useState, useSyncExternalStore } from 'react';
import { Copy, ListChecks, Trash2 } from 'lucide-react';
import type {
  DicomMeasurement,
  DicomMeasurementStore,
} from '@/services/radiology/dicomMeasurementStore';
import {
  dicomMeasurementLabel,
  dicomMeasurementPlace,
  dicomMeasurementsText,
} from '@/services/radiology/dicomMeasurementReport';
import { DicomVolumeCalculator } from './DicomVolumeCalculator';
import './dicomMeasurements.css';

export const useDicomMeasurements = (store: DicomMeasurementStore) =>
  useSyncExternalStore(store.subscribe, store.list, store.list);

/**
 * Every measurement of the open viewer, across series and views. A click shows its slice;
 * «Copiar medidas» copies plain text without patient identifiers for the clinical note.
 */
export const DicomMeasurementsPanel: React.FC<{
  store: DicomMeasurementStore;
  exam: string;
  focus: (item: DicomMeasurement) => void;
  sliceInterval?: () => number | undefined;
}> = ({ store, exam, focus, sliceInterval }) => {
  const items = useDicomMeasurements(store);
  // The copy message belongs to the list it copied; any change to the list hides it.
  const [copied, setCopied] = useState<{
    items: readonly DicomMeasurement[];
    status: string;
    manual: string;
  } | null>(null);
  const current = copied?.items === items ? copied : null;
  const status = current?.status ?? '';
  const manual = current?.manual ?? '';
  const copy = async () => {
    const text = dicomMeasurementsText(items, exam);
    try {
      await navigator.clipboard.writeText(text);
      setCopied({ items, manual: '', status: 'Medidas copiadas. Pégalas en la nota clínica.' });
    } catch {
      // Without clipboard permission the text stays selectable here.
      setCopied({
        items,
        manual: text,
        status: 'No se pudo copiar automáticamente; selecciona y copia el texto.',
      });
    }
  };
  return (
    <details className="dicom-popover dicom-measurements">
      <summary aria-label={`Medidas (${items.length})`} title="Medidas de esta sesión">
        <ListChecks size={15} aria-hidden="true" />
        <span>{items.length}</span>
      </summary>
      <div className="dicom-popover-body">
        {items.length ? (
          <ol className="dicom-measurement-list" aria-label="Lista de medidas">
            {items.map((item, index) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="dicom-measurement-go"
                  title="Ir al corte de esta medida"
                  onClick={() => focus(item)}
                >
                  <span>{dicomMeasurementPlace(item)}:</span>{' '}
                  <span>{dicomMeasurementLabel(item)}</span>
                </button>
                <button
                  type="button"
                  aria-label={`Borrar medida ${index + 1}`}
                  title="Borrar esta medida"
                  onClick={() => store.remove(item.id)}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <small>Sin medidas. Duran mientras el visor está abierto.</small>
        )}
        <div className="dicom-button-group">
          <button type="button" disabled={!items.length} onClick={() => void copy()}>
            <Copy size={14} aria-hidden="true" /> Copiar medidas
          </button>
          <button type="button" disabled={!items.length} onClick={() => store.clear()}>
            Borrar todas
          </button>
        </div>
        {status && <p role="status">{status}</p>}
        {manual && (
          <textarea
            readOnly
            aria-label="Texto de las medidas"
            value={manual}
            rows={Math.min(6, manual.split('\n').length + 1)}
            onFocus={event => event.currentTarget.select()}
          />
        )}
        <DicomVolumeCalculator items={items} intervalOf={sliceInterval} />
      </div>
    </details>
  );
};
