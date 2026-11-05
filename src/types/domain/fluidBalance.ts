/** Eloísa totals for one hospital day, 08:00 through 07:59 the next day. */
export interface FluidBalancePeriod {
  intakeMl: number;
  urineOutputMl: number;
  records: number;
}
export interface PatientFluidBalance {
  censusDate: string;
  day: FluidBalancePeriod;
  night: FluidBalancePeriod;
}
