export interface StatisticalUnitTransfer {
  changedAt: string;
  unit: string;
}

export interface StatisticalDischargeEvidence {
  run: string;
  /** Only present when an exact neonatal episode explicitly opts into maternal identification. */
  identifierKind?: 'maternal';
  admissionAt: string;
  admissionUnit: string;
  dischargeAt: string;
  transfers: StatisticalUnitTransfer[];
  isDead?: boolean;
}
