import { DailyRecord, ShiftType } from '../../types';

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
 * Calculate hospitalized days between admission and current record date.
 */
export const calculateHospitalizedDays = (admissionDate?: string, currentDate?: string): number | null => {
    if (!admissionDate || !currentDate) return null;
    const start = new Date(admissionDate);
    const end = new Date(currentDate);
    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);
    const diff = end.getTime() - start.getTime();
    const days = Math.floor(diff / (1000 * 3600 * 24));
    const totalDays = days + 1;
    return totalDays >= 1 ? totalDays : 1;
};

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
