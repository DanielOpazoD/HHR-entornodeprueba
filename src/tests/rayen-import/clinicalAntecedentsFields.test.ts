// @vitest-environment node
import { describe, expect, it } from 'vitest';
import '../../../extension/clinical-antecedents-fields.js';

const { project } = (
  globalThis as unknown as {
    HhrClinicalAntecedentsFields: { project: (value: unknown) => Record<string, unknown> };
  }
).HhrClinicalAntecedentsFields;
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

describe('selected HCC antecedent fields', () => {
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
