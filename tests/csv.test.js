import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  CSV_EOL,
  CSV_HEADERS,
  UTF8_BOM,
  buildCsv,
  escapeCsvField,
  exportFileName,
  formatDateCsv,
  neutralizeFormula,
  recordToRow,
} from '../src/csv.js';

// Données intégralement fictives (issue #1).
const FICTIF_1 = {
  titre: 'SITE-FICTIF/A/00/001/HYD01',
  dateControle: '2026-11-04',
  statut: 'HSH',
  testHp: 'Nok',
  dateDernierTestHp: '',
  commentaires: 'Observation fictive',
};
const FICTIF_2 = {
  titre: 'SITE-FICTIF/A/00/002/HYD02',
  dateControle: '2026-11-04',
  statut: 'OK',
  testHp: 'OK',
  dateDernierTestHp: '2026-11-04',
  commentaires: '',
};

const HEADER_LINE = 'Titre;Date du contrôle;Statut;Test HP;Date du dernier Test HP;Commentaires';

test('les 6 entêtes historiques, exactement et dans cet ordre', () => {
  assert.deepEqual(CSV_HEADERS, [
    'Titre',
    'Date du contrôle',
    'Statut',
    'Test HP',
    'Date du dernier Test HP',
    'Commentaires',
  ]);
  const csv = buildCsv([], { bom: false });
  assert.equal(csv, HEADER_LINE + CSV_EOL);
});

test("l'entête est en Unicode NFC (« ô » précomposé)", () => {
  assert.equal(CSV_HEADERS[1], CSV_HEADERS[1].normalize('NFC'));
  assert.ok(Buffer.from(HEADER_LINE, 'utf8').includes(Buffer.from([0xc3, 0xb4])));
});

test("reproduit à l'identique l'exemple fictif de l'ancien export", async () => {
  const fixture = await readFile(new URL('./fixtures/export-historique-fictif.csv', import.meta.url), 'utf8');
  const expectedLines = fixture.trimEnd().split('\n');
  const csv = buildCsv([FICTIF_1, FICTIF_2], { bom: false });
  assert.deepEqual(csv.trimEnd().split(CSV_EOL), expectedLines);
  assert.equal(expectedLines[1], 'SITE-FICTIF/A/00/001/HYD01;04-11-26;HSH;Nok;;Observation fictive');
  assert.equal(expectedLines[2], 'SITE-FICTIF/A/00/002/HYD02;04-11-26;OK;OK;04-11-26;');
});

test('chaque ligne a exactement 6 colonnes', () => {
  const rows = [FICTIF_1, FICTIF_2].map(recordToRow);
  for (const row of rows) assert.equal(row.length, 6);
  const csv = buildCsv([FICTIF_1, FICTIF_2], { bom: false });
  for (const line of csv.trimEnd().split(CSV_EOL)) assert.equal(line.split(';').length, 6);
});

