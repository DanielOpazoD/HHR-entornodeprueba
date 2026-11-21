import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { EMPTY_PATIENT } from '@/constants/patient';
import type { CensusImportDiff } from '@/features/rayen-import';
import { RayenImportPreviewModal } from '@/features/rayen-import/components/RayenImportPreviewModal';

describe('RayenImportPreviewModal Cuna RN identity', () => {
  it('renders principal and Cuna RN updates in one bed without duplicate React keys', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const mother = {
      ...EMPTY_PATIENT,
      bedId: 'H4C1',
      patientName: 'Serimi Vibe Muvapu Tode Acid',
    };
    const diff: CensusImportDiff = {
      admissions: [],
      updates: [
        {
          bedId: 'H4C1',
          rut: '10.000.123-3',
          patientName: mother.patientName,
          changes: [{ field: 'pathology', from: '', to: 'Parto único espontáneo' }],
          patient: mother,
          source: { encounterId: 'mother-episode' } as never,
        },
        {
          bedId: 'H4C1',
          rut: '10.000.123-3',
          patientName: 'RN de Serimi Tode Acid',
          changes: [
            {
              field: 'pathology',
              from: '',
              to: 'Producto único, nacido en hospital',
            },
            {
              field: 'clinicalCrib',
              from: undefined,
              to: { ...EMPTY_PATIENT, patientName: 'RN de Serimi Tode Acid' },
            },
          ],
          patient: mother,
          source: { encounterId: 'newborn-episode' } as never,
        },
      ],
      moves: [],
      discharges: [],
      pendingAdministrativeDischarges: [],
      conflicts: [],
      unchangedCount: 0,
      summary: {
        admissions: 0,
        updates: 2,
        moves: 0,
        discharges: 0,
        pendingAdministrativeDischarges: 0,
        conflicts: 0,
        unchanged: 0,
      },
    };

    try {
      render(
        <RayenImportPreviewModal
          isOpen
          diff={diff}
          error={null}
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />
      );

      expect(screen.getByText(/Serimi Vibe Muvapu Tode Acid:/)).toBeVisible();
      expect(screen.getByText(/RN de Serimi Tode Acid:/)).toBeVisible();
      expect(consoleError.mock.calls.some(call => String(call[0]).includes('same key'))).toBe(
        false
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it('keeps composite keys distinct when subjects and fields contain delimiters', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const patient = { ...EMPTY_PATIENT, bedId: 'H4C1', patientName: 'Paciente A' };
    const diff: CensusImportDiff = {
      admissions: [],
      updates: [
        {
          bedId: 'H4C1',
          rut: '',
          patientName: 'Paciente A',
          changes: [{ field: 'pathology', from: '', to: 'Diagnóstico A' }],
          patient,
          source: { encounterId: 'a-clinicalCrib' } as never,
        },
        {
          bedId: 'H4C1',
          rut: '',
          patientName: 'Paciente B',
          changes: [
            { field: 'clinicalCrib', from: undefined, to: { ...patient, patientName: 'RN B' } },
            { field: 'pathology', from: '', to: 'Diagnóstico B' },
          ],
          patient: { ...patient, patientName: 'Paciente B' },
          source: { encounterId: 'a' } as never,
        },
      ],
      moves: [],
      discharges: [],
      pendingAdministrativeDischarges: [],
      conflicts: [],
      unchangedCount: 0,
      summary: {
        admissions: 0,
        updates: 2,
        moves: 0,
        discharges: 0,
        pendingAdministrativeDischarges: 0,
        conflicts: 0,
        unchanged: 0,
      },
    };

    try {
      render(
        <RayenImportPreviewModal
          isOpen
          diff={diff}
          error={null}
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />
      );

      expect(screen.getByText(/Paciente A:/)).toBeVisible();
      expect(screen.getByText(/Paciente B:/)).toBeVisible();
      expect(consoleError.mock.calls.some(call => String(call[0]).includes('same key'))).toBe(
        false
      );
    } finally {
      consoleError.mockRestore();
    }
  });
});
