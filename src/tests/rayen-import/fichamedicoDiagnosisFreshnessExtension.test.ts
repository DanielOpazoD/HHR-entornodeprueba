// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  createFichamedicoReadHarness as createHarness,
  LIST_PATH,
} from './fichamedicoReadRuntimeTestHarness';

describe('Ficha Médico · actualización del diagnóstico clínico', () => {
  it.each(['entry', 'header'])(
    'relee el diagnóstico principal de %s cuando cambia entre capturas inmediatas',
    async source => {
      let headerCalls = 0;
      let diagnosisCalls = 0;
      let currentDiagnosis = { name: 'Fiebre', code: 'R50.9', id: 101 };
      const harness = await createHarness((rawUrl: string) => {
        const url = new URL(rawUrl);
        if (url.pathname === LIST_PATH) {
          return url.searchParams.get('filterType') === '3'
            ? [{ id: 142070, patientName: 'Paciente Prueba', diagnosisName: 'Fiebre' }]
            : [];
        }
        if (url.pathname.includes('/patientHeaderData/')) {
          headerCalls += 1;
          return {
            haoDiagName: 'Fiebre',
            principalDiagName: currentDiagnosis.name,
            principalDiagId: currentDiagnosis.id,
          };
        }
        if (url.pathname.includes('/diagnosisEntry/')) {
          diagnosisCalls += 1;
          return source === 'entry'
            ? [
                {
                  isPrincipal: true,
                  diagnosisName: currentDiagnosis.name,
                  internalCode: currentDiagnosis.code,
                },
              ]
            : [];
        }
        if (url.pathname === '/api/core/diagnosisClassify') {
          return [
            { id: 101, name: 'Fiebre', internalCode: 'R50.9' },
            { id: 102, name: 'Neumonía', internalCode: 'J18.9' },
          ];
        }
        return [];
      });

      const first = await harness.send({ type: 'RAYEN_EXT_READ_REQUEST', reqId: 'diagnosis-1' });
      currentDiagnosis = { name: 'Neumonía', code: 'J18.9', id: 102 };
      const second = await harness.send({ type: 'RAYEN_EXT_READ_REQUEST', reqId: 'diagnosis-2' });

      expect(first?.snapshot?.isComplete).toBe(true);
      expect(second?.snapshot?.isComplete).toBe(true);
      expect(first?.snapshot?.encounters?.[0]).toMatchObject({
        diagnosis: 'Fiebre',
        diagnosisCode: 'R50.9',
      });
      expect(second?.snapshot?.encounters?.[0]).toMatchObject({
        diagnosis: 'Neumonía',
        diagnosisCode: 'J18.9',
      });
      expect({ headerCalls, diagnosisCalls }).toEqual({ headerCalls: 2, diagnosisCalls: 2 });
    }
  );

  it('recupera CIE-10 del diagnóstico de ingreso por ID oficial y consulta el catálogo una sola vez', async () => {
    let catalogCalls = 0;
    const harness = await createHarness((rawUrl: string) => {
      const url = new URL(rawUrl);
      if (url.pathname === LIST_PATH) {
        return url.searchParams.get('filterType') === '3'
          ? [
              { id: 101, diagnosisId: 4405, diagnosisName: 'Neumonía bacteriana' },
              { id: 102, diagnosisId: 6535, diagnosisName: 'Balanitis' },
              { id: 103, diagnosisId: 999, diagnosisName: 'Diagnóstico sin código' },
            ]
          : [];
      }
      if (url.pathname.includes('/patientHeaderData/101/')) {
        return { haoDiagId: 4405, haoDiagName: 'Neumonía bacteriana' };
      }
      if (url.pathname.includes('/patientHeaderData/102/')) {
        return { haoDiagId: 6535, haoDiagName: 'Balanitis' };
      }
      if (url.pathname.includes('/patientHeaderData/103/')) {
        return { haoDiagId: 999, haoDiagName: 'Diagnóstico sin código' };
      }
      if (url.pathname.includes('/diagnosisEntry/')) return [];
      if (url.pathname === '/api/core/diagnosisClassify') {
        catalogCalls += 1;
        return [
          { id: 4405, name: 'Neumonía bacteriana', internalCode: 'J15' },
          { id: 6535, name: 'Balanitis', internalCode: 'N51.2' },
          { id: 999, name: 'Diagnóstico sin código', internalCode: '' },
        ];
      }
      return [];
    });

    const first = await harness.send({ type: 'RAYEN_EXT_READ_REQUEST', reqId: 'coding-1' });
    const second = await harness.send({ type: 'RAYEN_EXT_READ_REQUEST', reqId: 'coding-2' });

    expect(first?.snapshot?.isComplete).toBe(true);
    expect(first?.snapshot?.encounters).toMatchObject([
      { diagnosis: 'Neumonía bacteriana', diagnosisCode: 'J15' },
      { diagnosis: 'Balanitis', diagnosisCode: 'N51.2' },
      { diagnosis: 'Diagnóstico sin código', diagnosisCode: undefined },
    ]);
    expect(second?.snapshot?.encounters?.[0]).toMatchObject({ diagnosisCode: 'J15' });
    expect(catalogCalls).toBe(1);
  });
});
