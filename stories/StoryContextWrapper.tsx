import React, { useMemo } from 'react';
import { DailyRecordProvider } from '../context/DailyRecordContext';
import { CensusActionsProvider } from '../views/census/CensusActionsContext';
import { TableConfigProvider } from '../context/TableConfigContext';
import { UIProvider } from '../context/UIContext';
import { AuditProvider } from '../context/AuditContext';
import { DailyRecord } from '../types';
import { createMockDailyRecordContext, createMockDailyRecord } from './censusMocks';

interface StoryContextWrapperProps {
    children: React.ReactNode;
    record?: DailyRecord;
}

/**
 * StoryContextWrapper
 * Simplifies Storybook setup by providing all necessary contexts
 * used by Census and Cudyr components.
 */
export const StoryContextWrapper: React.FC<StoryContextWrapperProps> = ({
    children,
    record
}) => {
    // Generate a full mock context value. If a record is provided, it will override the default mock record.
    const contextValue = useMemo(() => {
        return createMockDailyRecordContext(record ? { record } : { record: createMockDailyRecord() });
    }, [record]);

    return (
        <UIProvider>
            <AuditProvider userId="storybook-user">
                <DailyRecordProvider value={contextValue}>
                    <TableConfigProvider>
                        <CensusActionsProvider>
                            <div className="p-4 bg-slate-50 min-h-screen">
                                {children}
                            </div>
                        </CensusActionsProvider>
                    </TableConfigProvider>
                </DailyRecordProvider>
            </AuditProvider>
        </UIProvider>
    );
};
