import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  STATUTS,
  TEST_HP_VALUES,
  createId,
  emptyControl,
  findDuplicate,
  isValidIsoDate,
  normalizeTitre,
  titreKey,
  todayIso,
  validateControl,
} from '../src/model.js';

const VALID = {
  titre: '  SITE-FICTIF/A/00/001/HYD01  ',
  dateControle: '2026-11-04',
  statut: 'HSH',
  testHp: 'Nok',
  dateDernierTestHp: '',
  commentaires: 'Observation fictive',
};

test('valeurs observées uniquement, sans état inventé', () => {
  assert.deepEqual([...STATUTS], ['OK', 'HSH']);
  assert.deepEqual([...TEST_HP_VALUES], ['OK', 'Nok', '']);
});

test('saisie valide : normalisée', () => {
  const { valid, errors, value } = validateControl(VALID);
  assert.equal(valid, true);
  assert.deepEqual(errors, {});
  assert.equal(value.titre, 'SITE-FICTIF/A/00/001/HYD01');
  assert.equal(value.dateDernierTestHp, '');
});

test('identifiant obligatoire', () => {
  for (const titre of ['', '   ', undefined, null]) {
    const { valid, errors } = validateControl({ ...VALID, titre });
    assert.equal(valid, false);
    assert.match(errors.titre, /obligatoire/);
  }
});

test('identifiant sans retour à la ligne ni tabulation', () => {
  assert.ok(validateControl({ ...VALID, titre: 'A\nB' }).errors.titre);
  assert.ok(validateControl({ ...VALID, titre: 'A\tB' }).errors.titre);
});

test('identifiant trop long refusé', () => {
  assert.ok(validateControl({ ...VALID, titre: 'X'.repeat(121) }).errors.titre);
  assert.equal(validateControl({ ...VALID, titre: 'X'.repeat(120) }).valid, true);
});

test('date du contrôle obligatoire et valide', () => {
  assert.match(validateControl({ ...VALID, dateControle: '' }).errors.dateControle, /obligatoire/);
  for (const d of ['2026-02-30', '2026-13-01', '04-11-26', '1999-12-31', '2100-01-01', 'abc']) {
    assert.ok(validateControl({ ...VALID, dateControle: d }).errors.dateControle, d);
  }
});

test('statut : OK ou HSH uniquement', () => {
  assert.equal(validateControl({ ...VALID, statut: 'OK' }).valid, true);
  for (const statut of [null, '', 'ok', 'KO', 'Nok']) {
    assert.ok(validateControl({ ...VALID, statut }).errors.statut, String(statut));
  }
});

test('Test HP : OK, Nok ou vide explicitement choisi', () => {
  for (const testHp of ['OK', 'Nok', '']) assert.equal(validateControl({ ...VALID, testHp }).valid, true, testHp);
  // null = aucun choix fait : refusé, pour distinguer « vide » volontaire et oubli.
  for (const testHp of [null, undefined, 'NOK', 'ok', 'HSH']) {
    assert.ok(validateControl({ ...VALID, testHp }).errors.testHp, String(testHp));
  }
});

test('date du dernier Test HP facultative mais valide si renseignée', () => {
  assert.equal(validateControl({ ...VALID, dateDernierTestHp: '' }).valid, true);
  assert.equal(validateControl({ ...VALID, dateDernierTestHp: '2026-11-04' }).valid, true);
  assert.ok(validateControl({ ...VALID, dateDernierTestHp: '2026-02-29' }).errors.dateDernierTestHp);
});

test('commentaire facultatif, longueur bornée', () => {
  assert.equal(validateControl({ ...VALID, commentaires: '' }).valid, true);
  assert.ok(validateControl({ ...VALID, commentaires: 'x'.repeat(2001) }).errors.commentaires);
});

test('plusieurs erreurs signalées en même temps', () => {
  const { errors } = validateControl({});
  assert.deepEqual(Object.keys(errors).sort(), ['dateControle', 'statut', 'testHp', 'titre']);
});

test('dates : années bissextiles', () => {
  assert.equal(isValidIsoDate('2028-02-29'), true);
  assert.equal(isValidIsoDate('2026-02-29'), false);
  assert.equal(isValidIsoDate('2000-02-29'), true);
});

test('date du jour en heure locale', () => {
  assert.equal(todayIso(new Date(2026, 10, 4, 0, 5)), '2026-11-04');
  assert.equal(todayIso(new Date(2026, 10, 4, 23, 55)), '2026-11-04');
});

test('formulaire vide : aucun statut ni Test HP présélectionné', () => {
  const empty = emptyControl(new Date(2026, 10, 4));
  assert.equal(empty.dateControle, '2026-11-04');
  assert.equal(empty.statut, null);
  assert.equal(empty.testHp, null);
});

test('doublons : insensible à la casse et aux espaces', () => {
  const records = [{ id: 'a', titre: 'SITE-FICTIF/A/00/001/HYD01' }];
  assert.equal(normalizeTitre('  x '), 'x');
  assert.equal(titreKey(' site-fictif/a '), 'SITE-FICTIF/A');
  assert.equal(findDuplicate(records, ' site-fictif/a/00/001/hyd01 ')?.id, 'a');
  assert.equal(findDuplicate(records, 'SITE-FICTIF/A/00/002/HYD02'), null);
  assert.equal(findDuplicate(records, ''), null);
});

test("doublons : le contrôle en cours d'édition n'est pas son propre doublon", () => {
  const records = [{ id: 'a', titre: 'SITE-FICTIF/A/00/001/HYD01' }];
  assert.equal(findDuplicate(records, 'SITE-FICTIF/A/00/001/HYD01', 'a'), null);
});

test('identifiants internes uniques', () => {
  assert.notEqual(createId(), createId());
  const fallback = createId(null);
  assert.match(fallback, /^id-/);
});
