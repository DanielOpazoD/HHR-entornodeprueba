import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { PatientVitalSigns } from '@/types/domain/vitalSigns';

// The read path's chunk fails to load (offline on first use, or a stale hash after a deploy).
vi.mock('@/services/repositories/dailyRecordClinicalDerivedReadService', () => {
  throw new Error('Failed to fetch dynamically imported module');
});

import { VitalsCell } from '@/features/census/components/patient-row/VitalsCell';
import { splitEpisode } from '@/tests/factories/splitEpisode';
import '@/features/census/components/patient-row/VitalsDetailModal';

const DATE = '2026-11-02';

const vital = (hour: number): PatientVitalSigns => ({
  recordedDate: DATE,
  recordedAt: `02-11-2026 ${String(hour).padStart(2, '0')}:00`,
  systolic: 120,
  diastolic: 80,
  heartRate: 70 + hour,
  spo2: 97,
  temperature: 36.6,
  respiratoryRate: 16,
  painEva: null,
  hgt: null,
  insulinUnits: null,
  insulinQuadrant: null,
  observations: null,
  author: '',
  authorRole: '',
});

describe('vitals window without its read path (D10)', () => {
  it('shows unavailable history when the read path cannot load', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    render(
      <table>
        <tbody>
          <tr>
            <VitalsCell
              data={splitEpisode({
                patientName: 'Paciente Sintético',
                age: '40',
                clinicalEpisodeId: 'ep_synthetic',
                vitalSigns: vital(9),
              })}
              date={DATE}
              clinicalEpisodeId="ep_synthetic"
              layoutGeneration="gen_synthetic_a"
            />
          </tr>
        </tbody>
      </table>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Ver signos vitales' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Historial no disponible');
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
    expect(screen.getByText('Última toma')).toBeInTheDocument();
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});
