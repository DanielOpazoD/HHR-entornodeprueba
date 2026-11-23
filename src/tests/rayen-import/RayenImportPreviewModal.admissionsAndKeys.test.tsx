import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EMPTY_PATIENT } from '@/constants/patient';
import { RayenImportPreviewModal } from '@/features/rayen-import/components/RayenImportPreviewModal';
import type { CensusImportDiff } from '@/features/rayen-import/contracts/censusImportDiff';

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
            { field: 'pathology', from: '', to: 'Producto único, nacido en hospital' },
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

describe('RayenImportPreviewModal previous-day admissions', () => {
  it('explains that a madrugada mother and newborn will also be filed in the prior night shift', () => {
    const onConfirm = vi.fn();
    const diff = {
      admissions: [
        {
          bedId: 'H4C1',
          patient: { ...EMPTY_PATIENT, bedId: 'H4C1', patientName: 'Miduc' },
          isCma: false,
        },
      ],
      updates: [],
      moves: [],
      discharges: [],
      pendingAdministrativeDischarges: [],
      conflicts: [],
      unchangedCount: 0,
      previousDayEdits: [
        {
          day: '2026-07-25',
          reason: 'admission-night-shift-correction',
          patientNames: ['Miduc Enudovur Mopef Tinu Genavi', 'RN de Miduc Tinu Genavi'],
          recordExists: true,
          withinEditingWindow: true,
          isSigned: false,
        },
      ],
      summary: {
        admissions: 1,
        updates: 0,
        moves: 0,
        discharges: 0,
        pendingAdministrativeDischarges: 0,
        conflicts: 0,
        unchanged: 0,
      },
    } as CensusImportDiff;

    render(
      <RayenImportPreviewModal
        isOpen
        diff={diff}
        error={null}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByText('Ingreso turno noche:')).toBeVisible();
    expect(
      screen.getByText(/Miduc Enudovur Mopef Tinu Genavi, RN de Miduc Tinu Genavi/)
    ).toBeVisible();
    expect(screen.getByLabelText('Acepto modificar los días previos indicados')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar solo censo seleccionado' }));
    expect(onConfirm).toHaveBeenLastCalledWith(false);

    fireEvent.click(screen.getByLabelText('Acepto modificar los días previos indicados'));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar censo y días previos' }));
    expect(onConfirm).toHaveBeenLastCalledWith(true);
  });

  it('no pide aceptación cuando ninguna edición de día previo escribirá algo', () => {
    const diff = {
      admissions: [],
      updates: [],
      moves: [],
      discharges: [],
      pendingAdministrativeDischarges: [],
      conflicts: [],
      unchangedCount: 0,
      previousDayEdits: [
        {
          day: '2026-07-25',
          reason: 'admission-night-shift-correction',
          patientNames: ['Miduc Enudovur Mopef Tinu Genavi'],
          recordExists: true,
          withinEditingWindow: true,
          isSigned: true,
        },
      ],
      summary: {
        admissions: 0,
        updates: 0,
        moves: 0,
        discharges: 0,
        pendingAdministrativeDischarges: 0,
        conflicts: 0,
        unchanged: 0,
      },
    } as CensusImportDiff;

    render(
      <RayenImportPreviewModal
        isOpen
        diff={diff}
        error={null}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByText(/día ya firmado — se omitirá/)).toBeVisible();
    expect(
      screen.queryByLabelText('Acepto modificar los días previos indicados')
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Listo' })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Confirmar/ })).not.toBeInTheDocument();
  });
});

describe('already filed historical discharge preview', () => {
  it.each([false, true])(
    'explains removal without promising another discharge (historical repair %s)',
    repair => {
      const diff: CensusImportDiff = {
        admissions: [],
        updates: [],
        moves: [],
        conflicts: [],
        pendingAdministrativeDischarges: [],
        unchangedCount: 0,
        discharges: [
          {
            bedId: 'R3',
            rut: 'synthetic',
            patientName: 'Paciente de prueba',
            kind: 'alta',
            status: 'Vivo',
            reason: 'administrative-discharge',
            correctedDay: '2026-09-26',
            historicalMovementRecorded: true,
          },
        ],
        summary: {
          admissions: 0,
          updates: 0,
          moves: 0,
          discharges: 1,
          conflicts: 0,
          pendingAdministrativeDischarges: 0,
          unchanged: 0,
        },
        previousDayEdits: repair
          ? [
              {
                day: '2026-09-26',
                reason: 'discharge-day-correction',
                patientNames: ['Paciente de prueba'],
                recordExists: true,
                withinEditingWindow: true,
                isSigned: false,
              },
            ]
          : [],
      };
      render(
        <RayenImportPreviewModal
          isOpen
          diff={diff}
          error={null}
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />
      );
      expect(screen.getByText(/ya registrado el 26-09-2026; se retirará la copia/)).toBeVisible();
      expect(screen.queryByText(/se grabará el/)).not.toBeInTheDocument();
    }
  );
});
