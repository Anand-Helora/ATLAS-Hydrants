import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DuplicateTitreError,
  LOCAL_STORAGE_KEY,
  SCHEMA_VERSION,
  ValidationError,
  createLocalStorageBackend,
  createMemoryBackend,
  createMutex,
  createWebLock,
  createRepository,
  deserializeRecord,
  migrateLocalStorageFallback,
  MIGRATION_BACKUP_KEY,
  openBestBackend,
  serializeRecord,
} from '../src/storage.js';

const FICTIF = {
  titre: 'SITE-FICTIF/A/00/001/HYD01',
  dateControle: '2026-11-04',
  statut: 'HSH',
  testHp: 'Nok',
  dateDernierTestHp: '',
  commentaires: 'Observation fictive',
};

function deps() {
  let tick = 0;
  let n = 0;
  return {
    now: () => new Date(Date.UTC(2026, 10, 4, 8, 0, tick++)),
    newId: () => `id-${++n}`,
  };
}

/** Faux localStorage (API Storage minimale). */
function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    map,
  };
}

test('sérialisation : aller-retour sans perte', () => {
  const record = { ...FICTIF, id: 'x', createdAt: '2026-11-04T08:00:00.000Z', updatedAt: '2026-11-04T08:00:00.000Z' };
  const raw = serializeRecord(record);
  assert.equal(raw.v, SCHEMA_VERSION);
  const back = deserializeRecord(JSON.parse(JSON.stringify(raw)));
  assert.deepEqual(back, record);
});

test('sérialisation : Test HP vide conservé tel quel', () => {
  const record = { ...FICTIF, testHp: '', id: 'x', createdAt: 'a', updatedAt: 'a' };
  assert.equal(deserializeRecord(serializeRecord(record)).testHp, '');
});

test('désérialisation : objets corrompus ou inconnus ignorés', () => {
  assert.equal(deserializeRecord(null), null);
  assert.equal(deserializeRecord('texte'), null);
  assert.equal(deserializeRecord({ ...FICTIF, id: 'x' }), null); // pas de version
  assert.equal(deserializeRecord({ ...FICTIF, id: 'x', v: 99 }), null);
  assert.equal(deserializeRecord({ ...FICTIF, id: 'x', v: 1, statut: 'INVENTE' }), null);
  assert.equal(deserializeRecord({ ...FICTIF, id: '', v: 1 }), null);
});

test('enregistrement puis relecture', async () => {
  const repo = createRepository(createMemoryBackend(), deps());
  const saved = await repo.save(FICTIF);
  assert.equal(saved.id, 'id-1');
  assert.equal(saved.createdAt, '2026-11-04T08:00:00.000Z');
  const list = await repo.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].titre, FICTIF.titre);
  assert.deepEqual(await repo.get('id-1'), saved);
});

test('saisie invalide refusée sans écriture', async () => {
  const backend = createMemoryBackend();
  const repo = createRepository(backend, deps());
  await assert.rejects(repo.save({ ...FICTIF, statut: null }), (e) => e instanceof ValidationError && 'statut' in e.errors);
  assert.equal((await backend.getAll()).length, 0);
});

test('doublon refusé à la création', async () => {
  const repo = createRepository(createMemoryBackend(), deps());
  await repo.save(FICTIF);
  await assert.rejects(
    repo.save({ ...FICTIF, titre: ' site-fictif/a/00/001/hyd01 ', statut: 'OK' }),
    (e) => e instanceof DuplicateTitreError && e.existing.id === 'id-1',
  );
  assert.equal((await repo.list()).length, 1);
});

test('doublon refusé en renommant un autre contrôle', async () => {
  const repo = createRepository(createMemoryBackend(), deps());
  await repo.save(FICTIF);
  const second = await repo.save({ ...FICTIF, titre: 'SITE-FICTIF/A/00/002/HYD02' });
  await assert.rejects(repo.save({ ...FICTIF }, second.id), DuplicateTitreError);
});

