# Protocolo de Auditoría y Cumplimiento MINSAL

## Sistema Hospital Hanga Roa (HHR)

Este documento detalla el enfoque técnico y clínico del sistema de auditoría implementado, diseñado para cumplir con los estándares de seguridad, trazabilidad e integridad de datos exigidos por el Ministerio de Salud de Chile (MINSAL).

## Protocolo de evidencia viva

Los reportes versionados en `reports/` sirven como snapshots útiles, pero no reemplazan la verificación del estado actual del repo.

Antes de usar `reports/system-confidence.md`, `reports/release-readiness-scorecard.md` o `reports/critical-coverage.md` como evidencia de una auditoría técnica, validar siempre:

```bash
git status --short
npm run check:report-freshness
```

Si el árbol está sucio o `check:report-freshness` muestra drift, esos artefactos deben tratarse como contexto histórico y no como fotografía fiel del checkout en revisión. Para un veredicto de release, usa `npm run check:report-freshness:strict` o `npm run check:release-evidence`.

### 1. Marco Legal y Normativo

El sistema se alinea con la **Ley 20.584** (Derechos y Deberes de los Pacientes) y la Norma Técnica de Ficha Clínica Electrónica, asegurando:

- **Trazabilidad Total**: Registro de todo acceso a datos sensibles.
- **Integridad**: Los registros de auditoría son de solo lectura y no pueden ser modificados ni eliminados por los usuarios.
- **Confidencialidad**: Solo usuarios con perfil administrativo/auditor pueden acceder a esta bitácora.

### 2. Enfoque de Registro (Trazabilidad)

El sistema audita de forma automática y obligatoria las siguientes acciones:

#### A. Gestión de Pacientes (Ciclo de Censo)

- **Ingresos y Egresos**: Se registra quién, cuándo y dónde (cama) se realizó el movimiento.
- **Traslados**: Seguimiento de movimientos internos y externos.
- **Limpieza de Datos**: Registro de eliminaciones de registros diarios para control de errores.

#### B. Visualización de Datos Sensibles

Para cumplir con la "Ley de Ficha Clínica", el sistema registra específicamente la visualización de:

- **Entrega de Turno Médica**: Acceso a evoluciones y diagnósticos médicos.
- **Entrega de Turno Enfermería**: Acceso a notas de enfermería y cuidados.
- **Evaluación CUDYR**: Visualización del instrumento de categorización de riesgo.

#### C. Modificaciones Clínicas

- Edición de notas de handoff.
- Cambios en escalas de riesgo y checklists de seguridad.
- Actualización de puntajes CUDYR.

### 3. Seguridad Técnica y Atribución

- **Identificación de Usuario**: Cada registro incluye el correo electrónico del operador autenticado.
- **Atribución para Cuentas Compartidas**: Para cumplir con la responsabilidad individual en cuentas institucionales (ej: `enfermeria.hospitalizados@...`), el sistema identifica automáticamente a los enfermeros asignados al turno en el censo diario y los adjunta como autores responsables en cada registro de visualización o modificación.
- **Metadata de Contexto**: Se registra la dirección IP (vía backend), el navegador y el sistema operativo para análisis forense en caso de incidentes.
- **Persistencia Dual**: Los logs se guardan en una base de datos en la nube (Firestore) con un respaldo local inmediato en el dispositivo del usuario.

### 4. Consultas y Exportación

El sistema permite a los auditores:

1. **Búsqueda Avanzada**: Filtrar por RUT de paciente, usuario o cama específica.
2. **Exportación Legal**: Descarga de registros en formato Excel para auditorías externas o procesos médico-legales.

---

_Este sistema de auditoría es un componente crítico para la acreditación institucional y la seguridad del paciente en el Hospital Hanga Roa._
