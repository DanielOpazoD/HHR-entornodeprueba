import React, { useEffect, useState } from 'react';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { fetchDicomStudy } from '@/services/radiology/mmradDicomService';
import type { DicomStudy } from '@/services/radiology/dicomTypes';
import type { DicomViewerDialogProps } from './DicomViewerDialog';
import { DicomSeriesView } from './DicomSeriesView';
import { createDicomStudyPrefetch } from '@/services/radiology/dicomStudyPrefetch';
import { DicomPatientBar } from './DicomPatientBar';
import './dicomViewer.css';
import './dicomProgressive.css';

const DicomViewerSession: React.FC<DicomViewerDialogProps> = ({
  link,
  patientId,
  title,
  patientName,
  studyDate,
  reportLink,
  onCapture,
}) => {
  const [study, setStudy] = useState<DicomStudy | null>(null);
  const [prefetch, setPrefetch] = useState<ReturnType<typeof createDicomStudyPrefetch>>();
  const [seriesUid, setSeriesUid] = useState('');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    // Code only: overlap engine loading with metadata. Instances still require verified study data.
    void import('@/services/radiology/dicomRuntime').catch(() => undefined);
    let session: ReturnType<typeof createDicomStudyPrefetch> | undefined;
    void fetchDicomStudy(link, patientId, controller.signal)
      .then(result => {
        if (controller.signal.aborted) return;
        session = createDicomStudyPrefetch(result);
        setPrefetch(session);
        setStudy(result);
        setSeriesUid(
          result.series.find(item => item.modality === 'CT')?.uid || result.series[0].uid
        );
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError(reason instanceof Error ? reason.message : 'No se pudo abrir MMRAD.');
      });
    return () => {
      controller.abort();
      session?.dispose();
    };
  }, [link, patientId, attempt]);
  const series = study?.series.find(item => item.uid === seriesUid);
  return (
    <div
      className="dicom-viewer"
      onKeyDown={event => {
        if (event.key !== 'Escape') return;
        const panel = event.currentTarget.querySelector<HTMLDetailsElement>('details[open]');
        if (!panel) {
          if (document.fullscreenElement === event.currentTarget.closest('.dicom-dialog')) {
            event.preventDefault();
            event.stopPropagation();
            void document.exitFullscreen().catch(() => undefined);
          }
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        panel.open = false;
        panel.querySelector('summary')?.focus();
      }}
    >
      <div className="dicom-study-bar">
        <DicomPatientBar
          patientId={patientId}
          patientName={patientName}
          date={study?.date || studyDate}
          reportLink={reportLink}
        />
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
      {study && series && prefetch && (
        <DicomSeriesView
          key={`${study.uid}:${series.uid}`}
          study={study}
          prefetch={prefetch}
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
