import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { CudyrArchiveStatus } from '@/features/cudyr/components/CudyrArchiveStatus';
import { buildCudyrReport } from '@/services/cudyr/cudyrReportModel';
import { confirmedReportInput } from '../../services/cudyr/reportFixtures';

it.each(['unapproved', 'pending', 'saved'] as const)(
  'shows the actual official persistence state: %s',
  state => {
    const data = buildCudyrReport(confirmedReportInput());
    if (state !== 'unapproved')
      data.coverage.forEach(day => {
        day.reconstructionApproval = {
          approvedAt: data.generatedAt,
          approvedBy: 'Responsable',
          reason: 'Comprobado',
        };
      });
    if (state === 'saved') data.officialSnapshot = { version: 'v1', savedAt: data.generatedAt };
    render(<CudyrArchiveStatus data={data} busy={false} error="" />);
    expect(
      screen.getByText(
        state === 'saved'
          ? 'Oficial · guardado en HHR'
          : state === 'pending'
            ? 'Copia oficial pendiente'
            : 'Datos consultados en HHR'
      )
    ).toBeInTheDocument();
    if (state !== 'saved')
      expect(screen.queryByText('Oficial · guardado en HHR')).not.toBeInTheDocument();
  }
);
