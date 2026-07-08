# Clinical Release Validation

Generated at: 2026-07-05T05:17:02.042Z
Commit: aa82d67c
Worktree: clean
Overall: ok
Runbook: docs/runbooks/deployment-checklist.md (ok)

## Closure Gates

- codigo_corregido
- regresion_automatizada
- flujo_clinico_validado

## Scenarios

| Scenario | Risk | Matrix areas | Automated regression | Manual validation |
| --- | --- | --- | --- | --- |
| Censo diario: recarga, cache local y reconciliacion remota | high | census_runtime, sync_and_firestore | test:e2e:clinical-stability:ci, test:e2e:critical:ci, test:firestore:release:ci | Abrir censo con datos existentes, recargar, confirmar que cama/estado/acciones siguen visibles y que banners no bloquean decisiones clinicas. |
| Pending patch: mismo episodio, cambio de cama, episodio distinto y patch mixto | high | census_runtime, sync_and_firestore | test:ci:unit, test:e2e:clinical-stability:ci, test:e2e:critical:ci | Validar que un cambio de cama conserva el patch del mismo episodio, purga episodio distinto y no borra campos clinicos no trackeados. |
| Documentos clinicos: borrador, firma, PDF e impresion | high | clinical_documents | test:clinical-documents, test:e2e:clinical-stability:ci, test:e2e:clinical-visual-release | Crear/editar documento clinico, imprimir/exportar y comprobar que no se sobreescribe contenido ni se rompe el formato printable. |
| Entrega de turno: resumen, persistencia y exportacion | medium | handoff, export_and_backup | test:ci:unit, test:e2e:clinical-stability:ci, test:e2e:critical:ci | Generar entrega de turno desde pacientes activos y confirmar que resumen, prioridades y exportacion corresponden al censo actual. |
| Dependencias clinicas externas: laboratorio, radiologia y funciones Netlify | medium | serverless_netlify, export_and_backup | test:risk:platform, test:serverless-deploy-smoke | Simular disponible/no disponible y confirmar que errores de laboratorio/radiologia son visibles, no silenciosos y no bloquean censo. |
| Respaldo y exportaciones: Excel/PDF y recuperacion operacional | medium | export_and_backup, repositories | test:platform-resilience, test:e2e:clinical-stability:ci, test:e2e:critical:ci | Exportar datos criticos, revisar archivo generado y comprobar que la recuperacion operacional no altera pacientes activos. |
