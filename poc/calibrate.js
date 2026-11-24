// Kalibrerar prismodellen mot kunder.csv + bilar.csv och skriver faktorer.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadData, parsePersonnummer } from './lib.js';
import { AGE_BANDS, AGE_KNOTS, ageBasis, HP_LABELS, VALUE_LABELS, ageBand, hpBand, valueBand, price } from './pricing.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const MODEL_FILE = path.join(here, 'faktorer.json');
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);

export function prepare(data, now = new Date()) {
  return data.kunder.map(k => {
    const car = data.bilar.get(k.regnummer);
    const p = parsePersonnummer(k.personnummer, now);
    return { ...k, car, age: p.alder };
  }).filter(r => r.car && r.age >= 18);
}

const K_SHRINK = 25; // förväntade krockar i en nivå som krävs för 50 % tilltro till nivåns egen frekvens

/** Löser A·x = b (Gauss med pivotering). */
function solve(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
    [M[i], M[p]] = [M[p], M[i]];
    for (let r = i + 1; r < n; r++) { const f = M[r][i] / M[i][i]; for (let c = i; c <= n; c++) M[r][c] -= f * M[i][c]; }
  }
  const x = Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) { let t = M[i][n]; for (let c = i + 1; c < n; c++) t -= M[i][c] * x[c]; x[i] = t / M[i][i]; }
  return x;
}

export const AGE_LAMBDA = 40; // utjämning av ålderskurvan (högre = jämnare). Vald med korsvalidering, se validate.js

/**
 * Poisson-frekvens: en jämn ålderskurva (linjär spline i log-skala med andraderivatastraff) × effekt × drivmedel × bilvärde.
 * Anpassas växelvis (iterativ skalning). Faktorerna krymps mot 1 när underlaget är litet. Sedan skattas
 * trovärdighetsparametern k (Gamma-Poisson) med momentmetoden: τ² = Σ[(Y−e)²−e] / Σe², k = 1/τ².
 */
function fitFrequency(rows, lambda = AGE_LAMBDA) {
  const dims = {
    hk: { of: r => hpBand(r.car.hk), n: HP_LABELS.length },
    drivmedel: { of: r => r.car.drivmedel, keys: [...new Set(rows.map(r => r.car.drivmedel))] },
    varde: { of: r => valueBand(r.car.varde), n: VALUE_LABELS.length },
  };
  const levels = d => d.keys ?? [...Array(d.n).keys()];
  const f = Object.fromEntries(Object.entries(dims).map(([k, d]) => [k, Object.fromEntries(levels(d).map(l => [l, 1]))]));
  const total = sum(rows, r => r.krockar) / sum(rows, r => r.ar);
  const K = AGE_KNOTS.length;
  const theta = Array(K).fill(Math.log(total));          // log-frekvens vid varje knut
  const basis = rows.map(r => ageBasis(r.age));
  const other = r => Object.entries(dims).reduce((p, [k, d]) => p * f[k][d.of(r)], 1);
  const ageMu = (r, i) => Math.exp(basis[i].reduce((s, [j, w]) => s + w * theta[j], 0));
  const mu = (r, i) => r.ar * ageMu(r, i) * other(r);

  for (let it = 0; it < 40; it++) {
    // (a) ålderskurvan: penaliserad Poisson-Newton med övriga faktorer som offset
    for (let n = 0; n < 3; n++) {
      const g = Array(K).fill(0), H = Array.from({ length: K }, () => Array(K).fill(0));
      rows.forEach((r, i) => {
        const m = mu(r, i);
        for (const [j, w] of basis[i]) {
          g[j] += w * (r.krockar - m);
          for (const [k2, w2] of basis[i]) H[j][k2] += w * w2 * m;
        }
      });
      // andraderivatastraff λ·Σ(θ[j-1] − 2θ[j] + θ[j+1])², uppdelat i gradient och Hessian
      for (let j = 1; j < K - 1; j++) {
        const c = [[j - 1, 1], [j, -2], [j + 1, 1]], d2 = c.reduce((s, [k2, w]) => s + w * theta[k2], 0);
        for (const [k2, w] of c) { g[k2] -= lambda * w * d2; for (const [k3, w3] of c) H[k2][k3] += lambda * w * w3; }
      }
      for (let j = 0; j < K; j++) H[j][j] += 1e-6;
      const step = solve(H, g);
      for (let j = 0; j < K; j++) theta[j] += clamp(step[j], -1, 1);
    }
    // (b) övriga faktorer, med kurvan som offset
    for (const [k, d] of Object.entries(dims)) {
      for (const l of levels(d)) {
        let obs = 0, exp = 0;
        rows.forEach((r, i) => { if (d.of(r) === l) { obs += r.krockar; exp += mu(r, i) / f[k][l]; } });
        if (!exp) continue;
        f[k][l] = 1 + (obs / exp - 1) * (obs / (obs + K_SHRINK));
      }
    }
  }
  // Normalisera så att totalt förväntat antal krockar = observerat
  const expTot = rows.reduce((s, r, i) => s + mu(r, i), 0);
  const shift = Math.log(sum(rows, r => r.krockar) / expTot);
  for (let j = 0; j < K; j++) theta[j] += shift;
  const prior = (r, i) => ageMu(r, i) * other(r);
  const num = rows.reduce((s, r, i) => { const e = r.ar * prior(r, i); return s + (r.krockar - e) ** 2 - e; }, 0);
  const den = rows.reduce((s, r, i) => s + (r.ar * prior(r, i)) ** 2, 0);
  const tau2 = num / den;
  const k = tau2 > 0.01 ? clamp(1 / tau2, 1, 100) : 100;
  // Medelfrekvens per åldersband (för visning)
  const perAldersband = AGE_BANDS.map((_, b) => {
    const idx = rows.map((r, i) => i).filter(i => ageBand(rows[i].age) === b);
    return sum(idx, i => rows[i].ar * ageMu(rows[i], i)) / sum(idx, i => rows[i].ar);
  });
  return { perAldersband, alderKnutar: AGE_KNOTS, alderLogF: [...theta], hk: Object.values(f.hk), drivmedel: f.drivmedel, varde: Object.values(f.varde), tau2, k, lambda };
}

