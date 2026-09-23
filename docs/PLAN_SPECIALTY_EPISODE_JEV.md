# Plan: especialidad por episodio, reglas y Jev consultivo

Base: `origin/main` en `8b73d03e` (23-09-2026). PR #457 es referencia de requisitos y pruebas; no es base ni se integrará completo. Automatización y Jev permanecen apagados por defecto. Sin despliegue ni datos clínicos reales.

## Alcance y responsabilidades

1. **Decisión manual y persistencia.** `functions/lib/dailyRecordWriteAuthorityFunctions.js` y un módulo pequeño de contrato de especialidad validarán episodio, revisión y una intención explícita; la autoridad existente firmará procedencia y auditoría en una sola transacción. `src/types/domain/patient.ts`, `src/schemas/zod/patient.ts`, los controladores de censo, repositorio/outbox y `SpecialtyChip.tsx` sólo transportarán la intención y mostrarán el resultado confirmado. Copia de día, cama/cuna, importación Rayen y guardado completo conservarán decisiones protegidas.
2. **Reglas deterministas y memoria explícita.** Un resolver puro de servidor y un catálogo pequeño de configuración resolverán sólo episodios pendientes con evidencia suficiente. La memoria CIE-10 requerirá publicación explícita, revisión esperada y permiso de administrador. El enriquecimiento clínico y los commits autorizados llamarán al mismo resolver; el navegador no firmará reglas.
3. **Jev consultivo.** Un callable de Firebase leerá un snapshot mínimo, reservará solicitudes/cuota y llamará a un adaptador HTTP estrecho conforme a documentación oficial vigente. Jev sólo propone; aceptar exigirá recibo y vigencia revalidados por la autoridad clínica, con una sola mutación. Sin credencial/configuración y aprobación institucional, la consulta queda inactiva.

## Aceptación

- Prioridad manual, incluido vacío intencional; legacy protegido; nueva identidad/episodio y cuna aislados; ni importación, replay, copia o save completo pueden falsificar procedencia o sobrescribir una decisión.
- Dos vistas incompatibles producen conflicto; una aceptación genera exactamente un commit de especialidad y auditoría; respuesta tardía, episodio o evidencia distintos no se aplican.
- Regla/memoria sólo asignan a pendiente con precedencia y conflictos deterministas; `Otro` nunca se asigna automáticamente; recordar no ocurre al seleccionar para un paciente.
- Jev usa únicamente un paquete aprobado sin identificadores, no tiene escritura clínica, y falla cerrado ante respuestas inválidas o cuota agotada.
- Pruebas focalizadas de dominio, autoridad con emulador, rutas de importación/outbox y E2E de censo; además `typecheck`, `check:quality` y gate de CI pertinente. Registrar por separado pruebas reales, simulación de proveedor y validación clínica pendiente.

## Ajustes respecto del HTML

Se conserva la autoridad, la revisión, el outbox y el estilo de especialidad ya presentes. El presupuesto de líneas y los nombres de archivos del informe son orientativos; el contrato de mutación y las fuentes de evidencia actuales determinan la integración. No se habilitará una regla basada en autor clínico hasta verificar una captura autoritativa de ese dato. La evaluación clínica local y cualquier transferencia de datos reales a Jev están fuera de este PR.
