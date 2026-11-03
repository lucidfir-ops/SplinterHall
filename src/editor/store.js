// Saved custom levels, kept in the browser.
const KEY = 'splinterhall.levels';
export const levelStore = {
  list() { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } },
  save(list) { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage off */ } },
  put(entry) {
    const list = this.list();
    const k = list.findIndex((l) => l.name === entry.name);
    if (k >= 0) list[k] = entry; else list.unshift(entry);
    this.save(list);
  },
  remove(name) { this.save(this.list().filter((l) => l.name !== name)); },
};
