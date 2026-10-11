export interface StatisticalUnitTransfer {
  changedAt: string;
  unit: string;
}

export interface StatisticalDischargeEvidence {
  run: string;
  admissionAt: string;
  admissionUnit: string;
  dischargeAt: string;
  transfers: StatisticalUnitTransfer[];
  isDead?: boolean;
}
