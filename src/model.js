/**
 * Modèle de données d'un contrôle d'hydrant et règles de validation.
 *
 * Les valeurs autorisées pour « Statut » et « Test HP » sont uniquement celles
 * observées dans l'ancien export : leur signification métier n'est pas déduite
 * ici et aucun autre état n'est inventé.
 *
 * Module pur, sans dépendance au navigateur : utilisable par l'interface et par
 * les tests Node (node --test).
 */

/** Valeurs observées pour la colonne « Statut ». */
export const STATUTS = Object.freeze(['OK', 'HSH']);

/**
 * Valeurs observées pour la colonne « Test HP ». La chaîne vide est une valeur
 * à part entière, qui doit être choisie explicitement dans le formulaire.
 */
export const TEST_HP_VALUES = Object.freeze(['OK', 'Nok', '']);

export const TITRE_MAX_LENGTH = 120;
export const COMMENTAIRES_MAX_LENGTH = 2000;

/** Plage d'années acceptée : l'export n'écrit que deux chiffres (AA). */
export const MIN_YEAR = 2000;
export const MAX_YEAR = 2099;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
// Caractères de contrôle (dont retours à la ligne et tabulations).
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

/** Supprime les espaces en début et fin d'identifiant. */
export function normalizeTitre(value) {
  return String(value ?? '').trim();
}

/**
 * Clé de comparaison utilisée pour détecter les doublons : identifiant
 * normalisé, insensible à la casse.
 */
export function titreKey(value) {
  return normalizeTitre(value).toLocaleUpperCase('fr-FR');
}

/**
 * Vérifie qu'une chaîne « AAAA-MM-JJ » (format des champs <input type="date">)
 * désigne une date calendaire réelle. Le calcul est fait sur les nombres, sans
 * objet Date, pour éviter tout décalage lié au fuseau horaire.
 */
export function isValidIsoDate(value) {
  const match = ISO_DATE.exec(String(value ?? ''));
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < MIN_YEAR || year > MAX_YEAR) return false;
  if (month < 1 || month > 12) return false;
  return day >= 1 && day <= daysInMonth(year, month);
}

function daysInMonth(year, month) {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** Date du jour au format AAAA-MM-JJ, selon l'heure locale de l'appareil. */
export function todayIso(now = new Date()) {
  const y = String(now.getFullYear()).padStart(4, '0');
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Formulaire vide (aucune valeur pré-choisie pour Statut et Test HP). */
export function emptyControl(now = new Date()) {
  return {
    titre: '',
    dateControle: todayIso(now),
    statut: null,
    testHp: null,
    dateDernierTestHp: '',
    commentaires: '',
  };
}

/**
 * Valide une saisie de contrôle.
 *
 * @param {object} input  champs bruts du formulaire
 * @returns {{ valid: boolean, errors: Record<string, string>, value: object }}
 *          `value` contient les champs normalisés (identifiant rogné, etc.).
 */
export function validateControl(input) {
  const src = input ?? {};
  const errors = {};

  const titre = normalizeTitre(src.titre);
  if (!titre) {
    errors.titre = "L'identifiant de l'hydrant est obligatoire.";
  } else if (CONTROL_CHARS.test(titre)) {
    errors.titre = "L'identifiant ne doit pas contenir de retour à la ligne ni de tabulation.";
  } else if (titre.length > TITRE_MAX_LENGTH) {
    errors.titre = `L'identifiant ne doit pas dépasser ${TITRE_MAX_LENGTH} caractères.`;
  }

  const dateControle = String(src.dateControle ?? '').trim();
  if (!dateControle) {
    errors.dateControle = 'La date du contrôle est obligatoire.';
  } else if (!isValidIsoDate(dateControle)) {
    errors.dateControle = `Date du contrôle invalide (années ${MIN_YEAR} à ${MAX_YEAR}).`;
  }

  const statut = src.statut;
  if (!STATUTS.includes(statut)) {
    errors.statut = `Choisir un statut : ${STATUTS.join(' ou ')}.`;
  }

  const testHp = src.testHp;
  if (typeof testHp !== 'string' || !TEST_HP_VALUES.includes(testHp)) {
    errors.testHp = 'Choisir une valeur pour le Test HP : OK, Nok ou « vide ».';
  }

  const dateDernierTestHp = String(src.dateDernierTestHp ?? '').trim();
  if (dateDernierTestHp && !isValidIsoDate(dateDernierTestHp)) {
    errors.dateDernierTestHp = `Date du dernier Test HP invalide (années ${MIN_YEAR} à ${MAX_YEAR}), ou laisser vide.`;
  }

  const commentaires = String(src.commentaires ?? '');
  if (commentaires.length > COMMENTAIRES_MAX_LENGTH) {
    errors.commentaires = `Le commentaire ne doit pas dépasser ${COMMENTAIRES_MAX_LENGTH} caractères.`;
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    value: {
      titre,
      dateControle,
      statut: STATUTS.includes(statut) ? statut : null,
      testHp: TEST_HP_VALUES.includes(testHp) ? testHp : null,
      dateDernierTestHp,
      commentaires: commentaires.trim(),
    },
  };
}

/**
 * Cherche un contrôle existant portant le même identifiant (comparaison
 * insensible à la casse et aux espaces de bord).
 *
 * @param {Array<{id: string, titre: string}>} records
 * @param {string} titre
 * @param {string} [excludeId]  identifiant interne du contrôle en cours d'édition
 */
export function findDuplicate(records, titre, excludeId) {
  const key = titreKey(titre);
  if (!key) return null;
  return records.find((r) => r.id !== excludeId && titreKey(r.titre) === key) ?? null;
}

/** Identifiant interne unique (non exporté dans le CSV). */
export function createId(randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto)) {
  if (typeof randomUUID === 'function') return randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
