// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { isDomainTypeFacade } from '../../../scripts/lib/domainTypeHome.mjs';

const FILE = 'src/shared/contracts/example.ts';
const facade = (source: string, file = FILE) => isDomainTypeFacade(file, source);

describe('a domain type has one home', () => {
  it.each([
    "import type { Other } from './other';\nexport type PatientData = Other;",
    'export interface PatientData { name: string }',
    "import type { PatientData } from '@/types/domain/patient';\nexport type RowPatient = PatientData;",
    "import type { PatientData as P } from '@/types/domain/patient';\nexport type Q = P;",
    "import type { PatientData as P } from '../../types/domain/patient';\nexport type Q = P;",
    "import type * as Patient from '@/types/domain/patient';\nexport type Q = Patient.PatientData;",
    "export type { PatientData } from '@/types/domain/patient';",
    "export { type CesareanLabor } from '@/types/domain/patient';",
    "export * from '@/types/domain/patient';",
    "export * from '../../types/domain/patient';",
    "import type { DeliveryRoute } from '@/types/domain/patient';\nexport type { DeliveryRoute };",
    "import type { Narrow } from './narrow';\nexport type { Narrow as PatientData };",
  ])('rejects a facade: %s', source => {
    expect(facade(source)).toBe(true);
  });

  it.each([
    "import type { PatientData } from '@/types/domain/patient';\nexport type Patch = Partial<PatientData>;",
    "import type { PatientData } from '@/types/domain/patient';\nexport type State = Pick<PatientData, 'bedMode'>;",
    "import type { PatientData } from '@/types/domain/patient';\nexport type Mode = PatientData['bedMode'];",
    "import type { PatientData } from '@/types/domain/patient';\nexport interface RowProps { patient: PatientData }",
    "import type { Local } from './patient';\nexport type Alias = Local;",
  ])('accepts a derived or unrelated shape: %s', source => {
    expect(facade(source)).toBe(false);
  });

  it('leaves the home and the rest of src/types alone', () => {
    expect(
      facade('export interface PatientData { name: string }', 'src/types/domain/patient.ts')
    ).toBe(false);
    expect(facade("export * from './domain/patient';", 'src/types/index.ts')).toBe(false);
  });
});
