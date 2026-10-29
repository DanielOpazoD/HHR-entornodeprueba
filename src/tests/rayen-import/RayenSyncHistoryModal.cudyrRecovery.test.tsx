import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RayenSyncHistoryModal } from '@/features/rayen-import/components/RayenSyncHistoryModal';
import { RayenSyncEventSchema } from '@/schemas/zod/dailyRecord';

const eventWith = (kind: string, reason = 'source_unavailable') =>
  RayenSyncEventSchema.parse({
    id: 'synthetic-documentary-recovery',
    sourceDate: '2026-10-27',
    startedAt: '2026-10-28T01:00:00.000Z',
    by: 'Operador sintético',
    status: 'partial',
    coverage: {
      total: 1,
      completed: 1,
      errors: 0,
      sourceErrors: 1,
      completedAt: '2026-10-28T01:01:00.000Z',
      issues: [
        {
          bedId: '*',
          source: 'cudyr',
          reason,
          cudyrRecovery: { kind, targetDate: '2026-10-26' },
        },
      ],
    },
  });

const showEvent = (event: ReturnType<typeof eventWith>) => {
  render(
    <RayenSyncHistoryModal
      isOpen
      onClose={vi.fn()}
      history={[event]}
      targetDate="2026-10-27"
      recovery={null}
      recoveryBusy={false}
      onRecoveryAction={vi.fn()}
    />
  );
  fireEvent.click(screen.getByText('Qué quedó pendiente en la información clínica'));
};
const show = (kind: string, reason?: string) => showEvent(eventWith(kind, reason));

describe('documentary CUDYR outcomes in synchronization history', () => {
  it.each([
    { kind: 'attribution_unreliable', text: /atribuir.*episodio/ },
    { kind: 'documentary_inconclusive', text: /recuperar una categoría/ },
    { kind: 'read_failed', text: /no se pudo consultar/i },
  ])('shows $kind with the night to review after rereading history', ({ kind, text }) => {
    show(kind);
    expect(screen.getByText(text)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Ver censo · 26-10-2026' })).toHaveAttribute(
      'href',
      '/census?date=2026-10-26'
    );
    expect(screen.queryByText(/confirmar el guardado/)).not.toBeInTheDocument();
    expect(screen.queryByText(/No registrado/)).not.toBeInTheDocument();
  });

  it('distinguishes an unconfirmed source archive from an unconfirmed clinical write', () => {
    show('archive_unconfirmed', 'historical_archive_failed');
    expect(screen.getByText(/confirmar el respaldo documental/)).toBeVisible();
    expect(screen.queryByText(/confirmar el guardado histórico/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver censo · 26-10-2026' })).toHaveAttribute(
      'href',
      '/census?date=2026-10-26'
    );
  });

  it('keeps an event with an unknown future detail readable using the existing reason', () => {
    const event = eventWith('future-recovery-detail');
    expect(event.coverage?.issues).toEqual([
      expect.objectContaining({ source: 'cudyr', reason: 'source_unavailable' }),
    ]);
    expect(JSON.parse(JSON.stringify(event)).coverage.issues[0]).not.toHaveProperty(
      'cudyrRecovery'
    );
    show('future-recovery-detail');
    expect(screen.getByText(/no se pudo leer esta información/)).toBeVisible();
  });

  it('reports unavailable census context without guessing a night or linking a bed', () => {
    const event = eventWith('read_failed', 'record_load_failed');
    event.coverage!.issues![0].cudyrRecovery!.targetDate = null;
    showEvent(event);
    expect(screen.getByText(/contexto censal sin comprobar/)).toBeVisible();
    expect(screen.queryByRole('link', { name: /Ver censo/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/consultar el informe/)).not.toBeInTheDocument();
  });

  it.each(['2026-02-30', '2026-13-01', 'not-a-date'])(
    'keeps the historical issue readable when its target date is malformed: %s',
    targetDate => {
      const event = eventWith('documentary_inconclusive');
      event.coverage!.issues![0].cudyrRecovery!.targetDate = targetDate;
      const reread = RayenSyncEventSchema.parse(JSON.parse(JSON.stringify(event)));
      expect(reread.coverage!.issues![0].cudyrRecovery).toBeUndefined();
      showEvent(reread);
      expect(screen.getByText(/no se pudo leer esta información/)).toBeVisible();
      expect(screen.getByRole('link', { name: 'Ver censo · 27-10-2026' })).toHaveAttribute(
        'href',
        '/census?date=2026-10-27'
      );
    }
  );
});
