import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CudyrUpcAnalysisSection } from '@/features/analytics/components/internal/CudyrUpcAnalysisSection';
import type { DailyRecord } from '@/features/analytics/contracts/analyticsDailyRecordContracts';
import type { PatientData } from '@/types/domain/patient';

const buildPatient = (bedId: string, isUPC: boolean): PatientData =>
  ({
    bedId,
    patientName: `Paciente ${bedId}`,
    isBlocked: false,
    admissionDate: '2026-03-09',
    admissionTime: '10:00',
    isUPC,
    upcChecklist: isUPC
      ? {
          uciCriteria: [],
          utiCriteria: ['uti_mon_cardiaca'],
          classification: 'UPC_UTI',
          evaluatedAt: '2026-03-10T02:00:00.000Z',
        }
      : undefined,
    cudyr: {
      changeClothes: 3,
      mobilization: 3,
      feeding: 1,
      elimination: 0,
      psychosocial: 0,
      surveillance: 0,
      vitalSigns: 3,
      fluidBalance: 3,
      oxygenTherapy: 3,
      airway: 3,
      proInterventions: 0,
      skinCare: 0,
      pharmacology: 0,
      invasiveElements: 0,
    },
  }) as PatientData;

const record = {
  date: '2026-03-10',
  beds: {
    R1: buildPatient('R1', false),
    R2: buildPatient('R2', true),
    H1C1: buildPatient('H1C1', false),
  },
  discharges: [],
  transfers: [],
  cma: [],
} as DailyRecord;

describe('CudyrUpcAnalysisSection', () => {
  it('explains the bed-versus-clinical-complexity comparison and renders its cohorts', () => {
    render(<CudyrUpcAnalysisSection records={[record]} />);

    expect(screen.getByTestId('cudyr-upc-analysis')).toBeInTheDocument();
    expect(screen.getByText('Análisis CUDYR y uso de camas críticas')).toBeInTheDocument();
    expect(screen.getAllByText('R1–R4 ocupadas').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('R1–R4 sin criterio UPC').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Complejidad CUDYR por cohorte')).toBeInTheDocument();
    expect(screen.getAllByText('UPC–UTI').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId('cudyr-minsal-equivalence')).toBeInTheDocument();
    expect(screen.getByText('Equivalencia CUDYR/MINSAL para UPC')).toBeInTheDocument();
    expect(screen.getByText('A1 · A2 · B1')).toBeInTheDocument();
    expect(screen.getByText('A3 · B2 · B1')).toBeInTheDocument();
    expect(screen.getByText('Equivalencia por ubicación de cama')).toBeInTheDocument();
    expect(
      screen.getByText('Criterio clínico HHR versus equivalencia CUDYR/MINSAL')
    ).toBeInTheDocument();
    expect(screen.getByText('Calificados UPC–UTI por criterios HHR')).toBeInTheDocument();
    expect(screen.getByText('Calificados UPC–UCI por criterios HHR')).toBeInTheDocument();
    expect(screen.getAllByText('100.0%').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Detalle nocturno por fecha')).toBeInTheDocument();
    expect(screen.getByText('10-03-2026')).toBeInTheDocument();
  });

  it('shows an explicit empty state when the range has no eligible observations', () => {
    render(<CudyrUpcAnalysisSection records={[]} />);

    expect(screen.getByText('Sin evaluaciones CUDYR analizables')).toBeInTheDocument();
  });
});
