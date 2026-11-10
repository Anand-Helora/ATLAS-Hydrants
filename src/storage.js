/**
 * Persistance locale des contrôles, sur l'appareil uniquement.
 *
 * Aucune synchronisation distante : pas de SharePoint, pas d'API Graph ni de
 * Power Automate. Les données restent dans le navigateur qui les a saisies.
 *
 * Le dépôt (repository) travaille sur un « backend » abstrait exposant :
 *   getAll(): Promise<object[]>, put(obj): Promise<void>, delete(id): Promise<void>
 * Trois backends sont fournis : IndexedDB (privilégié), localStorage (repli)
 * et mémoire (tests, ou dernier recours sans persistance).
 */

import { STATUTS, TEST_HP_VALUES, findDuplicate, validateControl, createId } from './model.js';

export const SCHEMA_VERSION = 1;
export const DB_NAME = 'atlas-hydrants';
export const STORE_NAME = 'controles';
export const LOCAL_STORAGE_KEY = 'atlas-hydrants:controles:v1';

/** Erreur levée lorsqu'un autre contrôle porte déjà le même identifiant. */
export class DuplicateTitreError extends Error {
  constructor(existing) {
    super(`Un contrôle existe déjà pour l'identifiant « ${existing.titre} ».`);
    this.name = 'DuplicateTitreError';
    this.existing = existing;
  }
}

