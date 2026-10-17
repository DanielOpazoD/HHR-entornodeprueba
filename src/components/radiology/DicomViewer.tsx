import React, { useEffect, useState } from 'react';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { fetchDicomStudy } from '@/services/radiology/mmradDicomService';
import type { DicomStudy } from '@/services/radiology/dicomTypes';
import type { DicomViewerDialogProps } from './DicomViewerDialog';
import { DicomSeriesView } from './DicomSeriesView';
import './dicomViewer.css';

const DicomViewerSession: React.FC<DicomViewerDialogProps> = ({
  link,
  patientId,
  title,
  onCapture,
}) => {
  const [study, setStudy] = useState<DicomStudy | null>(null);
  const [seriesUid, setSeriesUid] = useState('');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetchDicomStudy(link, patientId, controller.signal)
      .then(result => {
        if (controller.signal.aborted) return;
        setStudy(result);
        setSeriesUid(
          result.series.find(item => item.modality === 'CT')?.uid || result.series[0].uid
        );
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError(reason instanceof Error ? reason.message : 'No se pudo abrir MMRAD.');
      });
    return () => controller.abort();
  }, [link, patientId, attempt]);
  const series = study?.series.find(item => item.uid === seriesUid);
  return (
    <div
      className="dicom-viewer"
      onKeyDown={event => {
        if (event.key !== 'Escape') return;
        const panel = event.currentTarget.querySelector<HTMLDetailsElement>('details[open]');
        if (!panel) return;
        event.preventDefault();
        event.stopPropagation();
        panel.open = false;
        panel.querySelector('summary')?.focus();
      }}
    >
      <div className="dicom-study-bar">
        <span className="dicom-patient">{patientId}</span>
        {study && (
          <label>
            Serie
            <select
              aria-label="Serie DICOM"
              value={seriesUid}
              onChange={event => setSeriesUid(event.target.value)}
            >
              {study.series.map(item => (
                <option key={item.uid} value={item.uid}>
                  {item.number} · {item.description || item.modality || 'Serie'} ·{' '}
                  {item.instances.length} imágenes
                </option>
              ))}
            </select>
          </label>
        )}
        <a
          aria-label="MMRAD externo"
          title="Abrir MMRAD externo"
          href={link}
          target="_blank"
          rel="noopener noreferrer"
        >
          <ExternalLink size={14} />
          <span className="dicom-external-label">MMRAD</span>
        </a>
      </div>
      {error ? (
        <div className="dicom-status" role="alert">
          {error}
          <button
            type="button"
            onClick={() => {
              setStudy(null);
              setError('');
              setAttempt(value => value + 1);
            }}
          >
            <RefreshCw size={14} />
            Reintentar
          </button>
        </div>
      ) : !study ? (
        <p className="dicom-status" role="status">
          Conectando con MMRAD…
        </p>
      ) : null}
      {study && series && (
        <DicomSeriesView
          key={`${study.uid}:${series.uid}`}
          study={study}
          series={series}
          title={title}
          onCapture={onCapture}
        />
      )}
    </div>
  );
};
const DicomViewer: React.FC<DicomViewerDialogProps> = props => (
  <DicomViewerSession key={`${props.patientId}:${props.link}`} {...props} />
);
export default DicomViewer;
