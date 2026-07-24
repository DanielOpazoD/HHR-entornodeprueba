import type { SyslabExamDetail, SyslabExamItem } from '@/types/domain/labExamTypes';

const exams: SyslabExamItem[] = [
  {
    id: 'golden-metabolic',
    link: 'http://example.com/golden-metabolic',
    date: '08/03/2025',
    time: '07:45:00',
    patientName: 'PACIENTE TEST',
    origin: 'HOSP',
    exams: ['HEMOGLOBINA GLICOSILADA #2', 'PERFIL LIPIDICO'],
  },
  {
    id: 'golden-sars',
    link: 'http://example.com/golden-sars',
    date: '08/03/2025',
    time: '08:10:00',
    patientName: 'PACIENTE TEST',
    origin: 'HOSP',
    exams: ['SARS COV-2'],
  },
  {
    id: 'golden-uroculture',
    link: 'http://example.com/golden-uroculture',
    date: '08/03/2025',
    time: '08:30:00',
    patientName: 'PACIENTE TEST',
    origin: 'HOSP',
    exams: ['UROCULTIVO 1', 'ATB BACILOS GRAM (-) 1'],
  },
];

const details: SyslabExamDetail[] = [
  {
    url: 'http://example.com/golden-metabolic',
    findings: [
      {
        section: 'HEMOGLOBINA GLICOSILADA #2',
        analysis: 'Hemoglobina Glicosilada',
        result: '6,6',
        unit: 'o/o',
        refValue: '4,0 - 6,5',
      },
      {
        section: 'PERFIL LIPIDICO',
        analysis: 'Triglic#ridos',
        result: '185',
        unit: 'mg/dL',
        refValue: '< 150',
      },
    ],
  },
  {
    url: 'http://example.com/golden-sars',
    findings: [
      {
        section: 'SARS COV-2',
        analysis: 'PCR SARS-CoV-19',
        result: 'NEGATIVO',
        unit: '',
        refValue: '',
        qualitative: true,
      },
    ],
  },
  {
    url: 'http://example.com/golden-uroculture',
    findings: [
      {
        section: 'UROCULTIVO 1',
        analysis: 'Recuento de Colonias',
        result: '> 100.000',
        unit: 'UFC/mL',
        refValue: '',
      },
      {
        section: 'ANTIBIOGRAMA',
        analysis: 'Gentamicina',
        result: 'Intermedio',
        unit: '',
        refValue: '',
        qualitative: true,
      },
    ],
  },
];

export const syslabGoldenMixedMicrobiologyScenario = {
  exams,
  details,
} as const;

/**
 * De-identified regression case based on a real Syslab collision:
 * cholestatic values use dots as thousands separators and a later urine report
 * repeats systemic analyte names. No patient identifiers are stored in source control.
 */
export const syslabGoldenSpecimenCollisionScenario = {
  exams: [
    {
      id: 'hepatic-1',
      link: 'http://example.com/hepatic-1',
      date: '11/07/2026',
      time: '00:09:00',
      patientName: 'PACIENTE TEST',
      origin: 'HOSP',
      exams: ['PERFIL HEPATICO', 'HEMOGRAMA'],
    },
    {
      id: 'hepatic-2',
      link: 'http://example.com/hepatic-2',
      date: '16/07/2026',
      time: '07:42:00',
      patientName: 'PACIENTE TEST',
      origin: 'HOSP',
      exams: ['PERFIL HEPATICO', 'HEMOGRAMA'],
    },
    {
      id: 'urine-1',
      link: 'http://example.com/urine-1',
      date: '20/07/2026',
      time: '15:29:00',
      patientName: 'PACIENTE TEST',
      origin: 'HOSP',
      exams: ['ALBUMINURIA / CREATININURIA', 'SEDIMENTO URINARIO'],
    },
  ] satisfies SyslabExamItem[],
  details: [
    {
      url: 'http://example.com/hepatic-1',
      findings: [
        {
          section: 'PERFIL HEPATICO',
          analysis: 'GGT',
          result: '1.720',
          unit: 'U/L',
          refValue: '10 - 71',
        },
        {
          section: 'PERFIL HEPATICO',
          analysis: 'Fosfatasa Alcalina',
          result: '1.071',
          unit: 'U/L',
          refValue: '40 - 129',
        },
        {
          section: 'PERFIL HEPATICO',
          analysis: 'Albumina',
          result: '2,0',
          unit: 'g/dL',
          refValue: '3,5 - 5,2',
        },
        {
          section: 'HEMOGRAMA',
          analysis: 'Leucocitos',
          result: '3,1',
          unit: 'x10^3/uL',
          refValue: '4,0 - 11,0',
        },
        {
          section: 'FORMULA LEUCOCITARIA',
          analysis: 'Neutrofilos segmentados',
          result: '72',
          unit: 'o/o',
          refValue: '50 - 70',
        },
      ],
    },
    {
      url: 'http://example.com/hepatic-2',
      findings: [
        {
          section: 'PERFIL HEPATICO',
          analysis: 'GGT',
          result: '946',
          unit: 'U/L',
          refValue: '10 - 71',
        },
        {
          section: 'PERFIL HEPATICO',
          analysis: 'Fosfatasa Alcalina',
          result: '682',
          unit: 'U/L',
          refValue: '40 - 129',
        },
        {
          section: 'PERFIL HEPATICO',
          analysis: 'Albumina',
          result: '1,9',
          unit: 'g/dL',
          refValue: '3,5 - 5,2',
        },
        {
          section: 'HEMOGRAMA',
          analysis: 'Leucocitos',
          result: '3,2',
          unit: 'x10^3/uL',
          refValue: '4,0 - 11,0',
        },
        {
          section: 'FORMULA LEUCOCITARIA',
          analysis: 'Neutrofilos segmentados',
          result: '42,4',
          unit: 'o/o',
          refValue: '50 - 70',
        },
      ],
    },
    {
      url: 'http://example.com/urine-1',
      findings: [
        {
          section: 'ALBUMINURIA / CREATININURIA',
          analysis: 'Albumina',
          result: '44,73',
          unit: 'mg/L',
          refValue: '< 30',
        },
        {
          section: 'SEDIMENTO URINARIO',
          analysis: 'Leucocitos',
          result: '0',
          unit: 'x campo',
          refValue: '0 - 5',
        },
        {
          section: 'SEDIMENTO URINARIO',
          analysis: 'Neutrofilos segmentados',
          result: '7,9',
          unit: 'o/o',
          refValue: '',
        },
      ],
    },
  ] satisfies SyslabExamDetail[],
};
