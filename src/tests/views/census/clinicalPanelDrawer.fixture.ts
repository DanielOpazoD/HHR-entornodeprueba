// Synthetic clinical panel response shared by the drawer behavior cases.
export const panelResult = {
  documents: [
    {
      id: 'id:doc-1',
      classification: 'Clínico',
      fileName: 'informe-prueba.pdf',
      name: 'Evaluación de prueba',
      attachedBy: 'Profesional de prueba',
      facility: 'Hospital de prueba',
      createdAt: '2026-07-16T10:00:00',
    },
    {
      id: 'id:doc-2',
      classification: 'Clínico',
      fileName: 'resultado-prueba.pdf',
      name: 'Resultado de prueba',
      attachedBy: 'Profesional de prueba',
      facility: 'Hospital de prueba',
      createdAt: '2026-07-17T10:00:00',
    },
    {
      id: 'id:doc-3',
      classification: 'Administrativo',
      fileName: 'formulario-prueba.pdf',
      name: 'Formulario de prueba',
      attachedBy: 'Profesional de prueba',
      facility: 'Hospital de prueba',
      createdAt: '2026-07-18T10:00:00',
    },
  ],
  events: [
    {
      publishDatetime: '2026-07-13T10:00:00',
      evolutionResume: [
        {
          id: 1,
          OBE_NOTES: 'Evolución médica estable.',
          HCPR_NAME: 'Médico',
          OBE_PUBLISH_DATETIME: '2026-07-13T09:00:00',
        },
      ],
      shiftChangeResume: [
        {
          ID: 2,
          OBSERVATION: 'Entrega médica: controlar laboratorio.',
          HCPR_NAME: 'Médico',
          PUBLISH_DATETIME: '2026-07-13T10:00:00',
        },
        {
          ID: 3,
          OBSERVATION: 'Entrega enfermería: sin novedades.',
          HCPR_NAME: 'Enfermera(o)',
          PUBLISH_DATETIME: '2026-07-13T11:00:00',
        },
      ],
      patientPharmaIndicationResume: [
        {
          MRE_ID: 7,
          DESCRIPTOR: 'CEFTRIAXONA 2 g',
          POSOLOGY: '2 g cada 24 h',
          PUBLISH_DATETIME: '2026-07-13T08:00:00',
          IS_NEW: true,
          SUSPENDED: true,
        },
        {
          MRE_ID: 8,
          DESCRIPTOR: 'AMOXICILINA 500 mg',
          PUBLISH_DATETIME: '2026-07-13T08:30:00',
          SUSPENDED: false,
          FINALIZED: true,
        },
      ],
      patientFreeIndicationResume: [],
      nutritionOrderResume: [],
      restResume: [],
    },
  ],
  carePlan: {
    medicationStates: [
      { id: 7, suspended: true, archived: false },
      { id: 8, suspended: false, archived: false, finalized: true },
    ],
    carePlanHeaders: [
      {
        scheduledDate: '2026-07-13T00:00:00',
        carePlanBody: [
          {
            entryGuid: 'care-1',
            title: 'Cambio de posición',
            isPerformed: true,
            administrationDate: '2026-07-13T12:00:00',
            user: 'ANA PÉREZ',
          },
        ],
      },
    ],
  },
};
