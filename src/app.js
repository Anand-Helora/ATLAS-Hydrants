/**
 * Interface de l'application (navigateur uniquement).
 * La logique métier testable vit dans model.js, csv.js, storage.js et qr.js.
 */

import { emptyControl, findDuplicate, normalizeTitre } from './model.js';
import { CSV_HEADERS, buildCsv, exportFileName, formatDateCsv, recordToRow } from './csv.js';
import { DuplicateTitreError, ValidationError, createRepository, createWebLock, openBestBackend } from './storage.js';
import { cameraErrorMessage, createQrScanner, isQrScanSupported } from './qr.js';

const $ = (id) => document.getElementById(id);
const FIELDS = ['titre', 'dateControle', 'statut', 'testHp', 'dateDernierTestHp', 'commentaires'];
const STORAGE_LABELS = {
  indexedDB: 'Stockage : IndexedDB du navigateur. Les contrôles restent après un rafraîchissement, sur ce seul appareil et ce seul navigateur.',
  localStorage: 'Stockage : localStorage du navigateur (IndexedDB indisponible). Les contrôles restent après un rafraîchissement, sur ce seul appareil.',
  memory: "ATTENTION : aucun stockage persistant n'est disponible (navigation privée ?). Les contrôles seront PERDUS au rafraîchissement : exportez le CSV avant de quitter.",
};

const state = {
  repo: null,
  records: [],
  view: 'list',
  editingId: null,
  savedSnapshot: '',
  scanner: null,
  busy: false,
};

// ---------------------------------------------------------------------------
// Messages

let messageTimer = null;
function showMessage(text, { error = false } = {}) {
  const box = $('message');
  box.textContent = text;
  box.classList.toggle('is-error', error);
  box.setAttribute('role', error ? 'alert' : 'status');
  box.hidden = false;
  clearTimeout(messageTimer);
  if (!error) messageTimer = setTimeout(() => (box.hidden = true), 5000);
}

function clearMessage() {
  clearTimeout(messageTimer);
  $('message').hidden = true;
}

// ---------------------------------------------------------------------------
// Formulaire

function readForm() {
  const form = $('form');
  const radio = (name) => form.querySelector(`input[name="${name}"]:checked`)?.value ?? null;
  return {
    titre: $('titre').value,
    dateControle: $('dateControle').value,
    statut: radio('statut'),
    testHp: radio('testHp'),
    dateDernierTestHp: $('dateDernierTestHp').value,
    commentaires: $('commentaires').value,
  };
}

function writeForm(values) {
  const form = $('form');
  $('titre').value = values.titre ?? '';
  $('dateControle').value = values.dateControle ?? '';
  $('dateDernierTestHp').value = values.dateDernierTestHp ?? '';
  $('commentaires').value = values.commentaires ?? '';
  for (const name of ['statut', 'testHp']) {
    for (const input of form.querySelectorAll(`input[name="${name}"]`)) {
      input.checked = values[name] !== null && values[name] !== undefined && input.value === values[name];
    }
  }
}

const snapshot = () => JSON.stringify(readForm());
const isDirty = () => state.view === 'form' && snapshot() !== state.savedSnapshot;

function showErrors(errors) {
  for (const field of FIELDS) {
    const el = $(`${field}-error`);
    const message = errors[field];
    el.textContent = message ?? '';
    el.hidden = !message;
    $(`field-${field}`).classList.toggle('has-error', Boolean(message));
    const input = $(field);
    if (input) input.setAttribute('aria-invalid', message ? 'true' : 'false');
  }
  const first = FIELDS.find((f) => errors[f]);
  if (first) {
    const target = $(first) ?? document.querySelector(`input[name="${first}"]`);
    target?.focus();
  }
}

function hideDuplicate() {
  $('duplicate').hidden = true;
  delete $('btn-open-duplicate').dataset.id;
}

