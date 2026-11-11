// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { isDomainTypeFacade } from '../../../scripts/lib/domainTypeHome.mjs';

const FILE = 'src/shared/contracts/example.ts';
const facade = (source: string, file = FILE) => isDomainTypeFacade(file, source);

describe('a domain type has one home', () => {
  it.each([
    "import type { Other } from './other';\nexport type PatientData = Other;",
    'export interface PatientData { name: string }',
    'export interface DailyRecord { date: string }',
    "import type { DailyRecord as R } from '@/types/domain/dailyRecord'; export type DailyRecord = R;",
    "import type { DailyRecordPatch as P } from '@/types/domain/dailyRecordPatch'; export type Patch = P;",
    "export type { DailyRecordDateRef } from '@/types/domain/dailyRecordSlices';",
    "export * from '@/types/domain/dailyRecordMedicalHandoff';",
    "import type { DetailedStaffAssignment as D } from '@/types/domain/dailyRecordStaffingDetails'; export type Detail = D;",
    "export type { DischargeData } from '@/types/domain/movements';",
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
    "import { DailyRecord } from '@/types/domain/dailyRecord';\nexport type Rec = DailyRecord;",
    "import * as Records from '@/types/domain/dailyRecord';\nexport type Rec = Records.DailyRecord;",
    "export { DailyRecord } from '@/types/domain/dailyRecord';",
    "export { DailyRecordPatch } from '../../types/domain/dailyRecordPatch';",
    "import { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';\nexport { DailyRecordPatch };",
  ])('rejects a facade: %s', source => {
    expect(facade(source)).toBe(true);
  });

  it.each([
    "export { BedType } from '@/types/domain/beds';",
    "import { PatientStatus } from '@/types/domain/patientClassification'; export { PatientStatus };",
    "import type { DailyRecord } from '@/types/domain/dailyRecord'; export type Patch = Partial<DailyRecord>;",
    "import type { DailyRecord } from '@/types/domain/dailyRecord'; export type Beds = DailyRecord['beds'];",
    "import type { DailyRecord } from '@/types/domain/dailyRecord'; export interface HandoffDailyRecordContract { date: DailyRecord['date'] }",
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
