import type jsPDF from 'jspdf';
import type { ShiftType } from '@/types/domain/shift';
import { getMonthRecordsFromFirestore } from '@/services/storage/firestore';
import { generateDateRange } from '@/utils/dateRangeUtils';
import { getShiftSchedule } from '@/utils/clinicalDayUtils';
import type { BaseStoredFile } from '@/services/backup/baseStorageService';
import type { StoredPdfFile } from '@/services/backup/pdfStorageService';
import { formatBackupShiftLabel } from '@/shared/backup/backupPresentation';
import type { CensusExportRecord } from '@/services/contracts/censusExportServiceContracts';
import type { DailyRecordHandoffPdfState as HandoffPdfRecord } from '@/types/domain/dailyRecordSlices';
import type {
  DailyRecordBackfillRef,
  DailyRecordCudyrExportState,
} from '@/types/domain/dailyRecordSlices';

export type MonthlyBackfillType = 'handoff' | 'census' | 'cudyr';

export interface MonthlyBackfillProgress {
  completed: number;
  total: number;
  currentLabel?: string;
}

export interface MonthlyBackfillResult {
  totalPlanned: number;
  created: number;
  failed: number;
  skippedNoRecord: number;
  errors: string[];
}

export interface RunMonthlyBackfillInput {
  backupType: MonthlyBackfillType;
  year: number;
  monthNumber: number;
  existingFiles: Array<BaseStoredFile | StoredPdfFile>;
  onProgress?: (progress: MonthlyBackfillProgress) => void;
}

type BackfillTask =
  | {
      type: 'handoff';
      date: string;
      shiftType: ShiftType;
    }
  | {
      type: 'census' | 'cudyr';
      date: string;
    };

interface MonthlyBackfillPlan {
  tasks: BackfillTask[];
  skippedNoRecordDates: string[];
}

interface RunMonthlyBackfillTasksInput {
  tasks: BackfillTask[];
  skippedNoRecordDates: string[];
  onProgress?: (progress: MonthlyBackfillProgress) => void;
  processTask: (task: BackfillTask) => Promise<void>;
}

type MonthlyBackfillRecord = HandoffPdfRecord &
  CensusExportRecord &
  DailyRecordCudyrExportState &
  DailyRecordBackfillRef;

const isStoredPdfFile = (file: BaseStoredFile | StoredPdfFile): file is StoredPdfFile => {
  return 'shiftType' in file;
};

const resolveCurrentMonthFlag = (year: number, monthNumber: number): boolean => {
  const now = new Date();
  return now.getFullYear() === year && now.getMonth() + 1 === monthNumber;
};

const getNoRecordDates = (
  year: number,
  monthNumber: number,
  recordMap: Map<string, MonthlyBackfillRecord>
): string[] => {
  const allDays = generateDateRange(year, monthNumber, resolveCurrentMonthFlag(year, monthNumber));
  return allDays.filter(date => !recordMap.has(date));
};

const createMonthlyBackfillPlan = (
  backupType: MonthlyBackfillType,
  records: MonthlyBackfillRecord[],
  existingFiles: Array<BaseStoredFile | StoredPdfFile>,
  year: number,
  monthNumber: number
): MonthlyBackfillPlan => {
  const sortedRecords = [...records].sort((a, b) => a.date.localeCompare(b.date));
  const recordMap = new Map(sortedRecords.map(record => [record.date, record]));
  const skippedNoRecordDates = getNoRecordDates(year, monthNumber, recordMap);

  if (backupType === 'handoff') {
    const existingByDate = new Map<string, Set<ShiftType>>();

    existingFiles.filter(isStoredPdfFile).forEach(file => {
      const shifts = existingByDate.get(file.date) ?? new Set<ShiftType>();
      shifts.add(file.shiftType);
      existingByDate.set(file.date, shifts);
    });

    const tasks: BackfillTask[] = [];

    sortedRecords.forEach(record => {
      const shifts = existingByDate.get(record.date);
      if (!shifts?.has('day')) {
        tasks.push({ type: 'handoff', date: record.date, shiftType: 'day' });
      }
      if (!shifts?.has('night')) {
        tasks.push({ type: 'handoff', date: record.date, shiftType: 'night' });
      }
    });

    return { tasks, skippedNoRecordDates };
  }

  const existingDates = new Set(existingFiles.map(file => file.date));
  const tasks: BackfillTask[] = sortedRecords
    .filter(record => !existingDates.has(record.date))
    .map(record => ({ type: backupType, date: record.date }));

  return { tasks, skippedNoRecordDates };
};

const taskLabel = (task: BackfillTask): string => {
  if (task.type === 'handoff') {
    return `${task.date} (${formatBackupShiftLabel(task.shiftType)})`;
  }
  return task.date;
};