test('modification : même id, createdAt conservé, updatedAt changé', async () => {
  const repo = createRepository(createMemoryBackend(), deps());
  const first = await repo.save(FICTIF);
  const updated = await repo.save({ ...FICTIF, statut: 'OK', commentaires: 'Modifié (fictif)' }, first.id);
  assert.equal(updated.id, first.id);
  assert.equal(updated.createdAt, first.createdAt);
  assert.notEqual(updated.updatedAt, first.updatedAt);
  const list = await repo.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].statut, 'OK');
  assert.equal(list[0].commentaires, 'Modifié (fictif)');
});

test("modification d'un contrôle supprimé entre-temps : erreur", async () => {
  const repo = createRepository(createMemoryBackend(), deps());
  const first = await repo.save(FICTIF);
  await repo.remove(first.id);
  await assert.rejects(repo.save(FICTIF, first.id), /n'existe plus/);
});

test('suppression', async () => {
  const repo = createRepository(createMemoryBackend(), deps());
  const a = await repo.save(FICTIF);
  await repo.save({ ...FICTIF, titre: 'SITE-FICTIF/A/00/002/HYD02' });
  await repo.remove(a.id);
  const list = await repo.list();
  assert.deepEqual(list.map((r) => r.titre), ['SITE-FICTIF/A/00/002/HYD02']);
});

test('liste triée par ordre de création', async () => {
  const repo = createRepository(createMemoryBackend(), deps());
  await repo.save({ ...FICTIF, titre: 'SITE-FICTIF/B' });
  await repo.save({ ...FICTIF, titre: 'SITE-FICTIF/A' });
  assert.deepEqual((await repo.list()).map((r) => r.titre), ['SITE-FICTIF/B', 'SITE-FICTIF/A']);
});

test('persistance : un nouveau dépôt sur le même stockage retrouve les contrôles (simulation de rafraîchissement)', async () => {
  const storage = fakeStorage();
  const repo1 = createRepository(createLocalStorageBackend(storage), deps());
  const saved = await repo1.save(FICTIF);

  const repo2 = createRepository(createLocalStorageBackend(storage), deps());
  const list = await repo2.list();
  assert.equal(list.length, 1);
  assert.deepEqual(list[0], saved);
  assert.ok(storage.map.has(LOCAL_STORAGE_KEY));
});

test('persistance : entrée corrompue ignorée, les autres restent lisibles', async () => {
  const storage = fakeStorage();
  const repo = createRepository(createLocalStorageBackend(storage), deps());
  await repo.save(FICTIF);
  const items = JSON.parse(storage.getItem(LOCAL_STORAGE_KEY));
  items.push({ v: 1, id: 'bad' });
  storage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(items));
  assert.equal((await repo.list()).length, 1);
});

test('erreur du stockage propagée (pas de faux succès)', async () => {
  const backend = {
    getAll: async () => [],
    put: async () => {
      throw new Error('QuotaExceededError (simulée)');
    },
    delete: async () => {},
  };
  const repo = createRepository(backend, deps());
  await assert.rejects(repo.save(FICTIF), /Quota/);
});

test('choix du stockage : repli localStorage puis mémoire', async () => {
  const storage = fakeStorage();
  const brokenIdb = {
    open() {
      throw new Error('IndexedDB bloqué');
    },
  };
  assert.equal((await openBestBackend({ indexedDB: brokenIdb, localStorage: storage })).kind, 'localStorage');
  assert.equal((await openBestBackend({})).kind, 'memory');
  const throwingStorage = {
    setItem() {
      throw new Error('SecurityError');
    },
  };
  assert.equal((await openBestBackend({ localStorage: throwingStorage })).kind, 'memory');
});

