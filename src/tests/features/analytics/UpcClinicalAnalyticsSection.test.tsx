import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { UpcClinicalAnalyticsSection } from '@/features/analytics/components/internal/UpcClinicalAnalyticsSection';
import type { DailyRecord } from '@/features/analytics/contracts/analyticsDailyRecordContracts';
import type { PatientData } from '@/types/domain/patient';
import { PatientStatus, Specialty } from '@/types/domain/patientClassification';

const record = {
  date: '2026-03-10',
  beds: {
    R1: {
      bedId: 'R1',
      isBlocked: false,
      bedMode: 'Cama',
      hasCompanionCrib: false,
      patientName: 'Paciente UPC',
      rut: '11.111.111-1',
      age: '50',
      pathology: 'Insuficiencia respiratoria',
      specialty: Specialty.MEDICINA,
      status: PatientStatus.ESTABLE,
      admissionDate: '2026-03-01',
      hasWristband: true,
      devices: [],
      surgicalComplication: false,
      isUPC: true,
      upcChecklist: {
        uciCriteria: ['uci_vmi'],
        utiCriteria: [],
        classification: 'UPC_UCI',
        evaluatedAt: '2026-03-10T02:00:00.000Z',
      },
    } as PatientData,
  },
  discharges: [],
  transfers: [],
  cma: [],
} as DailyRecord;

describe('UpcClinicalAnalyticsSection', () => {
  it('shows structured UPC patient identity, classification and criteria', () => {
    render(<UpcClinicalAnalyticsSection records={[record]} />);

    expect(screen.getByTestId('upc-clinical-analytics')).toBeInTheDocument();
    expect(screen.getByText('Pacientes UPC según criterios HHR')).toBeInTheDocument();
    expect(screen.getByText('Paciente UPC')).toBeInTheDocument();
    expect(screen.getByText('11.111.111-1')).toBeInTheDocument();
    expect(screen.getByText('Insuficiencia respiratoria')).toBeInTheDocument();
    expect(screen.getByText('Ventilación mecánica invasiva (VMI)')).toBeInTheDocument();
  });

  it('shows an empty state without structured classifications', () => {
    render(<UpcClinicalAnalyticsSection records={[]} />);
    expect(screen.getByText('Sin pacientes UPC clasificables')).toBeInTheDocument();
  });

  it('reports excluded UPC observations without identity', () => {
    const identified = record.beds.R1 as PatientData;
    const anonymous = {
      ...identified,
      bedId: 'R2',
      patientName: '',
      rut: '',
    };
    const recordWithAnonymous = {
      ...record,
      beds: { R1: identified, R2: anonymous },
    } as DailyRecord;

    render(<UpcClinicalAnalyticsSection records={[recordWithAnonymous]} />);

    expect(
      screen.getByText(
        'Se excluyeron 1 observaciones UPC sin nombre ni documento de identidad. No participan en totales, porcentajes ni detalle.'
      )
    ).toBeInTheDocument();
  });
});
