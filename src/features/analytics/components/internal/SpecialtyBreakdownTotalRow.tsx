import React from 'react';

interface SpecialtyBreakdownTotalRowProps {
  totalPacientesActuales: number;
  totalEgresos: number;
  totalFallecidos: number;
  totalTraslados: number;
  totalAerocardal: number;
  totalFach: number;
  totalMortalidad: number;
  totalPromedioDiasEstada: number;
  totalRange: string;
}

export const SpecialtyBreakdownTotalRow: React.FC<SpecialtyBreakdownTotalRowProps> = ({
  totalPacientesActuales,
  totalEgresos,
  totalFallecidos,
  totalTraslados,
  totalAerocardal,
  totalFach,
  totalMortalidad,
  totalPromedioDiasEstada,
  totalRange,
}) => (
  <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
    <td className="sticky left-0 z-10 bg-slate-50 px-4 py-3 text-left text-slate-800">Total</td>
    <td className="px-4 py-3 text-center text-slate-800">{totalPacientesActuales}</td>
    <td className="px-4 py-3 text-center text-slate-800">{totalEgresos}</td>
    <td className="px-4 py-3 text-center text-slate-800">{totalFallecidos}</td>
    <td className="px-4 py-3 text-center text-slate-800">{totalTraslados}</td>
    <td className="px-4 py-3 text-center text-slate-800">{totalAerocardal}</td>
    <td className="px-4 py-3 text-center text-slate-800">{totalFach}</td>
    <td className="px-4 py-3 text-center text-slate-800">100.0%</td>
    <td className="px-4 py-3 text-center text-slate-800">{totalMortalidad.toFixed(1)}%</td>
    <td className="px-4 py-3 text-center text-slate-800">
      {totalPromedioDiasEstada.toFixed(2)} días
    </td>
    <td className="px-4 py-3 text-center text-slate-800">{totalRange}</td>
  </tr>
);
