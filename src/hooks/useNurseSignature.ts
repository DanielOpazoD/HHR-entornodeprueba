import { useMemo } from 'react';
import { DailyRecord } from '@/types';

export const useNurseSignature = (record: DailyRecord | null) => {
    return useMemo(() => {
        if (!record) return '';
        const nightShift = record.nursesNightShift?.filter(n => n && n.trim()) || [];
        if (nightShift.length > 0) return nightShift.join(' / ');
        return (record.nurses?.filter(n => n && n.trim()) || []).join(' / ');
    }, [record]);
};

export type UseNurseSignatureReturn = ReturnType<typeof useNurseSignature>;
