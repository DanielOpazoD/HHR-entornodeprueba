import type { PatientData } from '@/types/domain/patient';

import React, { createContext } from 'react';
import type {
  DailyRecordDataContextType,
  InventoryStats,
  SyncStatus,
} from '@/context/dailyRecordContextContracts';

import type { DailyRecordBootstrapPhase } from '@/hooks/controllers/dailyRecordBootstrapController';
import type { StabilityRules } from '@/hooks/useStabilityRules';
import type { DailyRecordStaffingDetailsV1 } from '@/types/domain/dailyRecordStaffingDetails';
import type { CMAData, DischargeData, TransferData } from '@/types/domain/movements';
import { DailyRecordActionsContext } from './dailyRecordActionsContext';

export const DailyRecordDataContext = createContext<DailyRecordDataContextType | undefined>(
  undefined
);

export const DailyRecordBedsContext = createContext<Record<string, PatientData> | null | undefined>(
  undefined
);

export const DailyRecordMovementsContext = createContext<
  | {
      discharges: DischargeData[];
      transfers: TransferData[];
      cma: CMAData[];
    }
  | null
  | undefined
>(undefined);

export const DailyRecordSyncContext = createContext<
  | {
      syncStatus: SyncStatus;
      lastSyncTime: Date | null;
      bootstrapPhase: DailyRecordBootstrapPhase;
    }
  | undefined
>(undefined);

export const DailyRecordStabilityContext = createContext<StabilityRules | null | undefined>(
  undefined
);

export const DailyRecordInventoryContext = createContext<InventoryStats | null | undefined>(
  undefined
);

export const DailyRecordStaffContext = createContext<
  | {
      date?: string;
      nursesDayShift: string[];
      nursesNightShift: string[];
      tensDayShift: string[];
      tensNightShift: string[];
      staffingDetailsV1?: DailyRecordStaffingDetailsV1;
      activeExtraBeds: string[];
    }
  | null
  | undefined
>(undefined);

export const DailyRecordOverridesContext = createContext<Record<string, string> | undefined>(
  undefined
);

interface DailyRecordProviderTreeProps {
  actionsValue: React.ComponentProps<typeof DailyRecordActionsContext.Provider>['value'];
  syncValue: React.ComponentProps<typeof DailyRecordSyncContext.Provider>['value'];
  stabilityValue: React.ComponentProps<typeof DailyRecordStabilityContext.Provider>['value'];
  inventoryValue: React.ComponentProps<typeof DailyRecordInventoryContext.Provider>['value'];
  staffValue: React.ComponentProps<typeof DailyRecordStaffContext.Provider>['value'];
  movementsValue: React.ComponentProps<typeof DailyRecordMovementsContext.Provider>['value'];
  bedsValue: React.ComponentProps<typeof DailyRecordBedsContext.Provider>['value'];
  dataValue: React.ComponentProps<typeof DailyRecordDataContext.Provider>['value'];
  overridesValue: React.ComponentProps<typeof DailyRecordOverridesContext.Provider>['value'];
  children: React.ReactNode;
}

export const DailyRecordProviderTree: React.FC<DailyRecordProviderTreeProps> = ({
  actionsValue,
  syncValue,
  stabilityValue,
  inventoryValue,
  staffValue,
  movementsValue,
  bedsValue,
  dataValue,
  overridesValue,
  children,
}) => (
  <DailyRecordActionsContext.Provider value={actionsValue}>
    <DailyRecordSyncContext.Provider value={syncValue}>
      <DailyRecordStabilityContext.Provider value={stabilityValue}>
        <DailyRecordInventoryContext.Provider value={inventoryValue}>
          <DailyRecordStaffContext.Provider value={staffValue}>
            <DailyRecordMovementsContext.Provider value={movementsValue}>
              <DailyRecordBedsContext.Provider value={bedsValue}>
                <DailyRecordDataContext.Provider value={dataValue}>
                  <DailyRecordOverridesContext.Provider value={overridesValue}>
                    {children}
                  </DailyRecordOverridesContext.Provider>
                </DailyRecordDataContext.Provider>
              </DailyRecordBedsContext.Provider>
            </DailyRecordMovementsContext.Provider>
          </DailyRecordStaffContext.Provider>
        </DailyRecordInventoryContext.Provider>
      </DailyRecordStabilityContext.Provider>
    </DailyRecordSyncContext.Provider>
  </DailyRecordActionsContext.Provider>
);
