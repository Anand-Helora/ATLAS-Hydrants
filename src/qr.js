/**
 * Lecture de QR code par la caméra, uniquement si le navigateur le permet.
 *
 * Détection de fonctionnalité : contexte sécurisé (HTTPS ou localhost), API
 * BarcodeDetector avec le format « qr_code », et accès caméra
 * (navigator.mediaDevices.getUserMedia). Aucune bibliothèque tierce n'est
 * chargée : si l'une de ces conditions manque, seule la saisie manuelle est
 * proposée.
 *
 * La caméra n'est demandée qu'après une action de l'utilisateur (start) et elle
 * est coupée dès l'arrêt (stop) : retour, fermeture, page masquée.
 */

/** Vérification synchrone des prérequis (sans demander la caméra). */
export function hasQrPrerequisites(win) {
  return Boolean(
    win &&
      win.isSecureContext === true &&
      typeof win.BarcodeDetector === 'function' &&
      typeof win.navigator?.mediaDevices?.getUserMedia === 'function',
  );
}

/** Vérifie en plus que le format « qr_code » est réellement pris en charge. */
export async function isQrScanSupported(win) {
  if (!hasQrPrerequisites(win)) return false;
  try {
    const getFormats = win.BarcodeDetector.getSupportedFormats;
    if (typeof getFormats !== 'function') return true;
    const formats = await getFormats.call(win.BarcodeDetector);
    return Array.isArray(formats) && formats.includes('qr_code');
  } catch {
    return false;
  }
}

/** Traduit une erreur getUserMedia en message compréhensible. */
export function cameraErrorMessage(error) {
  switch (error?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return "Accès à la caméra refusé. Autorisez la caméra dans le navigateur, ou saisissez l'identifiant à la main.";
    case 'NotFoundError':
    case 'OverconstrainedError':
      return "Aucune caméra utilisable n'a été trouvée. Saisissez l'identifiant à la main.";
    case 'NotReadableError':
      return "La caméra est déjà utilisée par une autre application. Saisissez l'identifiant à la main.";
    default:
      return "Le scan QR n'a pas pu démarrer. Saisissez l'identifiant à la main.";
  }
}

/**
 * Crée un lecteur QR.
 *
 * @param {object} options
 * @param {HTMLVideoElement} options.video
 * @param {Function} options.BarcodeDetector
 * @param {{ getUserMedia: Function }} options.mediaDevices
 * @param {(text: string) => void} options.onResult  appelé une seule fois, puis la caméra est coupée
 * @param {number} [options.intervalMs]
 */
export function createQrScanner({ video, BarcodeDetector, mediaDevices, onResult, intervalMs = 250 }) {
  let stream = null;
  let timer = null;
  let running = false;

  async function tick(detector) {
    if (!running) return;
    try {
      if (video.readyState >= 2) {
        const codes = await detector.detect(video);
        const text = codes?.find((c) => typeof c.rawValue === 'string' && c.rawValue.trim())?.rawValue;
        if (running && text) {
          stop();
          onResult(text);
          return;
        }
      }
    } catch {
      // Image non exploitable : on réessaie à l'intervalle suivant.
    }
    if (running) timer = setTimeout(() => tick(detector), intervalMs);
  }

  async function start() {
    if (running) return;
    running = true;
    try {
      const detector = new BarcodeDetector({ formats: ['qr_code'] });
      stream = await mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      if (!running) {
        // stop() appelé pendant la demande d'autorisation.
        releaseStream();
        return;
      }
      video.srcObject = stream;
      video.setAttribute('playsinline', '');
      video.muted = true;
      await video.play();
      tick(detector);
    } catch (error) {
      stop();
      throw error;
    }
  }

  function releaseStream() {
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      stream = null;
    }
  }

  function stop() {
    running = false;
    if (timer) clearTimeout(timer);
    timer = null;
    releaseStream();
    if (video) {
      try {
        video.pause();
      } catch {
        // Sans incidence.
      }
      video.srcObject = null;
    }
  }

  return {
    start,
    stop,
    get active() {
      return running;
    },
  };
}
