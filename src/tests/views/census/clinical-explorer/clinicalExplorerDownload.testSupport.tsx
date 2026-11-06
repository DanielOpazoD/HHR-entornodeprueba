// Synthetic patients, documents and answers shared by the explorer download tests.
import { fireEvent, render, screen } from '@testing-library/react';
import { PDFDocument } from 'pdf-lib';
import PizZip from 'pizzip';
import { vi } from 'vitest';
import type { AuditDocumentsResult } from '@/features/audit-documents/eloisa-history';
import type { MMRADExam } from '@/services/radiology/mmradService';
import type { LabAnalysisData } from '@/types/domain/labAnalyticsTypes';
import { BEDS } from '@/constants/beds';
import { ClinicalExplorerHeader } from '@/features/census/components/clinical-explorer/ClinicalExplorerHeader';
import { listClinicalExplorerPatients } from '@/features/census/controllers/clinicalExplorerController';
import { DataFactory } from '@/tests/factories/DataFactory';

export const RUT = '12.345.678-5';
export const [patient, otherPatient] = listClinicalExplorerPatients({
  visibleBeds: BEDS.filter(bed => !bed.isExtra),
  beds: {
    R1: DataFactory.createMockPatient('R1', {
      patientName: 'PACIENTE SINTÉTICO',
      rut: RUT,
      clinicalEpisodeId: 'ep-1',
      admissionDate: '2026-11-01',
    }),
    R2: DataFactory.createMockPatient('R2', {
      patientName: 'OTRO SINTÉTICO',
      rut: '5.844.865-6',
      clinicalEpisodeId: 'ep-2',
      admissionDate: '2026-11-03',
    }),
  },
});

/** A synthetic PDF whose page width tells which source it came from. */
export const syntheticPdf = async (width: number): Promise<Uint8Array> => {
  const doc = await PDFDocument.create();
  doc.addPage([width, 400]);
  return doc.save();
};

export const readBytes = (blob: Blob): Promise<Uint8Array> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });

export const HISTORY_NAME =
  'PACIENTE SINTETICO - 12345678-5 - Historial hospitalizacion - ingreso 2026-11-01.pdf';

export const historyArchive = async (): Promise<Blob> => {
  const zip = new PizZip();
  zip.file(
    '00 Resumen.csv',
    '\uFEFFRUT;Nombre;Ingreso;Egreso;Documento;Resultado;Archivo\r\n' +
      `12.345.678-5;PACIENTE SINTÉTICO;2026-11-01;En curso;Historial de hospitalización;Descargado;${HISTORY_NAME}\r\n`
  );
  zip.file(HISTORY_NAME, await syntheticPdf(100), { binary: true });
  return new Blob([zip.generate({ type: 'uint8array' })], { type: 'application/zip' });
};

export const analysis: LabAnalysisData = {
  trendGroups: [],
  examDates: [],
  microbiologyEntries: [],
  comparison: {
    Creatinina: {
      '02/11/2026 08:30': {
        section: 'BIOQUIMICA',
        analysis: 'Creatinina',
        result: '1.1',
        unit: 'mg/dL',
        refValue: '0.7 - 1.3',
      },
    },
  },
};

export const ctExam: MMRADExam = {
  nombre_examen: 'TC tórax',
  fecha_examen: '03/11/2026 10:15',
  fecha_asignacion: '03/11/2026',
  mod: 'CT',
  estado: 'Validado',
  pdf_url: 'https://mmrad.example/pdf/synthetic',
  dicom_url: null,
  informe_html_url: null,
  report: null,
};
export const xRay: MMRADExam = { ...ctExam, nombre_examen: 'Rx tórax', mod: 'CR', pdf_url: 'rx' };

export const okRecord = async (): Promise<AuditDocumentsResult> => ({
  ok: true,
  documentCount: 1,
  failedCount: 0,
  archive: await historyArchive(),
  summary: [
    {
      run: '123456785',
      name: 'PACIENTE SINTETICO',
      hospitalizations: 1,
      unverified: 0,
      downloaded: 1,
      reconstructed: 0,
      incomplete: 0,
      failed: 0,
    },
  ],
});

export const renderHeader = (current = patient!) =>
  render(
    <ClinicalExplorerHeader
      patient={current}
      onRequestExams={vi.fn()}
      censusDate="2026-11-06"
      indicationDate={null}
    />
  );

export const openDialog = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Descargar ficha, exámenes e informes' }));
  return screen.getByRole('dialog', { name: /Descargar ficha, exámenes e informes/ });
};