export function calibrate(data = loadData(), { skipBacktest = false, lambda = AGE_LAMBDA } = {}) {
  const now = new Date();
  const rows = prepare(data, now);

  // 1) Krockfrekvens (ålder × effekt × drivmedel × bilvärde) + trovärdighet
  const fr = fitFrequency(rows, lambda);
  const perAldersband = fr.perAldersband;
  const snittFrekvens = sum(rows, r => r.krockar) / sum(rows, r => r.ar);

  // 2) Småskador (stöld/brand/glas) = kostnad för kunder utan krock, som andel av bilens värde, per drivmedel
  const zero = rows.filter(r => r.krockar === 0);
  const fuels = [...new Set(rows.map(r => r.car.drivmedel))];
  const perDrivmedelSma = {};
  for (const f of fuels) {
    const rs = zero.filter(r => r.car.drivmedel === f);
    perDrivmedelSma[f] = sum(rs, r => r.skadekostnad) / sum(rs, r => r.car.varde * r.ar);
  }
  const smaSnitt = sum(zero, r => r.skadekostnad) / sum(zero, r => r.car.varde * r.ar);

  // 3) Allvarlighet per krock: log(kostnad/krock) ~ a + b*log(värde), viktat med antal krockar
  const crash = rows.filter(r => r.krockar > 0).map(r => {
    const sma = perDrivmedelSma[r.car.drivmedel] * r.car.varde * r.ar;
    return { ...r, krockKostnad: Math.max(r.skadekostnad - sma, 1000 * r.krockar), };
  });
  let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const r of crash) {
    const w = r.krockar, x = Math.log(r.car.varde), y = Math.log(r.krockKostnad / r.krockar);
    sw += w; sx += w * x; sy += w * y; sxx += w * x * x; sxy += w * x * y;
  }
  const b = (sw * sxy - sx * sy) / (sw * sxx - sx * sx);
  const a = (sy - b * sx) / sw;
  const sev0 = r => Math.exp(a + b * Math.log(r.car.varde));

  // Residualfaktorer (hk, drivmedel) med krympning mot 1 när underlaget är litet
  const residual = (keyFn, keys, base) => {
    const out = {};
    for (const k of keys) {
      const rs = crash.filter(r => keyFn(r) === k);
      const n = sum(rs, r => r.krockar);
      if (!n) { out[k] = 1; continue; }
      const ratio = sum(rs, r => r.krockKostnad) / sum(rs, r => r.krockar * base(r));
      out[k] = clamp(1 + (ratio - 1) * (n / (n + 30)), 0.6, 2.0);
    }
    return out;
  };
  const hkF = residual(r => hpBand(r.car.hk), [0, 1, 2, 3, 4], sev0);
  const fuelF = residual(r => r.car.drivmedel, fuels, r => sev0(r) * hkF[hpBand(r.car.hk)]);

  const model = {
    version: 2,
    kalibrerad: now.toISOString(),
    underlag: { kundrader: rows.length, kundar: sum(rows, r => r.ar), krockar: sum(rows, r => r.krockar),
      total_skadekostnad: sum(rows, r => r.skadekostnad), total_premie: sum(rows, r => r.premie) },
    malSkadekvot: 0.70,          // 70 % av premien ska gå till skador, resten till drift, provision och vinst
    minPremie: 1990,
    trovardighet: { k: fr.k, tau2: fr.tau2 },  // Gamma-Poisson: k = 1/τ², skattat ur datan
    skala: 1,
    frekvens: { snitt: snittFrekvens, perAldersband, bandNamn: AGE_BANDS.map(x => x[2]),
      alderKnutar: fr.alderKnutar, alderLogF: fr.alderLogF, hk: fr.hk, drivmedel: fr.drivmedel, varde: fr.varde, hkNamn: HP_LABELS, vardeNamn: VALUE_LABELS },
    smaskador: { perDrivmedel: perDrivmedelSma, snitt: smaSnitt },
    allvar: { a, b, hk: hkF, drivmedel: fuelF, hkNamn: HP_LABELS },
    regionSnittIdx: 1,
  };

  // 4) Skala så att modellens förväntade kostnad matchar faktiskt utfall totalt (in-sample)
  const pred = rows.reduce((s, r) =>
    s + r.ar * price(model, { age: r.age, car: r.car, crashes: r.krockar, years: r.ar }).forvantad, 0);
  model.skala = clamp(model.underlag.total_skadekostnad / pred, 0.5, 2);

  if (!skipBacktest) model.backtest = backtest(model, rows);
  return model;
}

