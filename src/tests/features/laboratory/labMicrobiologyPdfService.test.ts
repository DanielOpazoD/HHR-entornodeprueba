// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { parseMicrobiologyFindingsFromPdfText } from '@/features/laboratory/services/labMicrobiologyPdfService';

describe('labMicrobiologyPdfService', () => {
  it('parses culture, ATB, antibiogram, and PCR sections from the combined microbiology PDF text', () => {
    const text = `
      CULTIVO CORRIENTE 1
      Tipo de muestra: Expectoración
      Cultivo: Bacilos Gram (-) No Fermentador

      ATB BACILOS GRAM (-) 1
      Ceftazidima: Susceptible
      Amikacina: Susceptible

      ANTIBIOGRAMA EXTENDIDO 1
      Imipenem: Susceptible
      Ertapenem: Resistente
      Piperacilina/Tazobactam: Susceptible
      Cefepime: Susceptible

      PCR PANEL RESPIRATORIO #2
      Influenza A: NEGATIVO
      Influenza B: NEGATIVO
      Parainfluenza: NEGATIVO
      Metapneumovirus: NEGATIVO
      Rhinovirus: NEGATIVO
      Virus Sincicial: NEGATIVO
      Adenovirus: NEGATIVO
      SARS COV-2: NEGATIVO
    `;

    expect(parseMicrobiologyFindingsFromPdfText(text)).toEqual([
      {
        section: 'MICROBIOLOGIA',
        analysis: 'Cultivo',
        result: 'Bacilos Gram (-) No Fermentador',
        unit: '',
        refValue: '',
        qualitative: true,
      },
      {
        section: 'MICROBIOLOGIA',
        analysis: 'Ceftazidima',
        result: 'Susceptible',
        unit: '',
        refValue: '',
        qualitative: true,
      },
      {
        section: 'MICROBIOLOGIA',
        analysis: 'Amikacina',
        result: 'Susceptible',
        unit: '',
        refValue: '',
        qualitative: true,
      },
      {
        section: 'MICROBIOLOGIA',
        analysis: 'Imipenem',
        result: 'Susceptible',
        unit: '',
        refValue: '',
        qualitative: true,
      },
      {
        section: 'MICROBIOLOGIA',
        analysis: 'Ertapenem',
        result: 'Resistente',
        unit: '',
        refValue: '',
        qualitative: true,
      },
      {
        section: 'MICROBIOLOGIA',
        analysis: 'Piperacilina/Tazobactam',
        result: 'Susceptible',
        unit: '',
        refValue: '',
        qualitative: true,
      },
      {
        section: 'MICROBIOLOGIA',
        analysis: 'Cefepime',
        result: 'Susceptible',
        unit: '',
        refValue: '',
        qualitative: true,
      },
      {
        section: 'MICROBIOLOGIA',
        analysis: 'Influenza A',
        result: 'NEGATIVO',
        unit: '',
        refValue: '',
        qualitative: true,
      },
      {
        section: 'MICROBIOLOGIA',
        analysis: 'Influenza B',
        result: 'NEGATIVO',
        unit: '',
        refValue: '',
        qualitative: true,
      },
      {
        section: 'MICROBIOLOGIA',
        analysis: 'Parainfluenza',
        result: 'NEGATIVO',
        unit: '',
        refValue: '',
        qualitative: true,
      },
      {
        section: 'MICROBIOLOGIA',
        analysis: 'Metapneumovirus',
        result: 'NEGATIVO',
        unit: '',
        refValue: '',
        qualitative: true,
      },
      {
        section: 'MICROBIOLOGIA',
        analysis: 'Rhinovirus',
        result: 'NEGATIVO',
        unit: '',
        refValue: '',
        qualitative: true,
      },
      {
        section: 'MICROBIOLOGIA',
        analysis: 'Virus Sincicial',
        result: 'NEGATIVO',
        unit: '',
        refValue: '',
        qualitative: true,
      },
      {
        section: 'MICROBIOLOGIA',
        analysis: 'Adenovirus',
        result: 'NEGATIVO',
        unit: '',
        refValue: '',
        qualitative: true,
      },
      {
        section: 'MICROBIOLOGIA',
        analysis: 'SARS COV-2',
        result: 'NEGATIVO',
        unit: '',
        refValue: '',
        qualitative: true,
      },
    ]);
  });

  it('parses arbovirus PCR sections without leaking MIDAS metadata', () => {
    const text = `
      PCR ARBOVIROSIS
      N° de ingreso MIDAS: 26052943.
      PCR virus Zika: Negativo
      PCR CHIKUNGUNYA: Negativo
      PCR DENGUE: Negativo
    `;

    expect(parseMicrobiologyFindingsFromPdfText(text)).toEqual([
      {
        section: 'MICROBIOLOGIA',
        analysis: 'PCR virus Zika',
        result: 'Negativo',
        unit: '',
        refValue: '',
        qualitative: true,
      },
      {
        section: 'MICROBIOLOGIA',
        analysis: 'PCR CHIKUNGUNYA',
        result: 'Negativo',
        unit: '',
        refValue: '',
        qualitative: true,
      },
      {
        section: 'MICROBIOLOGIA',
        analysis: 'PCR DENGUE',
        result: 'Negativo',
        unit: '',
        refValue: '',
        qualitative: true,
      },
    ]);
  });
});