/** Erreur levée lorsque la saisie est invalide. */
export class ValidationError extends Error {
  constructor(errors) {
    super('Saisie invalide.');
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

/** Convertit un contrôle en objet simple, versionné, prêt à être stocké. */
export function serializeRecord(record) {
  return {
    v: SCHEMA_VERSION,
    id: String(record.id),
    titre: record.titre,
    dateControle: record.dateControle,
    statut: record.statut,
    testHp: record.testHp,
    dateDernierTestHp: record.dateDernierTestHp ?? '',
    commentaires: record.commentaires ?? '',
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/**
 * Relit un objet stocké. Renvoie `null` si l'objet est illisible ou d'une
 * version inconnue, plutôt que de faire échouer tout le chargement.
 */
export function deserializeRecord(raw) {
  if (!raw || typeof raw !== 'object' || raw.v !== SCHEMA_VERSION) return null;
  if (typeof raw.id !== 'string' || !raw.id) return null;
  if (typeof raw.titre !== 'string' || typeof raw.dateControle !== 'string') return null;
  if (!STATUTS.includes(raw.statut) || !TEST_HP_VALUES.includes(raw.testHp)) return null;
  return {
    id: raw.id,
    titre: raw.titre,
    dateControle: raw.dateControle,
    statut: raw.statut,
    testHp: raw.testHp,
    dateDernierTestHp: typeof raw.dateDernierTestHp === 'string' ? raw.dateDernierTestHp : '',
    commentaires: typeof raw.commentaires === 'string' ? raw.commentaires : '',
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
  };
}

export const SAVE_LOCK_NAME = 'atlas-hydrants:save';

/**
 * Verrou en mémoire : exécute les fonctions une par une, dans l'ordre
 * d'appel. Protège les enregistrements concurrents au sein d'un même onglet.
 */
export function createMutex() {
  let tail = Promise.resolve();
  return function withLock(fn) {
    const run = tail.then(fn, fn);
    tail = run.catch(() => {});
    return run;
  };
}

/**
 * Verrou partagé entre les onglets de la même origine (Web Locks API),
 * avec repli sur un verrou en mémoire si l'API est absente.
 */
export function createWebLock(nav, name = SAVE_LOCK_NAME) {
  const locks = nav?.locks;
  if (locks && typeof locks.request === 'function') {
    return (fn) => locks.request(name, { mode: 'exclusive' }, fn);
  }
  return createMutex();
}

/** Ordre d'affichage et d'export : ordre de création. */
function byCreation(a, b) {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Dépôt de contrôles au-dessus d'un backend abstrait.
 *
 * @param {{ getAll: Function, put: Function, delete: Function }} backend
 * @param {{ now?: () => Date, newId?: () => string }} [deps]
 */
export function createRepository(
  backend,
  { now = () => new Date(), newId = () => createId(), lock = createMutex() } = {},
) {
  async function list() {
    const raws = await backend.getAll();
    return raws.map(deserializeRecord).filter(Boolean).sort(byCreation);
  }

  async function get(id) {
    return (await list()).find((r) => r.id === id) ?? null;
  }

  /**
   * Crée (sans `id`) ou met à jour (avec `id`) un contrôle.
   * Lève ValidationError ou DuplicateTitreError.
   *
   * La vérification du doublon et l'écriture s'exécutent sous un même verrou
   * (partagé entre onglets via `createWebLock`) : deux enregistrements
   * simultanés du même identifiant ne peuvent pas passer tous les deux.
   */
  async function save(input, id) {
    const { valid, errors, value } = validateControl(input);
    if (!valid) throw new ValidationError(errors);
    return lock(() => checkAndWrite(value, id));
  }

  async function checkAndWrite(value, id) {
    const records = await list();
    const duplicate = findDuplicate(records, value.titre, id);
    if (duplicate) throw new DuplicateTitreError(duplicate);

    const timestamp = now().toISOString();
    const previous = id ? records.find((r) => r.id === id) : null;
    if (id && !previous) throw new Error("Ce contrôle n'existe plus sur cet appareil.");

    const record = {
      ...value,
      id: previous ? previous.id : newId(),
      createdAt: previous ? previous.createdAt : timestamp,
      updatedAt: timestamp,
    };
    await backend.put(serializeRecord(record));
    return record;
  }

  async function remove(id) {
    await backend.delete(id);
  }

  return { list, get, save, remove };
}

/** Backend en mémoire (tests, ou repli sans persistance). */
export function createMemoryBackend(initial = []) {
  const items = new Map(initial.map((o) => [o.id, structuredClone(o)]));
  return {
    kind: 'memory',
    async getAll() {
      return [...items.values()].map((o) => structuredClone(o));
    },
    async put(obj) {
      items.set(obj.id, structuredClone(obj));
    },
    async delete(id) {
      items.delete(id);
    },
  };
}

/** Backend localStorage : tout le jeu est stocké en JSON sous une clé. */
export function createLocalStorageBackend(storage, key = LOCAL_STORAGE_KEY) {
  function readAll() {
    const text = storage.getItem(key);
    if (!text) return [];
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  }
  function writeAll(items) {
    storage.setItem(key, JSON.stringify(items));
  }
  return {
    kind: 'localStorage',
    async getAll() {
      return readAll();
    },
    async put(obj) {
      const items = readAll().filter((o) => o.id !== obj.id);
      items.push(obj);
      writeAll(items);
    },
    async delete(id) {
      writeAll(readAll().filter((o) => o.id !== id));
    },
  };
}

function promisifyRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Ouvre (et crée au besoin) la base IndexedDB, puis renvoie le backend. */
export async function createIndexedDbBackend(idb, { dbName = DB_NAME, storeName = STORE_NAME } = {}) {
  const request = idb.open(dbName, 1);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName, { keyPath: 'id' });
  };
  const db = await promisifyRequest(request);

  function run(mode, operation) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const result = operation(tx.objectStore(storeName));
      tx.oncomplete = () => resolve(result.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('Transaction IndexedDB annulée.'));
    });
  }

  return {
    kind: 'indexedDB',
    getAll: () => run('readonly', (store) => store.getAll()),
    put: async (obj) => {
      await run('readwrite', (store) => store.put(obj));
    },
    delete: async (id) => {
      await run('readwrite', (store) => store.delete(id));
    },
  };
}

export const MIGRATION_BACKUP_KEY = 'atlas-hydrants:versions-remplacees:v1';