function backtest(model, rows) {
  const out = [];
  const add = (name, fn) => {
    const g = new Map();
    for (const r of rows) {
      const key = fn(r);
      const p = price(model, { age: r.age, car: r.car, crashes: r.krockar, years: r.ar }).pris;
      const x = g.get(key) || { n: 0, ar: 0, kostnad: 0, premieIdag: 0, premieNy: 0 };
      x.n++; x.ar += r.ar; x.kostnad += r.skadekostnad; x.premieIdag += r.premie; x.premieNy += p * r.ar;
      g.set(key, x);
    }
    out.push({ segment: name, rader: [...g].map(([k, x]) => ({
      grupp: k, n: x.n, premieIdagPerAr: Math.round(x.premieIdag / x.ar), premieNyPerAr: Math.round(x.premieNy / x.ar),
      skadekostnadPerAr: Math.round(x.kostnad / x.ar),
      skadekvotIdag: +(x.kostnad / x.premieIdag).toFixed(2), skadekvotNy: +(x.kostnad / x.premieNy).toFixed(2) })) });
  };
  add('Ålder', r => AGE_BANDS[ageBand(r.age)][2]);
  add('Drivmedel', r => r.car.drivmedel);
  add('Bilens värde', r => r.car.varde < 100000 ? '<100 tkr' : r.car.varde < 250000 ? '100–250 tkr' : r.car.varde < 500000 ? '250–500 tkr' : '500 tkr+');
  add('Krockar per år hos oss', r => { const f = r.krockar / r.ar; return f === 0 ? '0' : f < 0.25 ? '<0,25' : f < 0.5 ? '0,25–0,5' : '≥0,5'; });
  const tot = { skadekvotIdag: +(model.underlag.total_skadekostnad / model.underlag.total_premie).toFixed(2) };
  tot.skadekvotNy = +(model.underlag.total_skadekostnad / sum(rows, r =>
    price(model, { age: r.age, car: r.car, crashes: r.krockar, years: r.ar }).pris * r.ar)).toFixed(2);
  return { totalt: tot, segment: out };
}

export function loadModel() {
  if (!fs.existsSync(MODEL_FILE)) fs.writeFileSync(MODEL_FILE, JSON.stringify(calibrate(), null, 2));
  return JSON.parse(fs.readFileSync(MODEL_FILE, 'utf8'));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const m = calibrate();
  fs.writeFileSync(MODEL_FILE, JSON.stringify(m, null, 2));
  console.log('Skrev', MODEL_FILE);
  console.log('Frekvens/åldersband:', m.frekvens.perAldersband.map(x => x.toFixed(3)).join(' | '));
  console.log('Småskador (% av värde/år):', Object.fromEntries(Object.entries(m.smaskador.perDrivmedel).map(([k, v]) => [k, (v * 100).toFixed(2)])));
  console.log('Allvar: a=%s b=%s hk=%s drivmedel=%s', m.allvar.a.toFixed(2), m.allvar.b.toFixed(2), JSON.stringify(m.allvar.hk), JSON.stringify(m.allvar.drivmedel));
  console.log('Skala:', m.skala.toFixed(3), 'Skadekvot idag/ny:', m.backtest.totalt);
  for (const s of m.backtest.segment) { console.log('\n' + s.segment); console.table(s.rader); }
}
