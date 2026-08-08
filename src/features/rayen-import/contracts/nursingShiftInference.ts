export type NursingActivitySource =
  | 'evolution'
  | 'shift-change'
  | 'evaluation-scale'
  | 'medication-administration'
  | 'vital-signs';

export interface RayenNurseAuthorIdentity {
  firstGivenName: string;
  firstSurname: string;
}

/** Minimal, text-free evidence returned by the extension for shift attribution. */
export interface RayenNursingActivity {
  author: string;
  /** Structured identity supplied only when Eloisa exposes authoritative name fields. */
  authorIdentity?: RayenNurseAuthorIdentity;
  role: string;
  recordedAt: string;
  source: NursingActivitySource;
  archived?: boolean;
  crossedOut?: boolean;
}

export interface NursingShiftEvidence {
  name: string;
  /** Exact Eloisa author labels that were safely resolved to this identity. */
  observedNames?: string[];
  /** Authoritative first-name + first-surname aliases exposed by Eloisa. */
  identityAliases?: string[];
  records: number;
  patients: number;
  activeHours: number;
  score: number;
  hasShiftChange: boolean;
  catalogMatched: boolean;
}

export type NursingBoundaryKind = 'day_start' | 'night_start' | 'night_end';

/** One signed action deliberately excluded because it falls inside a handoff safety window. */
export interface NursingBoundaryExclusion {
  name: string;
  role: string;
  recordedAt: string;
  source: NursingActivitySource;
  boundary: NursingBoundaryKind;
}

export interface NursingShiftSuggestion {
  names: string[];
  /** Exact HHR catalog identities used while resolving Eloisa authors. */
  catalogNames?: string[];
  /** Nurses already present in the matching HHR shift; informational, never re-applied. */
  alreadyAssigned?: string[];
  /** Existing standard slots shown when confirmation would replace an incorrect complete roster. */
  currentNames?: string[];
  /** True only for an explicit, unambiguous two-slot replacement proposal. */
  replaceStandardSlots?: boolean;
  candidates: NursingShiftEvidence[];
  ignoredBoundaryRecords: number;
  /** Auditable detail behind ignoredBoundaryRecords; optional for persisted legacy proposals. */
  ignoredBoundaryEvidence?: NursingBoundaryExclusion[];
  ambiguous: boolean;
}

export interface NursingStaffingProposal {
  censusDate: string;
  /** Census revision whose patient histories produced this proposal. */
  sourceLastUpdated?: string;
  /** Enfermeras(os), dos cupos estándar por turno. */
  day: NursingShiftSuggestion;
  night: NursingShiftSuggestion;
  /** TENS/paramédicos, tres cupos estándar por turno. Optional for legacy proposals. */
  tensDay?: NursingShiftSuggestion;
  tensNight?: NursingShiftSuggestion;
}
