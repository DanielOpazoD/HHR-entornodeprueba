export interface StatisticalUnitTransfer {
  changedAt: string;
  unit: string;
}

export interface StatisticalDischargeEvidence {
  run: string;
  /**
   * Present when an episode uses an alternate DEIS Field 5 identifier instead of 1.RUN:
   * - 'maternal': Field 5 code 2 (RUN Materno/progenitor(a))
   * - 'foreign-document': Field 5 codes 4 (Pasaporte), 5 (Documento país de origen) or 6 (FONASA)
   */
  identifierKind?: 'maternal' | 'foreign-document';
  admissionAt: string;
  admissionUnit: string;
  dischargeAt: string;
  transfers: StatisticalUnitTransfer[];
  isDead?: boolean;
}
