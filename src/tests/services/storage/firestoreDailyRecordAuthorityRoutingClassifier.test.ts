import { describe, expect, it } from 'vitest';
import {
  extractClinicalAuthorityPatch,
  shouldRouteClinicalAuthorityPatch,
} from '@/services/storage/firestore/firestoreDailyRecordAuthorityRouting';

describe('shouldRouteClinicalAuthorityPatch · acompañantes FHIR aplanados', () => {
  it('acepta un patch clínico con el acompañante fhir_resource aplanado en profundidad', () => {
    // Forma real que produce prepareFirestorePartialData para un cambio de
    // estado en una cama con paciente: el fhir_resource derivado llega
    // expandido en sub-paths de profundidad arbitraria.
    const patch = {
      'beds.R3.status': 'De cuidado',
      dateTimestamp: 1_772_150_400_000,
      'beds.R3.fhir_resource.resourceType': 'Patient',
      'beds.R3.fhir_resource.id': 'paciente-r3',
      'beds.R3.fhir_resource.meta.profile': ['http://hl7.org/fhir/StructureDefinition/Patient'],
      'beds.R3.fhir_resource.identifier': [{ value: '11.111.111-1' }],
      'beds.R3.fhir_resource.name': [{ text: 'Paciente Tres' }],
      'beds.R3.fhir_resource.extension': [],
    };

    expect(shouldRouteClinicalAuthorityPatch(patch)).toBe(true);
    // El callable recibe sólo el sobre clínico; los derivados no viajan.
    expect(Object.keys(extractClinicalAuthorityPatch(patch))).toEqual(['beds.R3.status']);
  });

  it('acepta el acompañante FHIR de una cuna clínica en profundidad', () => {
    const patch = {
      'beds.R3.pathology': 'RNT 38 semanas',
      'beds.R3.clinicalCrib.fhir_resource.meta.profile': ['perfil'],
    };

    expect(shouldRouteClinicalAuthorityPatch(patch)).toBe(true);
  });

  it('sigue rechazando un patch clínico mezclado con un campo estructural real', () => {
    const patch = {
      'beds.R3.status': 'Grave',
      'beds.R3.patientName': 'Otro Nombre',
    };

    expect(shouldRouteClinicalAuthorityPatch(patch)).toBe(false);
  });

  it('no clasifica sub-campos anidados de clinicalEpisodeId como derivados', () => {
    const patch = {
      'beds.R3.status': 'Grave',
      'beds.R3.clinicalEpisodeId.origin': 'manual',
    };

    expect(shouldRouteClinicalAuthorityPatch(patch)).toBe(false);
  });
});
