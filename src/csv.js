/**
 * Export CSV compatible avec l'ancien export de l'outil de contrôle des hydrants.
 *
 * Contrat attesté :
 *   - encodage UTF-8, séparateur « ; » ;
 *   - exactement 6 colonnes, dans cet ordre :
 *     Titre;Date du contrôle;Statut;Test HP;Date du dernier Test HP;Commentaires
 *   - dates au format JJ-MM-AA.
 *
 * Choix de reconstruction (documentés dans le README) :
 *   - BOM UTF-8 en tête de fichier (activé par défaut) pour qu'Excel francophone
 *     détecte l'encodage et les accents ;
 *   - fin de ligne CRLF (RFC 4180), y compris après la dernière ligne ;
 *   - champs entourés de guillemets uniquement s'ils contiennent « ; », « " »,
 *     un retour à la ligne, ou un espace en début/fin ;
 *   - neutralisation des formules dans les champs libres (voir neutralizeFormula).
 */

import { isValidIsoDate } from './model.js';

export const CSV_HEADERS = Object.freeze([
  'Titre',
  'Date du contrôle',
  'Statut',
  'Test HP',
  'Date du dernier Test HP',
  'Commentaires',
]);

export const CSV_SEPARATOR = ';';
export const CSV_EOL = '\r\n';
export const UTF8_BOM = '﻿';

/**
 * Convertit « AAAA-MM-JJ » en « JJ-MM-AA » par simple découpage de chaîne :
 * aucun objet Date, donc aucun décalage de jour lié au fuseau horaire.
 * Une date vide ou invalide donne une chaîne vide.
 */
export function formatDateCsv(isoDate) {
  if (!isValidIsoDate(isoDate)) return '';
  const [year, month, day] = isoDate.split('-');
  return `${day}-${month}-${year.slice(2)}`;
}

/**
 * Caractères qui, en première position, font interpréter une cellule comme une
 * formule par Excel / LibreOffice (recommandation OWASP « CSV Injection »).
 */
export const FORMULA_PREFIXES = Object.freeze(['=', '+', '-', '@', '\t', '\r', '\n']);

/**
 * Neutralise une valeur libre commençant par un caractère à risque en la
 * préfixant d'une apostrophe : le tableur l'affiche alors comme du texte.
 * La transformation n'est appliquée qu'à l'export ; la valeur saisie reste
 * intacte dans le stockage local.
 */
export function neutralizeFormula(value) {
  const text = String(value ?? '');
  if (text && FORMULA_PREFIXES.includes(text[0])) return `'${text}`;
  return text;
}

/** Échappe un champ selon les règles CSV (séparateur « ; »). */
export function escapeCsvField(value) {
  const text = String(value ?? '');
  const mustQuote =
    text.includes(CSV_SEPARATOR) ||
    text.includes('"') ||
    text.includes('\n') ||
    text.includes('\r') ||
    text !== text.trim();
  return mustQuote ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * Transforme un contrôle en ligne de 6 valeurs (non échappées), dans l'ordre
 * des entêtes historiques. Les champs libres (Titre, Commentaires) sont
 * neutralisés contre l'injection de formules.
 */
export function recordToRow(record) {
  return [
    neutralizeFormula(record.titre),
    formatDateCsv(record.dateControle),
    record.statut ?? '',
    record.testHp ?? '',
    formatDateCsv(record.dateDernierTestHp),
    neutralizeFormula(record.commentaires),
  ];
}

/** Assemble une ligne CSV échappée (sans fin de ligne). */
export function formatCsvLine(values) {
  return values.map(escapeCsvField).join(CSV_SEPARATOR);
}

/**
 * Construit le contenu complet du fichier CSV.
 *
 * @param {object[]} records  contrôles à exporter, dans l'ordre voulu
 * @param {{ bom?: boolean }} [options]
 */
export function buildCsv(records, { bom = true } = {}) {
  const lines = [formatCsvLine(CSV_HEADERS), ...records.map((r) => formatCsvLine(recordToRow(r)))];
  return (bom ? UTF8_BOM : '') + lines.join(CSV_EOL) + CSV_EOL;
}

/** Nom de fichier proposé au téléchargement, d'après la date locale. */
export function exportFileName(now = new Date()) {
  const y = String(now.getFullYear()).padStart(4, '0');
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `atlas-hydrants-controles-${y}-${m}-${d}.csv`;
}
