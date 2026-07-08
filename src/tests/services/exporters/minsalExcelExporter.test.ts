import ExcelJS from 'exceljs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DailyStatsSnapshot, MinsalStatistics } from '@/types/minsalTypes';
import { exportMinsalToExcel } from '@/services/exporters/minsalExcelExporter';

const mockDownloadWorkbookFile = vi.fn();

vi.mock('@/services/exporters/excelFileDownload', () => ({
  downloadWorkbookFile: (...args: unknown[]) => mockDownloadWorkbookFile(...args),
}));

describe('minsalExcelExporter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports specialty headers with explicit period vs snapshot semantics', async () => {
    const stats: MinsalStatistics = {
      periodStart: '2026-03-01',
      periodEnd: '2026-03-31',
      totalDays: 31,
      calendarDays: 31,
      diasCamaDisponibles: 620,
      diasCamaOcupados: 434,
      tasaOcupacion: 70,
      promedioDiasEstada: 5.6,
      promedioDiasEstadaMinima: 2,
      promedioDiasEstadaMaxima: 10,
      egresosTotal: 38,
      egresosVivos: 34,
      egresosFallecidos: 2,
      egresosTraslados: 2,
      mortalidadHospitalaria: 5.3,
      indiceRotacion: 1.2,
      pacientesActuales: 14,
      camasOcupadas: 14,
      camasBloqueadas: 1,
      camasDisponibles: 20,
      camasLibres: 5,
      tasaOcupacionActual: 70,
      porEspecialidad: [
        {
          specialty: 'Cirugía',
          pacientesActuales: 5,
          egresos: 12,
          fallecidos: 1,
          traslados: 0,
          aerocardal: 0,
          fach: 0,
          diasOcupados: 120,
          contribucionRelativa: 28,
          tasaMortalidad: 8.3,
          promedioDiasEstada: 6.2,
          promedioDiasEstadaMinima: 2,
          promedioDiasEstadaMaxima: 10,
        },
      ],
      cma: {
        total: 3,
        cirugiaMayorAmbulatoria: 2,
        procedimientoMedicoAmbulatorio: 1,
        porEspecialidad: [
          {
            specialty: 'Traumatología',
            total: 2,
            cirugiaMayorAmbulatoria: 2,
            procedimientoMedicoAmbulatorio: 0,
          },
          {
            specialty: 'Med Interna',
            total: 1,
            cirugiaMayorAmbulatoria: 0,
            procedimientoMedicoAmbulatorio: 1,
          },
        ],
      },
    };

    const trendData: DailyStatsSnapshot[] = [
      {
        date: '2026-03-30',
        ocupadas: 14,
        disponibles: 20,
        bloqueadas: 1,
        egresos: 2,
        fallecidos: 0,
        tasaOcupacion: 70,
      },
    ];

    await exportMinsalToExcel(stats, trendData);

    expect(mockDownloadWorkbookFile).toHaveBeenCalledTimes(1);
    const [{ workbook, filename }] = mockDownloadWorkbookFile.mock.calls[0] as [
      { workbook: ExcelJS.Workbook; filename: string },
    ];

    expect(filename).toBe('Estadisticas_MINSAL_2026-03-01_2026-03-31.xlsx');

    const specialtySheet = workbook.getWorksheet('Por Especialidad');
    expect(specialtySheet).toBeDefined();
    const headerValues = (specialtySheet?.getRow(1).values ?? []) as unknown[];
    expect(headerValues.slice(1)).toEqual([
      'Especialidad',
      'Pacientes del último registro',
      'Egresos del período',
      'Fallecidos',
      'Días-cama del período',
      'Contribución (%)',
      'Mortalidad del período (%)',
      'Estada media de egresos (días)',
      'Rango estada egresos',
    ]);

    const lastRow = specialtySheet?.getRow((specialtySheet?.rowCount ?? 0) as number).values as
      | unknown[]
      | undefined;
    expect(lastRow?.slice(1)).toEqual([
      'Total',
      14,
      36,
      2,
      434,
      '100.0',
      '5.3',
      '5.60',
      '2.0 - 10.0 días',
    ]);

    const cmaSheet = workbook.getWorksheet('CMA');
    expect(cmaSheet).toBeDefined();
    const cmaHeaderValues = (cmaSheet?.getRow(1).values ?? []) as unknown[];
    const cmaFirstRowValues = (cmaSheet?.getRow(2).values ?? []) as unknown[];
    const cmaTotalRowValues = (cmaSheet?.getRow(4).values ?? []) as unknown[];
    expect(cmaHeaderValues.slice(1)).toEqual([
      'Especialidad',
      'Total CMA/PMA',
      'Cirugía Mayor Ambulatoria',
      'Procedimiento Médico Ambulatorio',
    ]);
    expect(cmaFirstRowValues.slice(1)).toEqual(['Traumatología', 2, 2, 0]);
    expect(cmaTotalRowValues.slice(1)).toEqual(['Total', 3, 2, 1]);
  });
});