test('repli localStorage rapatrié dans le stockage principal (IndexedDB revenu)', async () => {
  const storage = fakeStorage();
  // Session 1 : IndexedDB indisponible, enregistrement dans le repli.
  const fallbackRepo = createRepository(createLocalStorageBackend(storage), deps());
  const a = await fallbackRepo.save(FICTIF);
  const b = await fallbackRepo.save({ ...FICTIF, titre: 'SITE-FICTIF/A/00/002/HYD02' });

  // Session 2 : IndexedDB fonctionne (simulé par un backend mémoire) et contient déjà `a`.
  const primary = createMemoryBackend([serializeRecord({ ...a, commentaires: 'version principale' })]);
  assert.deepEqual(await migrateLocalStorageFallback(primary, storage), { migrated: 1, conflicts: [] });
  const list = await createRepository(primary, deps()).list();
  assert.deepEqual(list.map((r) => r.id).sort(), [a.id, b.id].sort());
  assert.equal(list.find((r) => r.id === a.id).commentaires, 'version principale', 'pas d’écrasement');
  assert.equal(storage.getItem(LOCAL_STORAGE_KEY), null, 'repli vidé après succès');
  assert.deepEqual(await migrateLocalStorageFallback(primary, storage), { migrated: 0, conflicts: [] });
});

test('migration interrompue : le repli est conservé pour une nouvelle tentative', async () => {
  const storage = fakeStorage();
  await createRepository(createLocalStorageBackend(storage), deps()).save(FICTIF);
  const failing = {
    getAll: async () => [],
    put: async () => {
      throw new Error('écriture impossible (simulée)');
    },
    delete: async () => {},
  };
  await assert.rejects(migrateLocalStorageFallback(failing, storage), /simulée/);
  assert.ok(storage.getItem(LOCAL_STORAGE_KEY), 'données de repli toujours présentes');
});

