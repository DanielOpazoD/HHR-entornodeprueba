import { describe, expect, it } from 'vitest';

import '../../../extension/fichamedico-diagnosis-coding.js';

type Diagnosis = { code: string; classificationId: number | null; name: string };
type Encounter = { diagnosis?: string; diagnosisCode?: string; diagnosisDescription?: string };

const coding = (
  globalThis as typeof globalThis & {
    HhrFichaMedicoDiagnosisCoding: {
      createEnricher: (reader: () => Promise<Map<number, string>>) => {
        queue: (index: number, diagnosis: Diagnosis) => void;
        apply: (encounters: Encounter[]) => Promise<void>;
      };
    };
  }
).HhrFichaMedicoDiagnosisCoding;

describe('Ficha Médico diagnosis coding', () => {
  it('preserves a coded principal diagnosis when enriching uncoded admissions', async () => {
    let reads = 0;
    const enricher = coding.createEnricher(async () => {
      reads += 1;
      return new Map([
        [4405, 'J15'],
        [77, 'R50'],
      ]);
    });
    const encounters: Encounter[] = [
      { diagnosis: 'Neumonía bacteriana' },
      { diagnosis: 'Principal', diagnosisCode: 'F23' },
    ];
    enricher.queue(0, { name: 'Neumonía bacteriana', classificationId: 4405, code: '' });
    enricher.queue(1, { name: 'Principal', classificationId: 77, code: 'F23' });
    await enricher.apply(encounters);
    expect(encounters).toEqual([
      {
        diagnosis: 'Neumonía bacteriana',
        diagnosisCode: 'J15',
        diagnosisDescription: 'Neumonía bacteriana',
      },
      { diagnosis: 'Principal', diagnosisCode: 'F23' },
    ]);
    expect(reads).toBe(1);
  });

  it('continues an uncoded snapshot if the catalog fails and retries on the next capture', async () => {
    let reads = 0;
    const reader = async () => {
      reads += 1;
      if (reads === 1) throw new Error('Catálogo temporalmente indisponible');
      return new Map([[4405, 'J15']]);
    };
    const diagnosis = { name: 'Neumonía bacteriana', classificationId: 4405, code: '' };
    const first = coding.createEnricher(reader);
    const initial: Encounter[] = [{ diagnosis: diagnosis.name }];
    first.queue(0, diagnosis);
    await first.apply(initial);
    expect(initial[0].diagnosisCode).toBeUndefined();

    const next = coding.createEnricher(reader);
    const recovered: Encounter[] = [{ diagnosis: diagnosis.name }];
    next.queue(0, diagnosis);
    await next.apply(recovered);
    expect(recovered[0].diagnosisCode).toBe('J15');
    expect(reads).toBe(2);
  });
});
