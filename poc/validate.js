// Korsvalidering: tränar på 80 % av kunderna och mäter på de övriga 20 % (aldrig sedda av modellen).
// Kunden hålls alltid samman (hash på personnummer). Ingen tidsdimension finns i datan, så det här är
// den striktaste ut-av-urval-testen som går att göra; med daterade skador bör den bytas mot "träna på äldre år, testa på nyare".
//   node validate.js            jämför ålderskurvans utjämning (λ) och visar träffsäkerhet
import { fileURLToPath } from 'node:url';
import { loadData, hash } from './lib.js';
import { calibrate, prepare, AGE_LAMBDA } from './calibrate.js';
import { price } from './pricing.js';

const poissonDev = (y, mu) => 2 * ((y > 0 ? y * Math.log(y / mu) : 0) - (y - mu));

export function crossValidate(data = loadData(), { folds = 5, lambda = AGE_LAMBDA } = {}) {
  const all = prepare(data);
  let dev = 0, devSnitt = 0, n = 0;
  const pts = [];
  for (let f = 0; f < folds; f++) {
    const inFold = r => hash(r.personnummer) % folds === f;
    const test = all.filter(inFold), train = all.filter(r => !inFold(r));
    const m = calibrate({ ...data, kunder: train }, { skipBacktest: true, lambda });
    for (const r of test) {
      const p = price(m, { age: r.age, car: r.car, crashes: null, years: r.ar });
      dev += poissonDev(r.krockar, p.prior * r.ar);
      devSnitt += poissonDev(r.krockar, m.frekvens.snitt * r.ar);
      n++;
      pts.push({ pred: p.forvantad * r.ar, act: r.skadekostnad });
    }
  }
  pts.sort((a, b) => a.pred - b.pred);
  const sz = Math.ceil(pts.length / 10);
  const deciler = Array.from({ length: 10 }, (_, i) => {
    const g = pts.slice(i * sz, (i + 1) * sz);
    return +(g.reduce((s, x) => s + x.act, 0) / g.reduce((s, x) => s + x.pred, 0)).toFixed(2);
  });
  return { deviansModell: dev / n, deviansSnitt: devSnitt / n, deciler, n };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const data = loadData();
  console.log('Utjämning av ålderskurvan (λ), 5-delad korsvalidering. Lägre Poisson-deviance = bättre.');
  for (const lambda of [0, 5, 20, 40, 100, 300, 1000]) {
    const r = crossValidate(data, { lambda });
    console.log(`λ=${String(lambda).padEnd(5)} deviance ${r.deviansModell.toFixed(4)}  (bara snittfrekvens: ${r.deviansSnitt.toFixed(4)})${lambda === AGE_LAMBDA ? '  <- vald' : ''}`);
  }
  const r = crossValidate(data);
  console.log('\nFaktisk/förväntad skadekostnad per decil av förutsagd kostnad (1.00 = perfekt):', r.deciler.join(' '));
}
