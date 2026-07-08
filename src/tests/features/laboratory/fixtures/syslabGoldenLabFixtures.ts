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
