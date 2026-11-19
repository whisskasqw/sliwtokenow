// Распознавание содержимого фото прямо в браузере (TensorFlow.js).
// MobileNet v2 — классификация сцены/объекта (1000 классов ImageNet),
// COCO-SSD — поиск людей и объектов на изображении.

import { CLASS_TO_CATEGORY, COCO_TO_CATEGORY } from './categories.js';
import { IMAGENET_NAMES } from './imagenet-names.js';

let models = null;

export async function loadModels(onStatus = () => {}) {
  if (models) return models;
  const tf = window.tf;
  onStatus('Подготовка вычислений…');
  try { await tf.setBackend('webgl'); } catch { await tf.setBackend('cpu'); }
  await tf.ready();
  onStatus('Загрузка модели распознавания сцен…');
  const net = await window.mobilenet.load({ version: 2, alpha: 1.0, modelUrl: 'models/mobilenet/model.json' });
  onStatus('Загрузка детектора людей и объектов…');
  let detector = null;
  try {
    detector = await window.cocoSsd.load({ base: 'lite_mobilenet_v2', modelUrl: 'models/cocossd/model.json' });
  } catch (e) {
    console.warn('COCO-SSD не загрузился, продолжаем без него', e);
  }
  models = { net, detector };
  return models;
}

// Доля «плоских» участков: у скриншотов и документов много одинаковых соседних пикселей.
function flatness(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { width: w, height: h } = canvas;
  const d = ctx.getImageData(0, 0, w, h).data;
  let same = 0, total = 0, green = 0, mono = 0;
  const colors = new Set();
  for (let y = 0; y < h; y++) {
    for (let x = 1; x < w; x++) {
      const i = (y * w + x) * 4, j = i - 4;
      total++;
      if (Math.abs(d[i] - d[j]) + Math.abs(d[i + 1] - d[j + 1]) + Math.abs(d[i + 2] - d[j + 2]) <= 3) same++;
      if (Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) < 14) mono++;
      if (d[i + 1] > d[i] + 12 && d[i + 1] > d[i + 2] + 12) green++;
      colors.add((d[i] >> 4) << 8 | (d[i + 1] >> 4) << 4 | (d[i + 2] >> 4));
    }
  }
  return { flat: same / total, colors: colors.size, green: green / total, mono: mono / total };
}

function toCanvas(img, size) {
  const c = document.createElement('canvas');
  const scale = Math.min(1, size / Math.max(img.width, img.height));
  c.width = Math.max(1, Math.round(img.width * scale));
  c.height = Math.max(1, Math.round(img.height * scale));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c;
}

/**
 * Возвращает { category, confidence, scores, tags, objects }.
 * img — ImageBitmap или HTMLImageElement, file — исходный файл (для подсказок по имени).
 */
export async function classify(img, file) {
  const { net, detector } = await loadModels();
  const tf = window.tf;
  const input = toCanvas(img, 448);

  const probs = tf.tidy(() => tf.softmax(net.infer(input, false)).dataSync());
  const top = Array.from(probs, (p, i) => [i, p]).sort((a, b) => b[1] - a[1]).slice(0, 10);

  const scores = {};
  const add = (cat, v) => { scores[cat] = (scores[cat] || 0) + v; };
  for (const [idx, p] of top) add(CLASS_TO_CATEGORY.get(idx) || 'other', p);

  let objects = [];
  if (detector) {
    const preds = await detector.detect(input, 20, 0.45);
    const area = input.width * input.height;
    objects = preds.map(p => ({ cls: p.class, score: p.score, frac: (p.bbox[2] * p.bbox[3]) / area }));
    const byCat = {};
    for (const o of objects) {
      const cat = COCO_TO_CATEGORY[o.cls];
      if (!cat) continue;
      byCat[cat] = Math.max(byCat[cat] || 0, o.score * Math.min(1, 0.35 + o.frac * 2));
    }
    // Люди на фото — главный признак: ImageNet почти не знает «человека».
    if (byCat.people) {
      const people = objects.filter(o => o.cls === 'person');
      const totalFrac = people.reduce((s, o) => s + o.frac, 0);
      if (totalFrac > 0.06) byCat.people += 0.4 + Math.min(0.4, totalFrac);
    }
    for (const [cat, v] of Object.entries(byCat)) add(cat, v * 0.9);
  }

  // Скриншоты и документы
  const f = flatness(toCanvas(img, 128));
  const nameHint = /screen|скрин|снимок экрана|scan|скан|doc/i.test(file?.name || '');
  const isPng = /png|webp|gif/i.test(file?.type || '');
  let docScore = 0;
  if (f.flat > 0.5) docScore += (f.flat - 0.5) * 2.2;
  if (f.mono > 0.9 && f.flat > 0.15) docScore += 0.6; // ч/б скан или текст
  else if (f.colors < 180) docScore += 0.25;
  if (nameHint) docScore += 0.6;
  if (isPng && f.flat > 0.35) docScore += 0.25;
  // Без подсказки в имени файла «плоскость» не должна перебивать уверенно найденный объект.
  if (!nameHint) docScore = Math.min(docScore, 1);
  if (docScore > 0) add('docs', docScore);
  // Много зелени — трава, листва, лес (ImageNet плохо знает растения)
  if (f.green > 0.35) add('nature', (f.green - 0.2) * 1.2);

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  let [category, best] = ranked[0] || ['other', 0];
  if (category !== 'other' && best < 0.12) category = 'other';

  const tags = [...new Set([
    ...objects.filter(o => o.score > 0.5).map(o => o.cls),
    ...top.filter(([, p]) => p > 0.06).slice(0, 4).map(([i]) => IMAGENET_NAMES[i]),
  ])].slice(0, 6);

  return {
    category,
    confidence: Math.min(1, best),
    scores,
    tags,
    flat: f.flat,
  };
}
