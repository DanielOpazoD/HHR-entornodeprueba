// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { formatClinicalAntecedentDate } from '@/features/census/components/patient-row/clinicalAntecedentDate';
import { uniqueClinicalAntecedentEntries } from '@/features/census/components/patient-row/ClinicalPanelAntecedents';
import { decodeClinicalAntecedentDetail } from '@/features/rayen-import/bridge/clinicalAntecedentDetail';
import type { ClinicalAntecedentEntry } from '@/features/rayen-import';
import '../../../extension/clinical-antecedents-fields.js';

const { project } = (
  globalThis as unknown as {
    HhrClinicalAntecedentsFields: { project: (value: unknown) => Record<string, unknown> };
  }
).HhrClinicalAntecedentsFields;

describe('formatClinicalAntecedentDate', () => {
  it.each([
    ['20260926 15:53', '26-09-2026 15:53'],
    ['2026-09-26T15:53:20', '26-09-2026 15:53'],
    ['20260926', '26-09-2026'],
    ['2024-02-29', '29-02-2024'],
  ])('muestra %s como %s sin cambiar la hora local de origen', (raw, expected) => {
    expect(formatClinicalAntecedentDate(raw)).toBe(expected);
  });

  it.each(['20260230 15:53', '20260926 25:53', 'sin fecha', ''])(
    'conserva valores no interpretables: %s',
    raw => {
      expect(formatClinicalAntecedentDate(raw)).toBe(raw);
    }
  );
});

