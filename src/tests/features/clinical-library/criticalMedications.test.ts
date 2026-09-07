import { describe, expect, it } from 'vitest';

import {
  CRITICAL_MEDICATIONS,
  CRITICAL_MEDICATIONS_SHEET,
  presentationFor,
} from '@/features/clinical-library/domain/criticalMedications';
import { buildCriticalMedicationsDocument } from '@/features/clinical-library/controllers/criticalMedicationsPrint';

const byId = (id: string) => {
  const medication = CRITICAL_MEDICATIONS.find(item => item.id === id);
  if (!medication) throw new Error(`missing ${id}`);
  return medication;
};

describe('critical medications sheet', () => {
  it('transcribes the 21 medications of the institutional sheet with unique ids', () => {
    const ids = CRITICAL_MEDICATIONS.map(item => item.id);
    expect(ids).toHaveLength(21);
    expect(new Set(ids).size).toBe(21);
    for (const medication of CRITICAL_MEDICATIONS) {
      expect(medication.presentations.length, medication.id).toBeGreaterThan(0);
      expect(medication.dose.trim(), medication.id).not.toBe('');
      for (const presentation of medication.presentations) {
        expect(presentation.preparations.length, medication.id).toBeGreaterThan(0);
      }
    }
    expect(CRITICAL_MEDICATIONS_SHEET.alerts[0]).toBe('KCl nunca IV directo.');
  });

  it('keeps the hand-checked concentrations of the sheet', () => {
    const concentrations = (id: string, variant: 'amp5' | 'amp10' = 'amp5') =>
      presentationFor(byId(id), variant).preparations.map(item => item.concentration);
    expect(concentrations('noradrenalina')).toEqual(['32 mcg/mL', '160 mcg/mL']);
    expect(concentrations('adrenalina')).toEqual(['16 mcg/mL', '100 mcg/mL']);
    expect(concentrations('nitroglicerina')).toEqual(['200 mcg/mL', '600 mcg/mL']);
    expect(concentrations('dopamina')).toEqual(['1.000 mcg/mL', '5.000 mcg/mL']);
    expect(concentrations('dobutamina')).toEqual(['800 mcg/mL', '4.000 mcg/mL']);
    expect(concentrations('kcl')).toEqual(['40,2 mEq/100 mL']);
    expect(concentrations('heparina')).toEqual(['100 UI/mL']);
    expect(concentrations('insulina')).toEqual(['1 UI/mL']);
    expect(concentrations('amiodarona')).toEqual([undefined, '2,4 mg/mL']);
  });

  it('switches only dopamine and dobutamine between the 5 mL and 10 mL ampoules', () => {
    expect(presentationFor(byId('dopamina'), 'amp5').text).toBe('250 mg/5 mL');
    expect(presentationFor(byId('dopamina'), 'amp10').text).toBe('250 mg/10 mL');
    expect(presentationFor(byId('dobutamina'), 'amp5').text).toBe('200 mg/5 mL');
    expect(presentationFor(byId('dobutamina'), 'amp10').text).toBe('200 mg/10 mL');
    expect(presentationFor(byId('noradrenalina'), 'amp5')).toBe(
      presentationFor(byId('noradrenalina'), 'amp10')
    );
    for (const medication of CRITICAL_MEDICATIONS) {
      if (medication.presentations.length > 1) {
        expect(['dopamina', 'dobutamina']).toContain(medication.id);
      }
    }
  });

  it('prints a landscape A4 sheet with every medication and the variant in the subtitle', () => {
    const document = buildCriticalMedicationsDocument('amp5');
    expect(document.styles).toContain('size: A4 landscape');
    expect(document.body).toContain('ampolla de 5 mL');
    expect(document.body.match(/<tr>/g)).toHaveLength(1 + CRITICAL_MEDICATIONS.length);
    expect(document.body).toContain('250 mg/5 mL');
    expect(document.body).toContain('mL/h = dosis × peso × 60 / concentración (mcg/mL)');
    expect(buildCriticalMedicationsDocument('amp10').body).toContain('250 mg/10 mL');
  });
});
