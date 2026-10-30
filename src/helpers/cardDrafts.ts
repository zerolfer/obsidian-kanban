import type { App } from 'obsidian';

interface DraftStorage {
  load(): unknown;
  save(drafts: Record<string, string>): void;
}

export function createCardDraftStorage(app: App): DraftStorage {
  const key = 'obsidian-kanban:card-drafts:v1';
  const localApp = app as App & {
    loadLocalStorage?: (key: string) => unknown;
    saveLocalStorage?: (key: string, value: unknown) => void;
  };
  if (localApp.loadLocalStorage && localApp.saveLocalStorage) {
    return {
      load: () => localApp.loadLocalStorage(key),
      save: (drafts) => localApp.saveLocalStorage(key, Object.keys(drafts).length ? drafts : null),
    };
  }

  const vaultKey = `${key}:${app.vault.adapter.getResourcePath('')}`;
  return {
    load: () => JSON.parse(window.localStorage.getItem(vaultKey) || 'null'),
    save: (drafts) => {
      if (Object.keys(drafts).length) {
        window.localStorage.setItem(vaultKey, JSON.stringify(drafts));
      } else {
        window.localStorage.removeItem(vaultKey);
      }
    },
  };
}

export class CardDraftStore {
  private drafts: Record<string, string> = Object.create(null);
  private active = new Map<string, { owner: object; close: () => void }>();
  private reportedError = false;

  constructor(
    private storage: DraftStorage,
    private onError: () => void = () => {}
  ) {
    try {
      const saved = storage.load();
      if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
        Object.entries(saved).forEach(([path, text]) => {
          if (typeof text === 'string' && text.trim()) this.drafts[path] = text;
        });
      }
    } catch {
      this.reportError();
    }
  }

  get(path: string): string {
    return this.drafts[path] || '';
  }

  set(path: string, text: string, owner?: object): void {
    if (owner && this.active.get(path)?.owner !== owner) return;
    const value = text.trim() ? text : '';
    if (this.get(path) === value) return;
    if (value) this.drafts[path] = value;
    else delete this.drafts[path];
    this.persist();
  }

  activate(path: string, owner: object, close: () => void): void {
    const previous = this.active.get(path);
    this.release(owner);
    this.active.set(path, { owner, close });
    if (previous && previous.owner !== owner) previous.close();
  }

  release(owner: object): void {
    this.active.forEach((entry, path) => {
      if (entry.owner === owner) this.active.delete(path);
    });
  }

  rename(oldPath: string, newPath: string): void {
    let changed = false;
    Object.keys(this.drafts).forEach((path) => {
      if (path !== oldPath && !path.startsWith(`${oldPath}/`)) return;
      this.drafts[newPath + path.slice(oldPath.length)] = this.drafts[path];
      delete this.drafts[path];
      changed = true;
    });
    Array.from(this.active).forEach(([path, entry]) => {
      if (path !== oldPath && !path.startsWith(`${oldPath}/`)) return;
      this.active.delete(path);
      this.active.set(newPath + path.slice(oldPath.length), entry);
    });
    if (changed) this.persist();
  }

  remove(path: string): void {
    let changed = false;
    Object.keys(this.drafts).forEach((key) => {
      if (key !== path && !key.startsWith(`${path}/`)) return;
      delete this.drafts[key];
      changed = true;
    });
    Array.from(this.active).forEach(([key, entry]) => {
      if (key !== path && !key.startsWith(`${path}/`)) return;
      this.active.delete(key);
      entry.close();
    });
    if (changed) this.persist();
  }

  private persist(): void {
    try {
      this.storage.save({ ...this.drafts });
      this.reportedError = false;
    } catch {
      this.reportError();
    }
  }

  private reportError(): void {
    if (!this.reportedError) {
      this.reportedError = true;
      this.onError();
    }
  }
}
