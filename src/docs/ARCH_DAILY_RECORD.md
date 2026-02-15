# Arquitectura de Contextos: DailyRecordContext

Para maximizar el performance y evitar re-renders innecesarios en la tabla del censo (18+ filas), el contexto `DailyRecord` se ha fragmentado.

## Guía de Hooks

A la hora de desarrollar un componente, **elige siempre el hook más específico posible**.

| Hook                      | Contenido                      | Cuándo usarlo                                                 | Impacto Performance                              |
| :------------------------ | :----------------------------- | :------------------------------------------------------------ | :----------------------------------------------- |
| `useDailyRecordBeds`      | `record.beds`                  | En filas de pacientes (`PatientRow`) o tabla principal.       | Bajo (solo re-render ante cambios en camas).     |
| `useDailyRecordStaff`     | Enfermeros y TENS              | En el cabecero de personal.                                   | Bajo (independiente de los pacientes).           |
| `useDailyRecordMovements` | Altas, Traslados y CMA         | En secciones de movimientos.                                  | Bajo (independiente del censo principal).        |
| `useDailyRecordStability` | Reglas de bloqueo              | En inputs editables.                                          | Bajo.                                            |
| `useDailyRecordActions`   | Funciones `update*`, `create*` | **Cualquier componente que solo necesite disparar acciones.** | **Cero (Referencialmente estable).**             |
| `useDailyRecordData`      | Todo el registro (CRUD)        | Solo en vistas de administración global.                      | **Alto (Re-render en cada pulsación de tecla).** |

## Patrón Recomendado

Si necesitas mostrar datos de una cama y editarlos:

```typescript
// LEGACY (Deprecated: provoca re-renders en CADA letra que alguien escriba en cualquier cama)
const { record, updatePatient } = useDailyRecordContext();

// BIEN (Optimizado)
const beds = useDailyRecordBeds();
const patient = beds[bedId];
const { updatePatient } = useDailyRecordActions();
```

## Structural Sharing

El sistema utiliza `applyPatches.ts` para asegurar que si editas la cama 1, el objeto de la cama 2 siga siendo exactamente la misma instancia (`===`), permitiendo que `React.memo` ignore las filas no afectadas.