function showDuplicate(existing) {
  $('duplicate-text').textContent = `Un contrôle est déjà enregistré pour « ${existing.titre} » (contrôle du ${formatDateCsv(existing.dateControle) || '?'}). Ouvrez-le pour le modifier plutôt que de créer un doublon.`;
  $('btn-open-duplicate').dataset.id = existing.id;
  $('duplicate').hidden = false;
}

function checkDuplicateLive() {
  const existing = findDuplicate(state.records, $('titre').value, state.editingId ?? undefined);
  if (existing) showDuplicate(existing);
  else hideDuplicate();
}

function openForm(record) {
  // Un scan en cours ne doit jamais écrire dans le contrôle qu'on ouvre.
  stopScan();
  state.editingId = record?.id ?? null;
  writeForm(record ?? emptyControl());
  showErrors({});
  hideDuplicate();
  $('form-title').textContent = record ? 'Modifier le contrôle' : 'Nouveau contrôle';
  $('btn-delete').hidden = !record;
  state.savedSnapshot = snapshot();
  showView('form');
  $('titre').focus();
}

/** Verrouille le formulaire pendant une écriture, pour qu'aucune saisie ne s'y perde. */
function setFormBusy(busy) {
  state.busy = busy;
  const form = $('form');
  form.inert = busy;
  form.setAttribute('aria-busy', busy ? 'true' : 'false');
  $('btn-save').disabled = busy;
}

async function onSubmit(event) {
  event.preventDefault();
  if (state.busy) return;
  clearMessage();
  stopScan();
  // Valeurs réellement soumises : seules celles-ci sont considérées comme enregistrées.
  const submitted = readForm();
  const submittedSnapshot = JSON.stringify(submitted);
  setFormBusy(true);
  try {
    const saved = await state.repo.save(submitted, state.editingId ?? undefined);
    await refreshRecords();
    const wasEdit = Boolean(state.editingId);
    state.editingId = saved.id;
    state.savedSnapshot = submittedSnapshot;
    showErrors({});
    if (snapshot() !== submittedSnapshot) {
      // Saisie modifiée pendant l'écriture (navigateur sans « inert ») : on reste
      // sur le formulaire, en mode modification, avec les changements non enregistrés.
      $('form-title').textContent = 'Modifier le contrôle';
      $('btn-delete').hidden = false;
      showMessage(`Contrôle « ${saved.titre} » enregistré, mais des modifications faites pendant l’enregistrement ne le sont pas encore : enregistrez à nouveau.`, { error: true });
      return;
    }
    showView('list', { replace: true });
    showMessage(wasEdit ? `Contrôle « ${saved.titre} » mis à jour.` : `Contrôle « ${saved.titre} » enregistré sur cet appareil.`);
  } catch (error) {
    if (error instanceof ValidationError) {
      showErrors(error.errors);
      showMessage('Le contrôle n’est pas enregistré : corrigez les champs signalés.', { error: true });
    } else if (error instanceof DuplicateTitreError) {
      showErrors({ titre: 'Cet identifiant est déjà enregistré.' });
      showDuplicate(error.existing);
      showMessage('Le contrôle n’est pas enregistré : identifiant déjà présent dans la liste.', { error: true });
    } else {
      console.error(error);
      showMessage(`Échec de l’enregistrement local : ${error?.message ?? error}. Vos saisies sont toujours dans le formulaire.`, { error: true });
    }
  } finally {
    setFormBusy(false);
  }
}

async function onDelete() {
  const id = state.editingId;
  const record = state.records.find((r) => r.id === id);
  if (!record) return;
  if (!window.confirm(`Supprimer définitivement le contrôle « ${record.titre} » de cet appareil ?`)) return;
  try {
    await state.repo.remove(id);
    await refreshRecords();
    state.savedSnapshot = snapshot();
    showView('list', { replace: true });
    showMessage(`Contrôle « ${record.titre} » supprimé.`);
  } catch (error) {
    console.error(error);
    showMessage(`Échec de la suppression : ${error?.message ?? error}`, { error: true });
  }
}

// ---------------------------------------------------------------------------
// Liste