test('BOM UTF-8 présent par défaut, absent sur demande', () => {
  const withBom = buildCsv([FICTIF_1]);
  assert.ok(withBom.startsWith(UTF8_BOM));
  assert.deepEqual([...Buffer.from(withBom, 'utf8').subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.equal(withBom.indexOf(UTF8_BOM, 1), -1, 'un seul BOM');
  const withoutBom = buildCsv([FICTIF_1], { bom: false });
  assert.ok(withoutBom.startsWith('Titre;'));
});

test('fins de ligne CRLF, y compris après la dernière ligne', () => {
  const csv = buildCsv([FICTIF_1, FICTIF_2], { bom: false });
  assert.ok(csv.endsWith('\r\n'));
  assert.equal(csv.split('\r\n').length, 4); // 3 lignes + chaîne vide finale
  assert.equal(csv.replaceAll('\r\n', '').includes('\n'), false);
});

test('dates au format JJ-MM-AA', () => {
  assert.equal(formatDateCsv('2026-11-04'), '04-11-26');
  assert.equal(formatDateCsv('2000-01-01'), '01-01-00');
  assert.equal(formatDateCsv('2099-12-31'), '31-12-99');
  assert.equal(formatDateCsv('2028-02-29'), '29-02-28');
});

test('date vide ou invalide : cellule vide', () => {
  assert.equal(formatDateCsv(''), '');
  assert.equal(formatDateCsv(undefined), '');
  assert.equal(formatDateCsv('2026-02-30'), '');
  assert.equal(formatDateCsv('04-11-26'), '');
});

test('aucun décalage de jour lié au fuseau horaire', () => {
  const previous = process.env.TZ;
  try {
    for (const tz of ['Pacific/Kiritimati', 'Pacific/Pago_Pago', 'Europe/Paris', 'UTC']) {
      process.env.TZ = tz;
      assert.equal(formatDateCsv('2026-01-01'), '01-01-26', tz);
      assert.equal(formatDateCsv('2026-12-31'), '31-12-26', tz);
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test('date du dernier Test HP absente : colonne vide conservée', () => {
  const row = recordToRow({ ...FICTIF_2, dateDernierTestHp: '' });
  assert.equal(row[4], '');
  const line = buildCsv([{ ...FICTIF_2, dateDernierTestHp: '' }], { bom: false }).split(CSV_EOL)[1];
  assert.equal(line, 'SITE-FICTIF/A/00/002/HYD02;04-11-26;OK;OK;;');
});

test('Test HP vide et commentaires vides : cellules vides', () => {
  const line = buildCsv([{ ...FICTIF_2, testHp: '', dateDernierTestHp: '' }], { bom: false }).split(CSV_EOL)[1];
  assert.equal(line, 'SITE-FICTIF/A/00/002/HYD02;04-11-26;OK;;;');
});

test('échappement : point-virgule, guillemets, retours à la ligne', () => {
  assert.equal(escapeCsvField('a;b'), '"a;b"');
  assert.equal(escapeCsvField('dit "fictif"'), '"dit ""fictif"""');
  assert.equal(escapeCsvField('ligne 1\nligne 2'), '"ligne 1\nligne 2"');
  assert.equal(escapeCsvField('ligne 1\r\nligne 2'), '"ligne 1\r\nligne 2"');
  assert.equal(escapeCsvField(' espace '), '" espace "');
  assert.equal(escapeCsvField('simple'), 'simple');
  assert.equal(escapeCsvField(''), '');
});

test('accents conservés sans échappement inutile', () => {
  const line = buildCsv([{ ...FICTIF_1, commentaires: 'Vérifié, à revoir : œuvre élevée — ça' }], { bom: false }).split(CSV_EOL)[1];
  assert.equal(line, 'SITE-FICTIF/A/00/001/HYD01;04-11-26;HSH;Nok;;Vérifié, à revoir : œuvre élevée — ça');
});

test('commentaire complexe : une seule cellule après échappement', () => {
  const commentaires = 'Note "fictive"; suite\nautre ligne';
  const csv = buildCsv([{ ...FICTIF_1, commentaires }], { bom: false });
  assert.ok(csv.includes(';"Note ""fictive""; suite\nautre ligne"\r\n'));
});

test('neutralisation des formules (injection CSV)', () => {
  assert.equal(neutralizeFormula('=1+1'), "'=1+1");
  assert.equal(neutralizeFormula('+33 fictif'), "'+33 fictif");
  assert.equal(neutralizeFormula('-2'), "'-2");
  assert.equal(neutralizeFormula('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(neutralizeFormula('\t=1'), "'\t=1");
  assert.equal(neutralizeFormula('\r=1'), "'\r=1");
  assert.equal(neutralizeFormula('Observation fictive'), 'Observation fictive');
  assert.equal(neutralizeFormula('a=b'), 'a=b');
  assert.equal(neutralizeFormula(''), '');
});

test('formule dans Titre et Commentaires neutralisée à l’export, puis échappée', () => {
  const record = { ...FICTIF_1, titre: '=HYPERLINK("http://exemple.invalid")', commentaires: '@cmd;x' };
  const row = recordToRow(record);
  assert.equal(row[0], '\'=HYPERLINK("http://exemple.invalid")');
  assert.equal(row[5], "'@cmd;x");
  const line = buildCsv([record], { bom: false }).split(CSV_EOL)[1];
  assert.equal(line, '"\'=HYPERLINK(""http://exemple.invalid"")";04-11-26;HSH;Nok;;"\'@cmd;x"');
});

test('les champs contrôlés (statut, Test HP, dates) ne sont pas modifiés', () => {
  const row = recordToRow(FICTIF_1);
  assert.deepEqual(row, ['SITE-FICTIF/A/00/001/HYD01', '04-11-26', 'HSH', 'Nok', '', 'Observation fictive']);
});

test("l'ordre d'export suit l'ordre fourni", () => {
  const csv = buildCsv([FICTIF_2, FICTIF_1], { bom: false }).split(CSV_EOL);
  assert.ok(csv[1].startsWith('SITE-FICTIF/A/00/002/HYD02;'));
  assert.ok(csv[2].startsWith('SITE-FICTIF/A/00/001/HYD01;'));
});

test('nom de fichier daté', () => {
  assert.equal(exportFileName(new Date(2026, 10, 4, 23, 59)), 'atlas-hydrants-controles-2026-11-04.csv');
});
