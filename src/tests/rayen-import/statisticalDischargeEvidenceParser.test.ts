import { describe, expect, it } from 'vitest';
import {
  confirmsHospitalizationAt,
  hasUnitTransferAtOrBefore,
  parseStatisticalDischargeEvidence,
} from '@/features/rayen-import/mapping/parseStatisticalDischargeReport';

const report = `
Informe Estadístico de Egreso Hospitalario
1.RUN:
6 3 2 1 8 8 0 - 4
24 INGRESO 1 6 - 4 1 2 4 - 0 7 - 2 6 Área Médico Quirúrgico Cuidados Medios 4 0 4
25 1er TRASLADO - - -
26 2° TRASLADO - - -
27 3er TRASLADO - - -
28 4° TRASLADO * - - -
29 EGRESO 1 4 - 2 8 2 5 - 0 7 - 2 6 1. Domicilio. 4 0 4
`;

describe('statistical discharge evidence parser', () => {
  it('extracts identity and the admission-discharge interval from the official boxed layout', () => {
    const evidence = parseStatisticalDischargeEvidence(report);

    expect(evidence).toEqual({
      run: '63218804',
      admissionAt: '2026-07-24T16:41:00',
      admissionUnit: 'Área Médico Quirúrgico Cuidados Medios',
      dischargeAt: '2026-07-25T14:28:00',
      transfers: [],
    });
    expect(confirmsHospitalizationAt(evidence!, '2026-07-25T08:59:59')).toBe(true);
  });

  it('skips the printed RUN legend before the actual boxed identity', () => {
    const extractedLikePdf = report.replace(
      '1.RUN:',
      '1.RUN: 6. Número de identificador FONASA\nTexto del formulario\n1.RUN:'
    );
    expect(parseStatisticalDischargeEvidence(extractedLikePdf)?.run).toBe('63218804');
  });

  it('accepts a valid short Chilean RUN and still checks its verifier', () => {
    const shortRunReport = report.replace('6 3 2 1 8 8 0 - 4', '1 2 3 4 5 6 - 0');
    expect(parseStatisticalDischargeEvidence(shortRunReport)?.run).toBe('1234560');
    expect(
      parseStatisticalDischargeEvidence(
        shortRunReport.replace('1 2 3 4 5 6 - 0', '1 2 3 4 5 6 - 1')
      )
    ).toBeNull();
  });

  it('records functional-unit transfers and limits them by the requested cutoff', () => {
    const evidence = parseStatisticalDischargeEvidence(
      report.replace(
        '25 1er TRASLADO - - -',
        '25 1er TRASLADO 0 8 - 3 0 2 5 - 0 7 - 2 6 Unidad de Paciente Crítico 4 0 5'
      )
    );

    expect(evidence?.transfers).toEqual([
      { changedAt: '2026-07-25T08:30:00', unit: 'Unidad de Paciente Crítico' },
    ]);
    expect(hasUnitTransferAtOrBefore(evidence!, '2026-07-25T08:00:00')).toBe(false);
    expect(hasUnitTransferAtOrBefore(evidence!, '2026-07-25T08:59:59')).toBe(true);
  });

  it('fails closed when identity or interval fields are incomplete', () => {
    expect(parseStatisticalDischargeEvidence(report.replace('6 3 2 1 8 8 0 - 4', ''))).toBeNull();
    expect(parseStatisticalDischargeEvidence(report.replace('29 EGRESO', 'EGRESO'))).toBeNull();
  });
});