async function refreshRecords() {
  state.records = await state.repo.list();
  renderList();
}

function renderList() {
  const list = $('list');
  list.replaceChildren();
  $('count').textContent = `(${state.records.length})`;
  $('list-empty').hidden = state.records.length > 0;
  for (const record of state.records) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'record-btn';
    btn.dataset.id = record.id;
    const titre = document.createElement('span');
    titre.className = 'record-titre';
    titre.textContent = record.titre;
    const meta = document.createElement('span');
    meta.className = 'record-meta';
    const hp = record.testHp === '' ? 'vide' : record.testHp;
    meta.textContent = `Contrôle du ${formatDateCsv(record.dateControle)} · Statut ${record.statut} · Test HP ${hp}`;
    btn.append(titre, meta);
    btn.setAttribute('aria-label', `Modifier ${record.titre}, ${meta.textContent}`);
    li.append(btn);
    list.append(li);
  }
}

// ---------------------------------------------------------------------------
// Export

function renderExport() {
  const head = $('preview-head');
  head.replaceChildren(
    ...CSV_HEADERS.map((h) => {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = h;
      return th;
    }),
  );
  const body = $('preview-body');
  body.replaceChildren(
    ...state.records.map((record) => {
      const tr = document.createElement('tr');
      for (const value of recordToRow(record)) {
        const td = document.createElement('td');
        td.textContent = value;
        tr.append(td);
      }
      return tr;
    }),
  );
  $('preview-empty').hidden = state.records.length > 0;
  // Le texte brut est affiché sans le BOM, invisible de toute façon.
  $('preview-raw').textContent = buildCsv(state.records, { bom: false });
}

function downloadCsv() {
  try {
    const content = buildCsv(state.records, { bom: $('opt-bom').checked });
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = exportFileName();
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    showMessage(`Fichier ${link.download} généré (${state.records.length} contrôle(s)). Les données restent aussi sur cet appareil.`);
  } catch (error) {
    console.error(error);
    showMessage(`Échec de l’export : ${error?.message ?? error}`, { error: true });
  }
}

// ---------------------------------------------------------------------------
// Scan QR

async function setupScan() {
  const supported = await isQrScanSupported(window);
  if (supported) {
    $('btn-scan').hidden = false;
    $('scan-unavailable').hidden = true;
    return;
  }
  $('btn-scan').hidden = true;
  $('scan-unavailable').hidden = false;
  $('scan-unavailable').textContent = window.isSecureContext
    ? 'Scan QR non pris en charge par ce navigateur : saisissez l’identifiant à la main.'
    : 'Scan QR indisponible hors connexion sécurisée (HTTPS ou localhost) : saisissez l’identifiant à la main.';
}

async function startScan() {
  if (state.scanner?.active) return;
  clearMessage();
  $('scanner').hidden = false;
  $('btn-scan').hidden = true;
  const scanner = createQrScanner({
    video: $('scanner-video'),
    BarcodeDetector: window.BarcodeDetector,
    mediaDevices: navigator.mediaDevices,
    onResult(text) {
      if (state.scanner !== scanner) return;
      hideScanner();
      $('titre').value = normalizeTitre(text);
      $('titre').dispatchEvent(new Event('input', { bubbles: true }));
      showMessage('QR code lu : vérifiez l’identifiant avant d’enregistrer.');
      $('titre').focus();
    },
  });
  state.scanner = scanner;
  try {
    await scanner.start();
  } catch (error) {
    // Une session remplacée entre-temps ne doit pas modifier l'interface.
    if (state.scanner !== scanner) return;
    hideScanner();
    showMessage(cameraErrorMessage(error), { error: true });
  }
}

function hideScanner() {
  $('scanner').hidden = true;
  $('btn-scan').hidden = $('scan-unavailable').hidden === false;
}

function stopScan() {
  if (state.scanner) state.scanner.stop();
  hideScanner();
}

// ---------------------------------------------------------------------------
// Navigation

