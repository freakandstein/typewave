// Event bus lokal: semua sumber input menulis ke sini; metrics dan render membaca dari sini.
export function createBus() {
  const handlers = new Map();
  return {
    on(type, fn) {
      let set = handlers.get(type);
      if (!set) handlers.set(type, (set = new Set()));
      set.add(fn);
      return () => set.delete(fn);
    },
    emit(type, payload) {
      const set = handlers.get(type);
      if (!set) return;
      for (const fn of [...set]) {
        try { fn(payload); } catch (err) { console.error('[bus]', type, err); }
      }
    },
  };
}
