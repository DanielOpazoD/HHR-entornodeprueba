# Diario Editor Contract Mapping

## Objetivo

Mapear el modelo del editor `reports` de `Diario` al nuevo módulo `clinical-documents` de HHR sin copiar su backend ni su store.

## Mapping principal

| Diario              | HHR                                                      |
| ------------------- | -------------------------------------------------------- |
| `ReportRecord`      | `ClinicalDocumentRecord`                                 |
| `templateId`        | `templateId`                                             |
| `title`             | `title`                                                  |
| `patientFields[]`   | `patientFields[]`                                        |
| `sections[]`        | `sections[]`                                             |
| `medico`            | `medico`                                                 |
| `especialidad`      | `especialidad`                                           |
| `reportJsonService` | `ClinicalDocumentRepository` + JSON Firestore            |
| `reportPdfService`  | `clinicalDocumentPdfService`                             |
| `ReportHostContext` | `ClinicalDocumentHostContext` implícito en modal/feature |

## Adaptaciones HHR

- La persistencia vive en `hospitals/{hospitalId}/clinicalDocuments/{documentId}`.
- El contexto clínico viene del paciente hospitalizado activo del censo.
- La vinculación longitudinal se resuelve con `episodeKey = {rut}__{admissionDate}`.
- Los permisos se controlan con roles HHR (`admin`, `doctor_urgency`, `nurse_hospital`).

## Plantilla v1 cerrada

- `Epicrisis médica`
- patient fields:
  - `nombre`
  - `rut`
  - `edad`
  - `fecnac`
  - `fing`
  - `finf`
  - `hinf`
- sections:
  - `Antecedentes`
  - `Historia y evolución clínica`
  - `Exámenes complementarios`
  - `Diagnósticos`
  - `Plan`

## Diferencias deliberadas respecto a Diario

- HHR no reutiliza el almacenamiento original de `Diario`.
- HHR no adopta el backend del repo `Diario`.
- El editor queda insertado dentro del flujo de paciente hospitalizado, no como módulo suelto.
- En v1 solo se activa `Epicrisis médica`, aunque la base ya es template-driven.
