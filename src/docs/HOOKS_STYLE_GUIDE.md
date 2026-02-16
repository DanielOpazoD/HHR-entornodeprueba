# Guía de Estilo: Hooks de DailyRecord

Esta guía define la jerarquía y el uso correcto de los hooks de acceso al registro diario (`DailyRecord`). El objetivo es mantener la **estabilidad de renderizado** y la **estabilidad referencial** en componentes complejos como la tabla de censo.

## La Regla de Oro

> **"Usa el hook más pequeño que satisfaga tu necesidad."**

---

## 1. Jerarquía de Hooks (De mayor a menor impacto)

| Nivel                   | Hook                             | Qué devuelve                                              | Impacto en Render                                           |
| :---------------------- | :------------------------------- | :-------------------------------------------------------- | :---------------------------------------------------------- |
| **Nivel 1 (Atómico)**   | `useDailyRecord*Actions` acotado | Solo funciones por dominio (`update*`, `add*`, `delete*`) | **NULO**. Las funciones son estables. Úsalo en formularios. |
| **Nivel 2 (Fragmento)** | `useDailyRecordBeds`             | Solo `record.beds`                                        | **MEDIO**. Solo re-renderiza si cambia alguna cama.         |
| **Nivel 2 (Fragmento)** | `useDailyRecordStaff`            | Solo enfermeros y TENS                                    | **BAJO**. Solo re-renderiza si cambia el personal.          |
| **Nivel 2 (Fragmento)** | `useDailyRecordMovements`        | Altas, Traslados y CMA                                    | **BAJO**.                                                   |
| **Nivel 3 (Estado)**    | `useDailyRecordStatus`           | `syncStatus`, `lastSyncTime`                              | **FRECUENTE**. Re-renderiza en cada fase de red.            |
| **Nivel Crítico**       | `useDailyRecordData`             | **Todo el registro completo**                             | **MÁXIMO**. Re-renderiza con CADA cambio. **EVITAR.**       |

---

## 2. Patrones de Diseño

### Escenario A: Un botón que dispara una acción (ej. Alta)

No necesitas leer el estado para disparar la acción.

```typescript
// ✅ CORRECTO
const { addDischarge } = useDailyRecordMovementActions();
return <button onClick={() => addDischarge(bedId)}>Alta</button>;
```

### Escenario B: Una celda que muestra y edita datos

Divide la lectura de la escritura.

```typescript
// ✅ CORRECTO
const beds = useDailyRecordBeds();
const { updatePatient } = useDailyRecordBedActions();
const patient = beds[bedId];

return <input value={patient.name} onChange={(e) => updatePatient(bedId, { name: e.target.value })} />;
```

### Escenario C: Cabecero de Personal

No uses el hook de camas aquí, usa el de staff.

```typescript
// ✅ CORRECTO
const { nursesDayShift } = useDailyRecordStaff();
const { updateNurse } = useDailyRecordStaffActions();
```

---

## 3. Por qué no usar `useDailyRecordData`?

El hook `useDailyRecordData` devuelve el objeto `record` completo. Debido a cómo funciona React, cualquier cambio en una profundidad del objeto (ej. `record.beds.B1.name`) genera una nueva instancia de `record`.

Si usas `useDailyRecordData` en la raíz de la tabla, **todos los 18-24 componentes del censo se re-renderizarán en cada pulsación de tecla**, degradando la experiencia de usuario (lag al escribir).

### ¿Cuándo es aceptable?

Solo en componentes de alto nivel que necesiten exportar el JSON completo (ej. Generador de Backup) o realizar cálculos agregados muy pesados que ya estén memorizados.

---

## 4. Estabilidad Estructural (Zod + applyPatches)

Gracias al uso de `applyPatches` en el repositorio, cuando actualizas la `Cama 1`, el objeto de la `Cama 2` mantiene su referencia exacta en memoria.
Esto significa que si usas `React.memo` en tus componentes de fila, React sabrá que no necesitan re-renderizarse.

```typescript
// En PatientRow.tsx
export const PatientRow = React.memo(({ bed, data }) => {
   // Gracias a la fragmentación, 'data' solo cambiará si esta cama específica cambia.
   return (...)
});
```
