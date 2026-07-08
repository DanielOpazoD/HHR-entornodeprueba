import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ClinicalDocumentIeehPanel } from '@/features/clinical-documents/components/ClinicalDocumentIeehPanel';
import { createClinicalDocumentDraft } from '@/features/clinical-documents/domain/factories';
import { createEmptyIeehDraft } from '@/features/clinical-documents/controllers/clinicalDocumentIeehController';

const buildDocument = () =>
  createClinicalDocumentDraft({
    templateId: 'epicrisis',
    hospitalId: 'hhr',
    actor: {
      uid: 'u1',
      email: 'doctor@test.com',
      displayName: 'Doctor Test',
      role: 'doctor_urgency',
    },
    episode: {
      patientRut: '11.111.111-1',
      patientName: 'Paciente Test',
      episodeKey: '11.111.111-1__2026-03-06',
      admissionDate: '2026-03-06',
      sourceDailyRecordDate: '2026-03-06',
      sourceBedId: 'R1',
      specialty: 'Cirugía',
    },
    patientFieldValues: {
      nombre: 'Paciente Test',
      rut: '11.111.111-1',
    },
    medico: 'Doctor Test',
    especialidad: 'Cirugía',
  });

describe('ClinicalDocumentIeehPanel', () => {
  it('starts collapsed even when a saved draft already exists', () => {
    const draft = {
      ...createEmptyIeehDraft(),
      cie10Code: 'A00',
      cie10Description: 'Cólera',
      diagnosticoPrincipal: 'Cólera',
    };

    render(
      <ClinicalDocumentIeehPanel
        document={buildDocument()}
        draft={draft}
        canEdit={true}
        onPatchDraft={vi.fn()}
        onClearDraft={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: /egreso estadístico/i })).toBeInTheDocument();
    expect(screen.queryByText(/diagnóstico principal \(cie-10\)/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /egreso estadístico/i }));

    expect(screen.getByText(/diagnóstico principal \(cie-10\)/i)).toBeInTheDocument();
  });

  it('configures IEEH-only doctor data without changing the epicrisis metadata', async () => {
    const user = userEvent.setup();
    const onPatchDraft = vi.fn();
    const document = buildDocument();

    render(
      <ClinicalDocumentIeehPanel
        document={document}
        draft={createEmptyIeehDraft()}
        canEdit={true}
        onPatchDraft={onPatchDraft}
        onClearDraft={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: /egreso estadístico/i }));
    expect(screen.getByRole('button', { name: /imprimir ieeh/i })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: /configurar médico ieeh/i }));
    await user.type(screen.getByLabelText(/nombre médico tratante/i), 'Ana María Pérez Soto');
    await user.type(screen.getByLabelText(/especialidad médico tratante/i), 'Cirugía Adulto');
    await user.type(screen.getByLabelText(/rut médico tratante/i), '12.345.678-9');

    expect(onPatchDraft).toHaveBeenLastCalledWith(
      expect.objectContaining({
        tratanteNombreCompleto: 'Ana María Pérez Soto',
        tratanteEspecialidad: 'Cirugía Adulto',
        tratanteRut: '12.345.678-9',
      })
    );
    expect(document.medico).toBe('Doctor Test');
    expect(document.especialidad).toBe('Cirugía');
  });
});
