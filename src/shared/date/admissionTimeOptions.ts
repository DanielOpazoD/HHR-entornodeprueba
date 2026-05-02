export interface AdmissionTimePickerModel {
  selectedHour: string;
  selectedMinute: string;
  hourOptions: string[];
  minuteOptions: string[];
}

const padClockValue = (value: number): string => String(value).padStart(2, '0');

const parseTimePart = (value: string | undefined, index: number): number | null => {
  if (!value) {
    return null;
  }

  const rawPart = value.split(':')[index];
  if (!rawPart) {
    return null;
  }

  const parsed = Number.parseInt(rawPart, 10);
  return Number.isNaN(parsed) ? null : parsed;
};

const buildWrappedDescendingOptions = (start: number, size: number): string[] =>
  Array.from({ length: size }, (_, offset) => padClockValue((start - offset + size) % size));

export const resolveAdmissionTimePickerModel = ({
  admissionTime,
  now = new Date(),
}: {
  admissionTime?: string;
  now?: Date;
}): AdmissionTimePickerModel => {
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const selectedHour = parseTimePart(admissionTime, 0) ?? currentHour;
  const selectedMinute = parseTimePart(admissionTime, 1) ?? currentMinute;

  return {
    selectedHour: padClockValue(selectedHour),
    selectedMinute: padClockValue(selectedMinute),
    hourOptions: buildWrappedDescendingOptions(currentHour, 24),
    minuteOptions: buildWrappedDescendingOptions(currentMinute, 60),
  };
};

export const resolveAdmissionTimeValue = ({
  hour,
  minute,
}: {
  hour: string;
  minute: string;
}): string => `${hour}:${minute}`;
