import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cameraErrorMessage, createQrScanner, hasQrPrerequisites, isQrScanSupported } from '../src/qr.js';

function FakeDetector() {}
FakeDetector.prototype.detect = async () => [];
FakeDetector.getSupportedFormats = async () => ['qr_code', 'ean_13'];

const fullWin = () => ({
  isSecureContext: true,
  BarcodeDetector: FakeDetector,
  navigator: { mediaDevices: { getUserMedia: async () => ({}) } },
});

test('scan proposé seulement si contexte sécurisé + BarcodeDetector + caméra', async () => {
  assert.equal(await isQrScanSupported(fullWin()), true);
  assert.equal(await isQrScanSupported({ ...fullWin(), isSecureContext: false }), false);
  assert.equal(await isQrScanSupported({ ...fullWin(), BarcodeDetector: undefined }), false);
  assert.equal(await isQrScanSupported({ ...fullWin(), navigator: {} }), false);
  assert.equal(hasQrPrerequisites(undefined), false);
});

test('scan refusé si le format qr_code est absent ou la détection échoue', async () => {
  function NoQr() {}
  NoQr.getSupportedFormats = async () => ['ean_13'];
  assert.equal(await isQrScanSupported({ ...fullWin(), BarcodeDetector: NoQr }), false);
  function Broken() {}
  Broken.getSupportedFormats = async () => {
    throw new Error('x');
  };
  assert.equal(await isQrScanSupported({ ...fullWin(), BarcodeDetector: Broken }), false);
});

test('messages d’erreur caméra compréhensibles', () => {
  assert.match(cameraErrorMessage({ name: 'NotAllowedError' }), /refusé/);
  assert.match(cameraErrorMessage({ name: 'NotFoundError' }), /Aucune caméra/);
  assert.match(cameraErrorMessage(new Error('?')), /saisissez/i);
});

function fakeVideo() {
  return {
    readyState: 4,
    srcObject: null,
    muted: false,
    setAttribute() {},
    play: async () => {},
    pause() {},
  };
}

function fakeStream() {
  const tracks = [{ stopped: false, stop() { this.stopped = true; } }];
  return { tracks, getTracks: () => tracks };
}

test('la caméra est coupée après lecture d’un QR code', async () => {
  const stream = fakeStream();
  const video = fakeVideo();
  function Detector() {}
  Detector.prototype.detect = async () => [{ rawValue: 'SITE-FICTIF/A/00/001/HYD01' }];
  const result = await new Promise((resolve, reject) => {
    const scanner = createQrScanner({
      video,
      BarcodeDetector: Detector,
      mediaDevices: { getUserMedia: async () => stream },
      onResult: (text) => resolve({ text, scanner }),
      intervalMs: 1,
    });
    scanner.start().catch(reject);
  });
  assert.equal(result.text, 'SITE-FICTIF/A/00/001/HYD01');
  assert.equal(result.scanner.active, false);
  assert.equal(stream.tracks[0].stopped, true);
  assert.equal(video.srcObject, null);
});

test('stop() coupe la caméra immédiatement', async () => {
  const stream = fakeStream();
  const video = fakeVideo();
  const scanner = createQrScanner({
    video,
    BarcodeDetector: FakeDetector,
    mediaDevices: { getUserMedia: async () => stream },
    onResult: () => assert.fail('aucun résultat attendu'),
    intervalMs: 1,
  });
  await scanner.start();
  assert.equal(scanner.active, true);
  assert.equal(video.srcObject, stream);
  scanner.stop();
  assert.equal(scanner.active, false);
  assert.equal(stream.tracks[0].stopped, true);
  assert.equal(video.srcObject, null);
});

test('stop() pendant la demande d’autorisation : flux libéré dès son arrivée', async () => {
  const stream = fakeStream();
  let grant;
  const scanner = createQrScanner({
    video: fakeVideo(),
    BarcodeDetector: FakeDetector,
    mediaDevices: { getUserMedia: () => new Promise((r) => (grant = r)) },
    onResult: () => {},
  });
  const started = scanner.start();
  await new Promise((r) => setImmediate(r));
  scanner.stop();
  grant(stream);
  await started;
  assert.equal(stream.tracks[0].stopped, true);
});

test('refus de la caméra : erreur propagée, scanner inactif', async () => {
  const scanner = createQrScanner({
    video: fakeVideo(),
    BarcodeDetector: FakeDetector,
    mediaDevices: {
      getUserMedia: async () => {
        throw Object.assign(new Error('refus'), { name: 'NotAllowedError' });
      },
    },
    onResult: () => {},
  });
  await assert.rejects(scanner.start(), { name: 'NotAllowedError' });
  assert.equal(scanner.active, false);
});

test('rejet tardif d’une session arrêtée : la nouvelle session partageant la vidéo est intacte', async () => {
  const video = fakeVideo();
  let rejectFirst;
  const first = createQrScanner({
    video,
    BarcodeDetector: FakeDetector,
    mediaDevices: { getUserMedia: () => new Promise((_, reject) => (rejectFirst = reject)) },
    onResult: () => {},
    intervalMs: 1,
  });
  const firstStarted = first.start();
  await new Promise((r) => setImmediate(r));
  first.stop();

  const stream = fakeStream();
  const second = createQrScanner({
    video,
    BarcodeDetector: FakeDetector,
    mediaDevices: { getUserMedia: async () => stream },
    onResult: () => {},
    intervalMs: 1,
  });
  await second.start();
  assert.equal(video.srcObject, stream);

  rejectFirst(Object.assign(new Error('refus tardif'), { name: 'NotAllowedError' }));
  await firstStarted; // erreur d'une session annulée : ignorée, pas de rejet
  assert.equal(video.srcObject, stream, 'la vidéo garde le flux de la nouvelle session');
  assert.equal(second.active, true);
  assert.equal(stream.tracks[0].stopped, false);

  first.stop(); // un stop() tardif de l'ancienne session ne touche pas non plus la vidéo
  assert.equal(video.srcObject, stream);
  second.stop();
  assert.equal(stream.tracks[0].stopped, true);
  assert.equal(video.srcObject, null);
});
