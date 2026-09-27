# Census document-presence cache

The census polls document presence every 45 seconds (30-second stale time).
It still uses the existing validated document-list use case and the same episode
queries. After a successful read, `projectClinicalDocumentPresence` retains only
`status`, `episodeKey` and `patientRut` in the census query cache. These fields
preserve draft/active counts, legacy episode matching and patient identity checks.

Full document content and version history do not belong in this badge cache.
Projection happens in `queryFn`, before TanStack Query's structural sharing, rather
than `select`, which would leave full documents in the underlying cache. A failed
refresh still rejects and preserves the last confirmed indicators. The document
editor and repository continue to receive complete, validated records.

## Bounded synthetic measurement — 2026-09-27

Node 22.22.2, local macOS; 18 episodes × 3 documents, six sections per document
(40 repetitions of a short synthetic sentence), and three versions with six
section snapshots each. No patient data or remote database was used.

| Measurement               |    Full records | Presence projection |
| ------------------------- | --------------: | ------------------: |
| Serialized cache payload  | 1,622,397 bytes |         3,919 bytes |
| Structural-sharing median |         3.68 ms |            0.040 ms |
| Structural-sharing p95    |         6.86 ms |            0.152 ms |

Timing used `replaceEqualDeep` from the installed `@tanstack/query-core`, comparing
independently parsed but equivalent responses: 30 samples of 100 comparisons.
The projected path includes the cost of mapping each response. Serialized bytes
are a retained-payload proxy, **not a heap-memory measurement**. Timing was collected
on a busy developer machine and is directional evidence, not an end-user latency
claim or a new performance gate.

Network requests, downloaded Firestore document bytes, validation work and billed
reads are unchanged. Reducing those would need a separately measured server-side
summary/read model, with explicit freshness and consistency guarantees; it is not
part of this change.

The hook regression test verifies that content-only edits neither retain document
bodies/history nor change badge references. Existing tests cover identity, legacy
episode keys, archived documents and failed-refresh recovery.