function showView(view, { replace = false } = {}) {
  if (view !== 'form') stopScan();
  state.view = view;
  for (const name of ['list', 'form', 'export']) $(`view-${name}`).hidden = name !== view;
  if (view === 'export') renderExport();
  const entry = { view };
  if (replace || view === 'list') history.replaceState(entry, '');
  else history.pushState(entry, '');
  window.scrollTo(0, 0);
}

function confirmLeaveForm() {
  return !isDirty() || window.confirm('Des modifications ne sont pas enregistrées. Les abandonner ?');
}

function backToList() {
  if (!confirmLeaveForm()) return;
  state.savedSnapshot = snapshot();
  showView('list');
}

function onPopState(event) {
  const target = event.state?.view ?? 'list';
  if (state.view === 'form' && target !== 'form' && !confirmLeaveForm()) {
    history.pushState({ view: 'form' }, '');
    return;
  }
  if (target === 'form' && state.view !== 'form') {
    // Retour « en avant » vers un formulaire fermé : on reste sur la liste.
    history.replaceState({ view: 'list' }, '');
    showView('list', { replace: true });
    return;
  }
  stopScan();
  state.view = target;
  for (const name of ['list', 'form', 'export']) $(`view-${name}`).hidden = name !== target;
  if (target === 'export') renderExport();
}

// ---------------------------------------------------------------------------
// Démarrage

async function init() {
  $('btn-new').addEventListener('click', () => openForm(null));
  $('btn-export').addEventListener('click', () => showView('export'));
  $('btn-export-back').addEventListener('click', () => showView('list'));
  $('btn-download').addEventListener('click', downloadCsv);
  $('btn-cancel').addEventListener('click', backToList);
  $('btn-delete').addEventListener('click', onDelete);
  $('btn-clear-hp').addEventListener('click', () => {
    $('dateDernierTestHp').value = '';
  });
  $('btn-scan').addEventListener('click', startScan);
  $('btn-scan-stop').addEventListener('click', stopScan);
  $('form').addEventListener('submit', onSubmit);
  $('titre').addEventListener('input', checkDuplicateLive);
  // Effacer l'erreur d'un champ dès que l'utilisateur le corrige.
  const clearFieldError = (event) => {
    const field = event.target.name;
    if (!FIELDS.includes(field)) return;
    $(`${field}-error`).hidden = true;
    $(`field-${field}`).classList.remove('has-error');
    $(field)?.setAttribute('aria-invalid', 'false');
  };
  $('form').addEventListener('input', clearFieldError);
  $('form').addEventListener('change', clearFieldError);
  $('btn-open-duplicate').addEventListener('click', () => {
    const record = state.records.find((r) => r.id === $('btn-open-duplicate').dataset.id);
    if (record && confirmLeaveForm()) openForm(record);
  });
  $('list').addEventListener('click', (event) => {
    const btn = event.target.closest('.record-btn');
    const record = btn && state.records.find((r) => r.id === btn.dataset.id);
    if (record) openForm(record);
  });

  window.addEventListener('popstate', onPopState);
  window.addEventListener('beforeunload', (event) => {
    if (isDirty()) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  // Couper la caméra dès que la page est masquée ou quittée.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopScan();
  });
  window.addEventListener('pagehide', stopScan);

  history.replaceState({ view: 'list' }, '');
  setupScan();

  try {
    const backend = await openBestBackend(window);
    state.repo = createRepository(backend, { lock: createWebLock(navigator) });
    $('storage-detail').textContent = STORAGE_LABELS[backend.kind];
    $('storage-banner').classList.toggle('is-critical', backend.kind === 'memory');
    await refreshRecords();
  } catch (error) {
    console.error(error);
    $('storage-detail').textContent = 'Erreur : le stockage local ne peut pas être lu.';
    $('storage-banner').classList.add('is-critical');
    showMessage(`Impossible de lire les contrôles enregistrés : ${error?.message ?? error}`, { error: true });
  }
}

init();
