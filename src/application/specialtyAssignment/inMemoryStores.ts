/**
 * Implementaciones en memoria de los puertos de asignación. Emulan la
 * semántica transaccional real (revisión monótona, conflicto por escritura
 * concurrente, deduplicación) para que los 80 escenarios del informe se
 * ejecuten sin Firestore.
 */
import type { SpecialtyAssignment } from '@/domain/specialtyAssignment/contracts';
import type { SpecialtyRuleCatalog } from '@/domain/specialtyAssignment/ruleCatalog';
import { EMPTY_RULE_CATALOG } from '@/domain/specialtyAssignment/ruleCatalog';
import type { ProfessionalCatalogItem } from '@/types/domain/professionals';
import {
  AssignmentConflictError,
  CatalogConflictError,
  type Cie10CatalogPort,
  type EpisodeAssignmentSnapshot,
  type ProfessionalCatalogPort,
  type SpecialtyAssignmentStore,
  type SpecialtyRecommendationStore,
  type SpecialtyRuleCatalogStore,
  type StoredSpecialtyRecommendation,
} from './ports';

export class InMemoryAssignmentStore implements SpecialtyAssignmentStore {
  private readonly episodes = new Map<string, EpisodeAssignmentSnapshot>();
  private queue: Promise<unknown> = Promise.resolve();

  seed(episodeKey: string, assignment: SpecialtyAssignment, containerRevision = 1): void {
    this.episodes.set(episodeKey, { episodeKey, assignment, containerRevision });
  }

  async read(episodeKey: string): Promise<EpisodeAssignmentSnapshot | null> {
    const snapshot = this.episodes.get(episodeKey);
    return snapshot ? { ...snapshot, assignment: { ...snapshot.assignment } } : null;
  }

  /**
   * Serializa las transacciones: cada `work` ve un estado consistente y una
   * escritura con `expectedContainerRevision` obsoleta aborta — la misma
   * garantía que ofrece la transacción del callable en el servidor.
   */
  runTransaction<T>(
    work: (txn: {
      read: (episodeKey: string) => Promise<EpisodeAssignmentSnapshot | null>;
      write: (
        snapshot: EpisodeAssignmentSnapshot & { expectedContainerRevision: number }
      ) => Promise<void>;
    }) => Promise<T>
  ): Promise<T> {
    const run = this.queue.then(() => {
      const pendingWrites: Array<
        EpisodeAssignmentSnapshot & { expectedContainerRevision: number }
      > = [];
      return work({
        read: episodeKey => this.read(episodeKey),
        write: async snapshot => {
          pendingWrites.push(snapshot);
        },
      }).then(result => {
        for (const write of pendingWrites) {
          const remote = this.episodes.get(write.episodeKey);
          const remoteRevision = remote?.containerRevision ?? 0;
          if (remote && remoteRevision !== write.expectedContainerRevision) {
            throw new AssignmentConflictError(
              `episode ${write.episodeKey} changed concurrently (remote ${remoteRevision}, expected ${write.expectedContainerRevision})`
            );
          }
          this.episodes.set(write.episodeKey, {
            episodeKey: write.episodeKey,
            assignment: write.assignment,
            containerRevision: remoteRevision + 1,
          });
        }
        return result;
      });
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}

export class InMemoryRuleCatalogStore implements SpecialtyRuleCatalogStore {
  private catalog: SpecialtyRuleCatalog = EMPTY_RULE_CATALOG;

  seed(catalog: SpecialtyRuleCatalog): void {
    this.catalog = catalog;
  }

  async read(): Promise<SpecialtyRuleCatalog | null> {
    return this.catalog;
  }

  async publish(
    expectedRevision: number,
    build: (current: SpecialtyRuleCatalog) => SpecialtyRuleCatalog,
    actorUid: string
  ): Promise<SpecialtyRuleCatalog> {
    if (this.catalog.revision !== expectedRevision) {
      throw new CatalogConflictError(
        `catalog revision mismatch (remote ${this.catalog.revision}, expected ${expectedRevision})`
      );
    }
    const next = build(this.catalog);
    if (next.revision !== expectedRevision + 1) {
      throw new CatalogConflictError('catalog publish must advance revision by exactly one');
    }
    this.catalog = { ...next, updatedByUid: actorUid };
    return this.catalog;
  }
}

export class InMemoryRecommendationStore implements SpecialtyRecommendationStore {
  private readonly records = new Map<string, StoredSpecialtyRecommendation>();

  async get(recommendationId: string): Promise<StoredSpecialtyRecommendation | null> {
    const record = this.records.get(recommendationId);
    return record ? { ...record } : null;
  }

  async createIfAbsent(
    recommendation: StoredSpecialtyRecommendation
  ): Promise<'created' | 'exists'> {
    if (this.records.has(recommendation.recommendationId)) return 'exists';
    this.records.set(recommendation.recommendationId, { ...recommendation });
    return 'created';
  }

  async transition(
    recommendationId: string,
    from: Array<StoredSpecialtyRecommendation['status']>,
    to: StoredSpecialtyRecommendation['status'],
    actorUid: string,
    at: string
  ): Promise<StoredSpecialtyRecommendation> {
    const record = this.records.get(recommendationId);
    if (!record) throw new AssignmentConflictError('recommendation not found');
    if (!from.includes(record.status)) {
      throw new AssignmentConflictError(
        `recommendation ${recommendationId} is ${record.status}, expected ${from.join('|')}`
      );
    }
    const next: StoredSpecialtyRecommendation = {
      ...record,
      status: to,
      resolvedAt: at,
      resolvedByUid: actorUid,
    };
    this.records.set(recommendationId, next);
    return { ...next };
  }
}

export class InMemoryProfessionalCatalog implements ProfessionalCatalogPort {
  constructor(
    private readonly items: ProfessionalCatalogItem[],
    private readonly catalogVersion = 'test-catalog-v1'
  ) {}

  async list(): Promise<ProfessionalCatalogItem[]> {
    return this.items.map(item => ({ ...item }));
  }

  async version(): Promise<string> {
    return this.catalogVersion;
  }
}

export class InMemoryCie10Catalog implements Cie10CatalogPort {
  constructor(
    private readonly knownCodes: ReadonlySet<string>,
    private readonly catalogVersion = 'cie10-test-v1'
  ) {}

  async isKnownCode(normalizedCode: string): Promise<boolean> {
    return this.knownCodes.has(normalizedCode);
  }

  async version(): Promise<string> {
    return this.catalogVersion;
  }
}
