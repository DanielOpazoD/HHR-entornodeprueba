# Guía de Testing - Hospital Hanga Roa

Este documento describe la estrategia de pruebas para asegurar la calidad y estabilidad del sistema de censo hospitalario.

## 1. Estructura de Tests

El proyecto utiliza **Vitest** como motor de pruebas y se divide en tres niveles:

### Unitarios (`tests/unit/`)
Prueban funciones aisladas sin dependencias externas (ej. `statsCalculator.test.ts`).

### Hooks (`tests/hooks/`)
Validan la lógica de estado y efectos de React usando `@testing-library/react-hooks` (ej. `usePatientTransfers.test.ts`).

### Integración (`tests/integration/`)
Validan flujos completos de negocio y la interacción entre múltiples servicios, hooks y estados.
- `census-export.test.ts`: Flujo de Excel Maestro.
- `handoff-signature.test.ts`: Firma médica y entrega.
- `audit-flow.test.ts`: Trazabilidad de acciones (MINSAL).
- `offline-persistence.test.ts`: Resiliencia ante fallos de red.
- `daily-record-sync.test.ts`: Sincronización Local ↔ Firestore.
- `permissions.test.ts`: Matriz de seguridad RBAC.

### E2E (`e2e/`)
Pruebas de caja negra con **Playwright** que validan la experiencia de usuario en navegadores reales.
- `report-flow.spec.ts`: Flujo completo de entrega y exportación.
- `medical-signature.spec.ts`: Firma anónima de médicos.
- `patient-operations.spec.ts`: Operaciones críticas de pacientes.

## 2. Ejecución de Tests

| Comando | Descripción |
| :--- | :--- |
| `npm test` | Ejecuta todos los tests en modo interactivo. |
| `npm run ci` | Ejecuta Lint -> Test -> Build (usar antes de push). |
| `npm run test:ui` | Abre la interfaz visual de Vitest. |
| `npm run coverage` | Genera reporte de cobertura de código. |

## 3. Mejores Prácticas

1. **Mocks de Firebase**: Siempre usar los mocks definidos en `tests/setup.ts` para evitar llamadas reales a la red.
2. **Datos de Prueba**: Usar las funciones `createMockRecord` definidas en los tests de integración para mantener consistencia.
3. **Regresión**: Si se modifica un flujo crítico (Censo, Firma, Excel), es obligatorio ejecutar la suite de integración correspondiente.
