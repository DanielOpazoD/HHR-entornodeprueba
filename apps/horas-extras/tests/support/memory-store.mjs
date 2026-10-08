// Transactional fixture. Production always uses Firestore.
export class MemoryStore {
  data = new Map();
  pending = Promise.resolve();
  async get(collection, id) {
    return structuredClone(this.data.get(`${collection}/${id}`) || null);
  }
  async list(collection) {
    return [...this.data.entries()]
      .filter(([key]) => key.startsWith(`${collection}/`))
      .map(([, value]) => structuredClone(value));
  }
  async delete(collection, id) {
    this.data.delete(`${collection}/${id}`);
  }
  transaction(work) {
    const result = this.pending.then(async () => {
      const updates = [];
      const value = await work({
        get: this.get.bind(this),
        set: (c, id, data) =>
          updates.push(() => this.data.set(`${c}/${id}`, structuredClone(data))),
        delete: (c, id) => updates.push(() => this.data.delete(`${c}/${id}`)),
      });
      updates.forEach(update => update());
      return value;
    });
    this.pending = result.catch(() => {});
    return result;
  }
}
