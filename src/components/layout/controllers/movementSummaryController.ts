import type { DischargeData, TransferData } from '@/types/domain/movements';
import { getStatisticalDischarges } from '@/application/census/movementTombstonePolicy';

export interface MovementSummaryModel {
  totalDeaths: number;
  totalDischarges: number;
  totalTransfers: number;
  cmaCount: number;
  newAdmissions: number;
}

export const buildMovementSummaryModel = (
  discharges: DischargeData[] = [],
  transfers: TransferData[] = [],
  cmaCount: number = 0,
  newAdmissions: number = 0
): MovementSummaryModel => {
  const statisticalDischarges = getStatisticalDischarges(discharges);
  return {
    totalDeaths: statisticalDischarges.filter(discharge => discharge.status === 'Fallecido').length,
    totalDischarges: statisticalDischarges.length,
    totalTransfers: transfers.length,
    cmaCount,
    newAdmissions,
  };
};