describe('antecedent detail bridge validation', () => {
  const detail = {
    reason: 'Motivo',
    history: 'Evolución',
    professional: 'Profesional',
    attachments: [],
    careType: 'outpatient',
    patientName: 'Paciente sintético',
    diagnoses: [],
    indications: [],
    physicalExams: [],
    prescriptions: [],
  };

  it('excluye campos desconocidos y URLs firmadas del contrato vigente', () => {
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
    { summary: {} },
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

  it('acepta el resumen secundario como texto y conserva hospitalización', () => {
    expect(
      decodeClinicalAntecedentDetail({
        ...detail,
        careType: 'hospitalization',
        summary: '<texto de la fuente>',
      })
    ).toMatchObject({ careType: 'hospitalization', summary: '<texto de la fuente>' });
  });
});

describe('clinical antecedent identity and precedence', () => {
  const entry = (
    source: string,
    id: string,
    diagnosis = 'Synthetic diagnosis'
  ): ClinicalAntecedentEntry => ({
    source,
    id,
    diagnosis,
    date: '20260930 10:00',
    facility: 'Synthetic facility',
    type: 'Consulta',
    windowEnd: '20260930',
  });

  it('keeps the current occurrence and encounter order without changing input objects', () => {
    const current = Object.freeze(entry('Primaria', '8', 'Current diagnosis'));
    const secondary = Object.freeze(entry('Secundaria', '8'));
    const older = Object.freeze(entry('Primaria', '99'));
    const input = Object.freeze([
      current,
      secondary,
      entry('Primaria', '8', 'Older overlap'),
      older,
      entry('Primaria', '99'),
    ]);
    const before = JSON.stringify(input);
    const result = uniqueClinicalAntecedentEntries(input);
    expect(result).toEqual([current, secondary, older]);
    expect(result[0]).toBe(current);
    expect(result[1]).toBe(secondary);
    expect(result[2]).toBe(older);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('does not conflate distinct source/id pairs containing delimiters', () => {
    const first = entry('Primaria:8', '99');
    const second = entry('Primaria', '8:99');
    expect(uniqueClinicalAntecedentEntries([first, second, { ...first }])).toEqual([first, second]);
  });

  it('accepts an empty history', () => {
    expect(uniqueClinicalAntecedentEntries([])).toEqual([]);
  });
});

describe('selected HCC antecedent fields', () => {
  const recipe = {
    IdReceta: 123,
    FechaGeneracion: '20260929 10:30',
    Estado: 'Registrada',
    TipoReceta: 'General',
    Prescripcion: {
      DetalleHistorialAtencionesRecetaPrescripcion: {
        DescripcionPrescripcion: 'Fármaco de prueba: 1 comprimido cada 24 horas por 30 días.',
      },
    },
  };
  const form = (name = 'Examen Fisico Urgencia', value: string | number = '120/80') => ({
    Nombre: name,
    Categoria: {
      TypeCategoria: {
        Campo: {
          TypeCampo: [
            { Etiqueta: 'Presión arterial', Valor: value },
            { Etiqueta: 'Vacío', Valor: '' },
          ],
        },
        SubCategoria: {
          TypeCategoria: {
            Campo: { TypeCampo: { Etiqueta: 'Observación', Valor: 'Hallazgo sintético' } },
          },
        },
      },
    },
  });

  it('normaliza diagnósticos, indicaciones y recetas singleton sin descartar texto', () => {
    expect(
      project({
        Paciente: { NombreCompleto: 'Paciente de prueba' },
        DiagnosticosAtencion: {
          DetalleHistorialAtencionesDiagnosticoAtencion: {
            DescripcionDiagnostico: 'Diagnóstico (Confirmado)',
          },
        },
        Indicaciones: { string: 'Control sintético' },
        Recetas: { DetalleHistorialAtencionesReceta: recipe },
        Actividades: { string: 'No solicitado' },
        Documentos: { Sas: 'no-exportar' },
      })
    ).toEqual({
      careType: 'outpatient',
      patientName: 'Paciente de prueba',
      diagnoses: ['Diagnóstico (Confirmado)'],
      indications: ['Control sintético'],
      physicalExams: [],
      prescriptions: [
        {
          id: '123',
          date: '20260929 10:30',
          status: 'Registrada',
          type: 'General',
          items: ['Fármaco de prueba: 1 comprimido cada 24 horas por 30 días.'],
        },
      ],
    });
  });

  it('reconoce urgencia por el formulario con acentos y conserva exámenes distintos de igual nombre', () => {
    const result = project({
      Formularios: {
        TypeFormulario: [
          form(' EXAMEN FÍSICO  URGENCIA: '),
          form(undefined, '110/70'),
          form('Examen Físico Segmentario Urgencia'),
          form('Otro formulario'),
        ],
      },
      Recetas: { DetalleHistorialAtencionesReceta: recipe },
    });
    expect(result.careType).toBe('emergency');
    expect(result.prescriptions).toEqual([]);
    expect(result.physicalExams).toHaveLength(3);
    expect(result.physicalExams).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fields: [
            { label: 'Presión arterial', value: '110/70' },
            { label: 'Observación', value: 'Hallazgo sintético' },
          ],
        }),
      ])
    );
  });

  it('no infiere urgencia desde texto libre y conserva todas las prescripciones por receta', () => {
    const result = project({
      Anamnesis: { HistoriaEnfermedadAnamnesis: 'Examen Fisico Urgencia' },
      DiagnosticosAtencion: {
        DetalleHistorialAtencionesDiagnosticoAtencion: [
          { DescripcionDiagnostico: 'Uno' },
          { DescripcionDiagnostico: 'Dos' },
        ],
      },
      Indicaciones: { string: ['Uno', 'Dos'] },
      Recetas: {
        DetalleHistorialAtencionesReceta: [
          recipe,
          {
            ...recipe,
            IdReceta: 456,
            Prescripcion: {
              DetalleHistorialAtencionesRecetaPrescripcion: [
                { DescripcionPrescripcion: 'Uno' },
                { DescripcionPrescripcion: 'Dos' },
              ],
            },
          },
        ],
      },
    });
    expect(result.careType).toBe('outpatient');
    expect(result.diagnoses).toEqual(['Uno', 'Dos']);
    expect(result.indications).toEqual(['Uno', 'Dos']);
    expect(result.prescriptions).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: '456', items: ['Uno', 'Dos'] })])
    );
  });

  it('quita sólo formularios idénticos, incluso con campos reordenados y nombres acentuados', () => {
    const first = form();
    const same = form('Examen Físico Urgencia:');
    same.Categoria.TypeCategoria.Campo.TypeCampo.reverse();
    const result = project({
      Formularios: { TypeFormulario: [first, same, form(undefined, '110/70')] },
    });
    expect(result.physicalExams).toHaveLength(2);
    expect(result.physicalExams).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fields: expect.arrayContaining([{ label: 'Presión arterial', value: '120/80' }]),
        }),
        expect.objectContaining({
          fields: expect.arrayContaining([{ label: 'Presión arterial', value: '110/70' }]),
        }),
      ])
    );
  });

  it('tolera placeholders 0 y detecta urgencia aunque el formulario esté vacío', () => {
    expect(project({ Formularios: 0, Recetas: 0, Indicaciones: 0 }).prescriptions).toEqual([]);
    expect(
      project({
        Formularios: { TypeFormulario: { Nombre: 'Examen Fisico Urgencia', Categoria: 0 } },
      }).careType
    ).toBe('emergency');
    expect(project({ Formularios: { TypeFormulario: form(undefined, 0) } }).physicalExams).toEqual([
      expect.objectContaining({
        fields: expect.arrayContaining([{ label: 'Presión arterial', value: '0' }]),
      }),
    ]);
  });
});