test('enregistrements simultanés du même identifiant : un seul passe (verrou partagé)', async () => {
  const backend = createMemoryBackend();
  const lock = createMutex();
  // Deux dépôts (comme deux onglets) sur le même stockage et le même verrou.
  const repo1 = createRepository(backend, { ...deps(), lock });
  const repo2 = createRepository(backend, { ...deps(), lock, newId: () => 'autre-id' });
  const results = await Promise.allSettled([repo1.save(FICTIF), repo2.save({ ...FICTIF, titre: ' site-fictif/a/00/001/hyd01 ' })]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.ok(results.find((r) => r.status === 'rejected').reason instanceof DuplicateTitreError);
  assert.equal((await backend.getAll()).length, 1);
});

test('verrou par défaut : appels concurrents sur un même dépôt sérialisés', async () => {
  const repo = createRepository(createMemoryBackend(), deps());
  const results = await Promise.allSettled([repo.save(FICTIF), repo.save(FICTIF)]);
  assert.deepEqual(results.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
});

test('le verrou se libère après une erreur', async () => {
  const lock = createMutex();
  await assert.rejects(lock(async () => {
    throw new Error('échec');
  }));
  assert.equal(await lock(async () => 'ok'), 'ok');
});

test('verrou Web Locks utilisé quand navigator.locks existe', async () => {
  const calls = [];
  const nav = { locks: { request: (name, opts, fn) => (calls.push([name, opts.mode]), fn()) } };
  assert.equal(await createWebLock(nav)(async () => 42), 42);
  assert.deepEqual(calls, [['atlas-hydrants:save', 'exclusive']]);
  assert.equal(await createWebLock({})(async () => 'repli'), 'repli');
});

function rec(id, titre, updatedAt, commentaires) {
  return serializeRecord({ ...FICTIF, id, titre, commentaires, createdAt: updatedAt, updatedAt });
}

test('migration : même hydrant sous un autre id, la version la plus récente gagne, l’autre est sauvegardée', async () => {
  const storage = fakeStorage();
  const older = rec('idb-1', 'SITE-FICTIF/A/00/001/HYD01', '2026-11-04T08:00:00.000Z', 'ancienne (IndexedDB)');
  const newer = rec('ls-1', ' site-fictif/a/00/001/hyd01 ', '2026-11-04T09:00:00.000Z', 'récente (repli)');
  storage.setItem(LOCAL_STORAGE_KEY, JSON.stringify([newer]));
  const primary = createMemoryBackend([older]);

  const report = await migrateLocalStorageFallback(primary, storage);
  assert.equal(report.migrated, 1);
  assert.equal(report.conflicts.length, 1);
  const list = await createRepository(primary, deps()).list();
  assert.equal(list.length, 1, 'aucun doublon dans la liste');
  assert.equal(list[0].commentaires, 'récente (repli)');
  assert.deepEqual(JSON.parse(storage.getItem(MIGRATION_BACKUP_KEY)).map((o) => o.commentaires), ['ancienne (IndexedDB)']);
  assert.equal(storage.getItem(LOCAL_STORAGE_KEY), null);
});

test('migration : version du repli plus ancienne, conservée en sauvegarde seulement', async () => {
  const storage = fakeStorage();
  const newer = rec('idb-1', 'SITE-FICTIF/A/00/001/HYD01', '2026-11-04T09:00:00.000Z', 'récente (IndexedDB)');
  const older = rec('ls-1', 'SITE-FICTIF/A/00/001/HYD01', '2026-11-04T08:00:00.000Z', 'ancienne (repli)');
  const other = rec('ls-2', 'SITE-FICTIF/A/00/002/HYD02', '2026-11-04T08:30:00.000Z', 'sans conflit');
  storage.setItem(LOCAL_STORAGE_KEY, JSON.stringify([older, other]));
  const primary = createMemoryBackend([newer]);

  const report = await migrateLocalStorageFallback(primary, storage);
  assert.deepEqual(report, { migrated: 1, conflicts: ['SITE-FICTIF/A/00/001/HYD01'] });
  const list = await createRepository(primary, deps()).list();
  assert.deepEqual(list.map((r) => r.commentaires).sort(), ['récente (IndexedDB)', 'sans conflit']);
  assert.deepEqual(JSON.parse(storage.getItem(MIGRATION_BACKUP_KEY)).map((o) => o.id), ['ls-1']);
  // Après migration, le contrôle conservé reste modifiable (pas de doublon bloquant).
  const repo = createRepository(primary, deps());
  await repo.save({ ...FICTIF, statut: 'OK' }, 'idb-1');
});

/** Backend mémoire dont une opération échoue une fois (interruption simulée). */
function failingOnce(backend, op) {
  let failed = false;
  return {
    ...backend,
    [op]: async (arg) => {
      if (!failed) {
        failed = true;
        throw new Error(`interruption simulée (${op})`);
      }
      return backend[op](arg);
    },
  };
}

for (const op of ['delete', 'put']) {
  test(`migration interrompue (échec de ${op}) puis reprise : aucun doublon, aucune perte`, async () => {
    const storage = fakeStorage();
    const older = rec('idb-1', 'SITE-FICTIF/A/00/001/HYD01', '2026-11-04T08:00:00.000Z', 'ancienne (IndexedDB)');
    const newer = rec('ls-1', 'SITE-FICTIF/A/00/001/HYD01', '2026-11-04T09:00:00.000Z', 'récente (repli)');
    const other = rec('ls-2', 'SITE-FICTIF/A/00/002/HYD02', '2026-11-04T08:30:00.000Z', 'sans conflit');
    storage.setItem(LOCAL_STORAGE_KEY, JSON.stringify([newer, other]));
    const base = createMemoryBackend([older]);

    await assert.rejects(migrateLocalStorageFallback(failingOnce(base, op), storage), /interruption/);
    assert.ok(storage.getItem(LOCAL_STORAGE_KEY), 'repli conservé après interruption');

    await migrateLocalStorageFallback(base, storage); // chargement suivant
    const list = await createRepository(base, deps()).list();
    assert.deepEqual(list.map((r) => r.commentaires).sort(), ['récente (repli)', 'sans conflit']);
    const backup = JSON.parse(storage.getItem(MIGRATION_BACKUP_KEY));
    assert.deepEqual(backup.map((o) => o.id), ['idb-1'], 'sauvegarde unique, non dupliquée');
    assert.equal(storage.getItem(LOCAL_STORAGE_KEY), null);
    await createRepository(base, deps()).save({ ...FICTIF, statut: 'OK' }, 'ls-1'); // reste modifiable
  });
}
