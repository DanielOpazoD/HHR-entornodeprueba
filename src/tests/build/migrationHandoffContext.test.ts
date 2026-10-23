// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { planHandoffContext as actualPlanHandoffContext } from '../../../scripts/migration/planHandoffContext.mjs';

const planHandoffContext = (data: {
  source: Record<string, unknown>;
  target: Record<string, unknown>;
  dates: string[];
  throughDate: string;
}) => actualPlanHandoffContext(data, new Date('2026-10-16T18:00:00Z'));

const date = '2026-07-14';
const input = (old: object = {}, current: object = {}) => ({
  source: { [date]: { date, ...old } },
  target: { [date]: { date, ...current } },
  dates: [date],
  throughDate: '2026-10-15',
});
describe('stored handoff shift context migration proposal', () => {
  it('copies explicit unchecked values while preserving existing corrected choices', () => {
    const { patches, report } = planHandoffContext(
      input(
        {
          handoffDayChecklist: {
            escalaBraden: false,
            escalaRiesgoCaidas: true,
            escalaRiesgoLPP: false,
          },
          handoffNightChecklist: { categorizacionCudyr: true, conteoNoControlados: false },
        },
        {
          handoffDayChecklist: { escalaRiesgoCaidas: false, escalaRiesgoLPP: null },
        }
      )
    );
    expect(patches.map(p => [p.path.join('.'), p.value])).toEqual([
      ['handoffDayChecklist.escalaBraden', false],
      ['handoffNightChecklist.categorizacionCudyr', true],
      ['handoffNightChecklist.conteoNoControlados', false],
    ]);
    expect(report.cases.filter(c => c.state === 'preserve_target')).toHaveLength(2);
    expect(report.cloudWrites).toBe(0);
    expect(report.authorizesMigration).toBe(false);
  });
  it('preserves day/night separation without importing the visual night fallback', () => {
    const { patches } = planHandoffContext(input({ handoffNovedadesDayShift: 'Aviso largo' }));
    expect(patches).toEqual([
      expect.objectContaining({
        date,
        path: ['handoffNovedadesDayShift'],
        value: 'Aviso largo',
        expectedPresent: false,
      }),
    ]);
    const night = planHandoffContext(
      input(
        { handoffNovedadesNightShift: 'Aviso nocturno' },
        {
          handoffNovedadesNightShift: '  ',
          handoffNovedadesDayShift: 'Corregido',
        }
      )
    );
    expect(night.patches[0]).toMatchObject({
      path: ['handoffNovedadesNightShift'],
      value: 'Aviso nocturno',
      expectedValue: '  ',
      expectedPresent: true,
    });
    expect(
      planHandoffContext(
        input(
          { handoffNovedadesDayShift: 'Viejo' },
          {
            handoffNovedadesDayShift: 'Corregido',
          }
        )
      ).patches
    ).toEqual([]);
  });
  it('does not infer dates, checkbox truth, staffing or clinical CUDYR', () => {
    const plan = planHandoffContext(
      input({
        handoffNightChecklist: {
          estadistica: 'true',
          encuestaUTI: 1,
          conteoNoControladosProximaFecha: '2026-08-01',
          conteoMedicamentoProximaFecha: '2026-02-30',
        },
        nursesDayShift: ['Firma histórica'],
        beds: { R1: { cudyr: { category: 'B1' } } },
        handoffNovedadesNightShift: '',
      })
    );
    expect(plan.patches).toHaveLength(1);
    expect(plan.patches[0].path).toEqual([
      'handoffNightChecklist',
      'conteoNoControladosProximaFecha',
    ]);
    expect(plan.report.cases.filter(c => c.state === 'review')).toHaveLength(3);
    expect(
      planHandoffContext(
        input(
          { handoffDayChecklist: { escalaBraden: true } },
          {
            handoffDayChecklist: null,
          }
        )
      ).patches
    ).toEqual([]);
  });
  it('is idempotent and never modifies the inputs or reports patient/staff/text contents', () => {
    const data = input({
      handoffDayChecklist: { escalaBraden: true },
      handoffNovedadesDayShift: 'Texto privado sintético',
      nursesDayShift: ['Firma privada'],
    });
    const before = structuredClone(data);
    const plan = planHandoffContext(data);
    expect(data).toEqual(before);
    expect(JSON.stringify(plan.report)).not.toContain('Texto privado');
    expect(JSON.stringify(plan.report)).not.toContain('Firma privada');
    const after = input({ ...data.source[date] }, { ...data.source[date] });
    expect(planHandoffContext(after).patches).toEqual([]);
  });
  it('requires explicit closed-day scope and matching daily documents', () => {
    expect(() => planHandoffContext({ ...input(), dates: [] })).toThrow('scope');
    expect(() => planHandoffContext({ ...input(), throughDate: '2026-10-16' })).toThrow('scope');
    expect(() => planHandoffContext({ ...input(), throughDate: '2099-01-01' })).toThrow('scope');
    expect(planHandoffContext(input()).report).toMatchObject({
      dates: [date],
      throughDate: '2026-10-15',
      plannedFields: 0,
    });
    expect(() => planHandoffContext({ ...input(), dates: [date, date] })).toThrow('scope');
    expect(() => planHandoffContext({ ...input(), throughDate: '2026-07-13' })).toThrow('scope');
    expect(() => planHandoffContext({ ...input(), target: {} })).toThrow('day_missing');
    expect(() =>
      planHandoffContext({ ...input(), target: { [date]: { date: '2026-07-15' } } })
    ).toThrow('day_missing');
  });
  it('prints only a private-content-free proposal report, never the patches', () => {
    const result = execFileSync(process.execPath, ['scripts/migration/planHandoffContext.mjs'], {
      encoding: 'utf8',
      input: JSON.stringify(input({ handoffNovedadesDayShift: 'Texto confidencial' })),
    });
    expect(JSON.parse(result)).toMatchObject({ plannedFields: 1, cloudWrites: 0 });
    expect(result).not.toContain('Texto confidencial');
    expect(result).not.toContain('patches');
  });
});
