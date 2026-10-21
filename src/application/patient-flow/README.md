# `src/application/patient-flow`

Reglas compartidas para admisión y episodio clínico.

- `admissionDate` solo debe considerarse editable en el primer día observado del episodio.
- Al validar un guardado, la fecha se compara con el mismo episodio previo, no con el anterior ocupante de la cama destino. Se reutiliza `hasSamePatientEpisodeIdentity`; un cambio de cama o un reingreso no hereda la fecha de otro episodio. Una modificación real del ingreso del mismo episodio conserva su restricción.
- La fecha canónica del episodio se ancla al día del censo donde el paciente aparece por primera vez; el valor escrito en la ficha no debe desplazar ese ancla.
- `resolveAdmissionDateAudit` valida si la fecha cae fuera de la ventana esperada y sugiere la corrección clínica.
- Un alta o traslado cierra el episodio; si el mismo RUT reaparece después, se abre un episodio nuevo.
- Los documentos clínicos usan `firstSeenDate` como ancla del episodio cuando ya existe; no deben reconstruir una fecha distinta desde `admissionDate` congelado.
- La estadística y el backfill deben consumir esta regla compartida, no inventar una segunda interpretación a partir de `originalData`.
- Si falta `firstSeenDate`, el sistema cae al criterio operativo de admisión nueva del día actual.