/**
 * Rapatrie dans `target` les contrôles restés dans le stockage de repli
 * localStorage (cas d'une ouverture précédente où IndexedDB avait échoué).
 *
 * - Même id déjà présent : rien n'est écrasé.
 * - Même identifiant d'hydrant (titre normalisé) sous un autre id : la
 *   version modifiée le plus récemment est conservée dans la liste ; l'autre
 *   n'est pas perdue, elle est sauvegardée telle quelle sous la clé
 *   MIGRATION_BACKUP_KEY de ce navigateur, et signalée dans le rapport.
 * - La sauvegarde est écrite avant toute écriture dans `target`, et la clé de
 *   repli n'est effacée qu'après succès : en cas d'échec, rien n'est perdu et
 *   la migration sera retentée au chargement suivant.
 *
 * @returns {Promise<{ migrated: number, conflicts: string[] }>}
 *          nombre de contrôles rapatriés et identifiants en conflit résolus
 */
export async function migrateLocalStorageFallback(target, storage, key = LOCAL_STORAGE_KEY) {
  const report = { migrated: 0, conflicts: [] };
  const text = storage.getItem(key);
  if (!text) return report;
  const fallback = JSON.parse(text);
  if (!Array.isArray(fallback)) return report;

  const current = (await target.getAll()).map(deserializeRecord).filter(Boolean);
  const ids = new Set(current.map((r) => r.id));
  const superseded = [];
  const puts = [];
  const deletes = [];

  for (const raw of fallback) {
    const incoming = deserializeRecord(raw);
    if (!incoming || ids.has(incoming.id)) continue;
    const clash = findDuplicate(current, incoming.titre);
    if (clash && incoming.updatedAt <= clash.updatedAt) {
      // La version déjà présente est la plus récente : on garde l'autre en sauvegarde.
      superseded.push(serializeRecord(incoming));
      report.conflicts.push(clash.titre);
      continue;
    }
    if (clash) {
      // La version du repli est la plus récente : elle remplace l'autre, sauvegardée.
      superseded.push(serializeRecord(clash));
      deletes.push(clash.id);
      current.splice(current.indexOf(clash), 1);
      report.conflicts.push(incoming.titre);
    }
    puts.push(serializeRecord(incoming));
    current.push(incoming);
    ids.add(incoming.id);
  }

  if (superseded.length) {
    const previous = JSON.parse(storage.getItem(MIGRATION_BACKUP_KEY) || '[]');
    storage.setItem(MIGRATION_BACKUP_KEY, JSON.stringify([...(Array.isArray(previous) ? previous : []), ...superseded]));
  }
  for (const obj of puts) await target.put(obj);
  for (const id of deletes) await target.delete(id);
  storage.removeItem(key);
  report.migrated = puts.length;
  return report;
}

/**
 * Choisit le meilleur stockage disponible : IndexedDB, sinon localStorage,
 * sinon mémoire (les données seront alors perdues au rafraîchissement).
 * Quand IndexedDB est disponible, les contrôles éventuellement enregistrés
 * dans le repli localStorage lors d'une session précédente y sont rapatriés.
 */
export async function openBestBackend(win, { lock = (fn) => fn() } = {}) {
  let idbBackend = null;
  try {
    if (win.indexedDB) idbBackend = await createIndexedDbBackend(win.indexedDB);
  } catch {
    // Navigation privée ou IndexedDB bloqué : on tente le repli.
  }
  if (idbBackend) {
    try {
      if (win.localStorage) {
        idbBackend.migration = await lock(() => migrateLocalStorageFallback(idbBackend, win.localStorage));
      }
    } catch {
      // Repli inaccessible ou migration interrompue : les données restent
      // dans localStorage et la migration sera retentée au prochain chargement.
    }
    return idbBackend;
  }
  try {
    const storage = win.localStorage;
    const probe = `${LOCAL_STORAGE_KEY}:probe`;
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return createLocalStorageBackend(storage);
  } catch {
    return createMemoryBackend();
  }
}