const createTaskProcessor = async (
  backupType: MonthlyBackfillType,
  sortedRecords: MonthlyBackfillRecord[],
  recordMap: Map<string, MonthlyBackfillRecord>,
  year: number,
  monthNumber: number
): Promise<(task: BackfillTask) => Promise<void>> => {
  if (backupType === 'handoff') {
    const [{ default: JsPdfCtor }, autoTableModule, { buildHandoffPdfContent }, { uploadPdf }] =
      await Promise.all([
        import('jspdf'),
        import('jspdf-autotable'),
        import('@/services/backup/pdfContentBuilder'),
        import('@/services/backup/pdfStorageService'),
      ]);

    const autoTable = autoTableModule.default as Parameters<typeof buildHandoffPdfContent>[4];

    return async task => {
      if (task.type !== 'handoff') return;
      const record = recordMap.get(task.date);
      if (!record) return;

      const schedule = getShiftSchedule(record.date);
      const doc: jsPDF = new JsPdfCtor();
      await buildHandoffPdfContent(doc, record, task.shiftType, schedule, autoTable);
      const pdfBlob = doc.output('blob');
      await uploadPdf(pdfBlob, record.date, task.shiftType);
    };
  }

  if (backupType === 'census') {
    const [{ buildCensusMasterBinary }, { uploadCensus }] = await Promise.all([
      import('@/services/exporters/censusMasterWorkbook'),
      import('@/services/backup/censusStorageService'),
    ]);
    const recordIndexByDate = new Map(sortedRecords.map((record, index) => [record.date, index]));

    return async task => {
      if (task.type !== 'census') return;
      const recordIndex = recordIndexByDate.get(task.date);
      if (recordIndex === undefined) return;

      const recordsUntilDate = sortedRecords.slice(0, recordIndex + 1);
      const binary = await buildCensusMasterBinary(recordsUntilDate);
      const blob = new Blob([binary], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

      await uploadCensus(blob, task.date);
    };
  }

  const [{ generateCudyrMonthlyExcelBlob }, { uploadCudyrExcel }] = await Promise.all([
    import('@/services/cudyr/cudyrExportService'),
    import('@/services/backup/cudyrStorageService'),
  ]);

  return async task => {
    if (task.type !== 'cudyr') return;
    const record = recordMap.get(task.date) ?? null;
    const blob = await generateCudyrMonthlyExcelBlob(year, monthNumber, task.date, record);
    await uploadCudyrExcel(blob, task.date);
  };
};

const runMonthlyBackfillTasks = async ({
  tasks,
  skippedNoRecordDates,
  onProgress,
  processTask,
}: RunMonthlyBackfillTasksInput): Promise<MonthlyBackfillResult> => {
  if (tasks.length === 0) {
    return {
      totalPlanned: 0,
      created: 0,
      failed: 0,
      skippedNoRecord: skippedNoRecordDates.length,
      errors: [],
    };
  }

  let created = 0;
  let failed = 0;
  const errors: string[] = [];
  const total = tasks.length;

  for (let index = 0; index < tasks.length; index += 1) {
    const task = tasks[index];
    onProgress?.({
      completed: index,
      total,
      currentLabel: taskLabel(task),
    });

    try {
      await processTask(task);
      created += 1;
    } catch (error) {
      failed += 1;
      const reason = error instanceof Error ? error.message : String(error);
      errors.push(`${taskLabel(task)}: ${reason}`);
    }

    onProgress?.({
      completed: index + 1,
      total,
      currentLabel: taskLabel(task),
    });
  }

  return {
    totalPlanned: total,
    created,
    failed,
    skippedNoRecord: skippedNoRecordDates.length,
    errors,
  };
};

export const runMonthlyBackfill = async ({
  backupType,
  year,
  monthNumber,
  existingFiles,
  onProgress,
}: RunMonthlyBackfillInput): Promise<MonthlyBackfillResult> => {
  const monthRecords = await getMonthRecordsFromFirestore(year, monthNumber - 1);
  const sortedRecords = [...monthRecords].sort((a, b) => a.date.localeCompare(b.date));
  const recordMap = new Map(sortedRecords.map(record => [record.date, record]));

  const { tasks, skippedNoRecordDates } = createMonthlyBackfillPlan(
    backupType,
    sortedRecords,
    existingFiles,
    year,
    monthNumber
  );

  if (tasks.length === 0) {
    return runMonthlyBackfillTasks({
      tasks,
      skippedNoRecordDates,
      onProgress,
      processTask: async () => undefined,
    });
  }

  const processTask = await createTaskProcessor(
    backupType,
    sortedRecords,
    recordMap,
    year,
    monthNumber
  );

  return runMonthlyBackfillTasks({
    tasks,
    skippedNoRecordDates,
    onProgress,
    processTask,
  });
};

export const __testing = {
  createMonthlyBackfillPlan,
  runMonthlyBackfillTasks,
};
