import { describe, expect, it } from 'vitest';
import { decodeClinicalAntecedentDetail } from '@/features/rayen-import/bridge/clinicalAntecedentDetail';

const detail = { reason: 'Motivo', history: 'Evolución', professional: 'Profesional' };
describe('antecedent detail bridge validation', () => {
  it('acepta la extensión antigua y excluye campos desconocidos y URLs firmadas', () => {
    expect(
      decodeClinicalAntecedentDetail({ ...detail, signedUrl: 'https://example.test?sig=secret' })
    ).toMatchObject({ ...detail, attachments: [] });
    expect(decodeClinicalAntecedentDetail({ ...detail, secret: 'oculto' })).not.toHaveProperty(
      'secret'
    );
  });
  it.each([
    { diagnoses: [null] },
    { indications: {} },
    { careType: 'unknown' },
    { patientName: 7 },
    { physicalExams: [{ name: 'Examen', fields: [{ label: 'PA', value: {} }] }] },
    { prescriptions: [{ id: '123', date: '', status: '', type: '', items: [{}] }] },
    { attachments: [{ id: '123', label: null }] },
  ])('rechaza estructura inválida %j sin renderizar objetos', field => {
    expect(decodeClinicalAntecedentDetail({ ...detail, ...field })).toBeUndefined();
  });
  it('preserva campos nuevos completos con listas vacías válidas', () => {
    expect(
      decodeClinicalAntecedentDetail({
        ...detail,
        careType: 'emergency',
        diagnoses: ['Uno', 'Dos'],
        indications: [],
        physicalExams: [
          { name: 'Examen', fields: [{ label: 'PA', value: '120/80', secret: 'no' }] },
        ],
        prescriptions: [],
      })
    ).toMatchObject({
      careType: 'emergency',
      diagnoses: ['Uno', 'Dos'],
      physicalExams: [{ name: 'Examen', fields: [{ label: 'PA', value: '120/80' }] }],
    });
  });
});
