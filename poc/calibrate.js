// Kalibrerar prismodellen mot kunder.csv + bilar.csv och skriver faktorer.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadData, parsePersonnummer } from './lib.js';
import { AGE_BANDS, HP_LABELS, VALUE_LABELS, ageBand, hpBand, valueBand, price } from './pricing.js';

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

/**
 * Poisson-frekvens med multiplikativa faktorer (ålder × effekt × drivmedel × bilvärde), anpassad med
 * iterativ skalning. Varje faktor krymps mot 1 när underlaget är litet. Tar sedan fram trovärdighetsparametern k
 * (Gamma-Poisson) med momentmetoden: τ² = Σ[(Y−e)²−e] / Σe², k = 1/τ².
 */
function fitFrequency(rows) {
  const dims = {
    alder: { of: r => ageBand(r.age), n: AGE_BANDS.length },
    hk: { of: r => hpBand(r.car.hk), n: HP_LABELS.length },
    drivmedel: { of: r => r.car.drivmedel, keys: [...new Set(rows.map(r => r.car.drivmedel))] },
    varde: { of: r => valueBand(r.car.varde), n: VALUE_LABELS.length },
  };
  const levels = d => d.keys ?? [...Array(d.n).keys()];
  const f = Object.fromEntries(Object.entries(dims).map(([k, d]) => [k, Object.fromEntries(levels(d).map(l => [l, 1]))]));
  const total = sum(rows, r => r.krockar) / sum(rows, r => r.ar);
  const mu = r => r.ar * total * Object.entries(dims).reduce((p, [k, d]) => p * f[k][d.of(r)], 1);
  for (let it = 0; it < 50; it++) {
    for (const [k, d] of Object.entries(dims)) {
      for (const l of levels(d)) {
        const rs = rows.filter(r => d.of(r) === l);
        if (!rs.length) continue;
        const obs = sum(rs, r => r.krockar);
        const exp = sum(rs, r => mu(r) / f[k][l]);       // förväntat om denna faktor vore 1
        const raw = obs / exp;
        // krympning enligt förväntat antal krockar: stabilt även för små nivåer
        f[k][l] = 1 + (raw - 1) * (obs / (obs + K_SHRINK));
      }
    }
  }
  // Åldersfaktorn bär bas-nivån så att frekvensen per åldersband är direkt tolkbar.
  const perAldersband = Object.values(f.alder).map(x => x * total);
  const prior = r => perAldersband[ageBand(r.age)] * f.hk[hpBand(r.car.hk)] * f.drivmedel[r.car.drivmedel] * f.varde[valueBand(r.car.varde)];
  // Normalisera så att totalt förväntat antal krockar = observerat
  const norm = sum(rows, r => r.krockar) / sum(rows, r => r.ar * prior(r));
  const pa = perAldersband.map(x => x * norm);
  const prior2 = r => pa[ageBand(r.age)] * f.hk[hpBand(r.car.hk)] * f.drivmedel[r.car.drivmedel] * f.varde[valueBand(r.car.varde)];
  const num = sum(rows, r => { const e = r.ar * prior2(r); return (r.krockar - e) ** 2 - e; });
  const den = sum(rows, r => (r.ar * prior2(r)) ** 2);
  const tau2 = num / den;
  const k = tau2 > 0.01 ? clamp(1 / tau2, 1, 100) : 100;
  return { perAldersband: pa, hk: Object.values(f.hk), drivmedel: f.drivmedel, varde: Object.values(f.varde), tau2, k };
}

export function calibrate(data = loadData(), { skipBacktest = false } = {}) {
  const now = new Date();
  const rows = prepare(data, now);

  // 1) Krockfrekvens (ålder × effekt × drivmedel × bilvärde) + trovärdighet
  const fr = fitFrequency(rows);
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
      hk: fr.hk, drivmedel: fr.drivmedel, varde: fr.varde, hkNamn: HP_LABELS, vardeNamn: VALUE_LABELS },
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
