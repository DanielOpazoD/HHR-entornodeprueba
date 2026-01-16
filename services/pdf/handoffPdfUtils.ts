import { DailyRecord, ShiftType } from '../../types';
import { calculateHospitalizedDays } from '@/utils/dateUtils';

export interface Schedule {
    dayStart?: string;
    dayEnd?: string;
    nightStart?: string;
    nightEnd?: string;
}

/**
 * Helper to convert image to DataURI for embedding in PDF.
 */
export const getBase64ImageFromURL = (url: string): Promise<string> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.src = url;
        img.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext("2d");
            ctx?.drawImage(img, 0, 0);
            const dataURL = canvas.toDataURL("image/png");
            resolve(dataURL);
        };
        img.onerror = (error) => reject(error);
    });
};

/**
 * Re-export centralized utility
 */
export { calculateHospitalizedDays };

/**
 * Get staff info for nursing handoff.
 */
export const getHandoffStaffInfo = (record: DailyRecord, selectedShift: ShiftType) => {
    const delivers = selectedShift === 'day'
        ? (record.nursesDayShift || [])
        : (record.nursesNightShift || []);
    const receives = selectedShift === 'day'
        ? (record.nursesNightShift || [])
        : (record.handoffNightReceives || []);
    const tens = selectedShift === 'day'
        ? (record.tensDayShift || [])
        : (record.tensNightShift || []);

    return { delivers, receives, tens };
};
