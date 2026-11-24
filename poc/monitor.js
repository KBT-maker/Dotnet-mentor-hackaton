// Löpande övervakning: jämför faktiskt utfall i försäkringsbeståndet mot vad modellen förväntade sig, per segment.
// Flaggar segment där modellen har glidit (ny kalibrering behövs) eller där utfallet avviker mer än slumpen förklarar.
//   node monitor.js     (avslutar med felkod 2 om något segment flaggas, så att det går att köra i ett schemalagt jobb)
import { fileURLToPath } from 'node:url';
import { loadData } from './lib.js';
import { loadModel, prepare } from './calibrate.js';
import { AGE_BANDS, HP_LABELS, VALUE_LABELS, ageBand, hpBand, valueBand, price } from './pricing.js';

export const LIMITS = { zKrockar: 3, kostnadAvvikelse: 0.25, minKunder: 30, skadekvotAvvikelse: 0.10 };

export function monitor(model = loadModel(), data = loadData(), limits = LIMITS) {
  const rows = prepare(data);
  // Förväntat utan egen historik (annars blir jämförelsen cirkulär). Priset med historik används för skadekvoten.
  const pred = rows.map(r => {
    const p = price(model, { age: r.age, car: r.car, crashes: null, years: r.ar });
    return { r, e: p.prior * r.ar, kostnad: p.forvantad * r.ar, premie: price(model, { age: r.age, car: r.car, crashes: r.krockar, years: r.ar }).pris * r.ar };
  });
  const tau2 = model.trovardighet.tau2 > 0 ? model.trovardighet.tau2 : 0;
  const segment = (namn, fn) => {
    const g = new Map();
    for (const x of pred) {
      const k = fn(x.r);
      const a = g.get(k) || { kunder: 0, krockar: 0, e: 0, skada: 0, kostnad: 0, res2: 0 };
      a.kunder++; a.krockar += x.r.krockar; a.e += x.e; a.skada += x.r.skadekostnad; a.kostnad += x.kostnad; a.res2 += (x.r.skadekostnad - x.kostnad) ** 2;
      g.set(k, a);
    }
    return [...g].map(([grupp, a]) => {
      const z = (a.krockar - a.e) / Math.sqrt(a.e * (1 + tau2 * a.e));      // överdispergerad Poisson
      const ae = a.skada / a.kostnad;
      const zKostnad = (a.skada - a.kostnad) / Math.sqrt(a.res2);   // skadekostnader är tungsvansade: kräv att avvikelsen är statistiskt säkerställd
      const flaggor = [];
      if (a.kunder >= limits.minKunder && Math.abs(z) > limits.zKrockar) flaggor.push(`antalet krockar avviker (z=${z.toFixed(1)})`);
      if (a.kunder >= limits.minKunder && Math.abs(ae - 1) > limits.kostnadAvvikelse && Math.abs(zKostnad) > limits.zKrockar) flaggor.push(`kostnaden är ${((ae - 1) * 100).toFixed(0)} % ${ae > 1 ? 'över' : 'under'} förväntat`);
      return { segment: namn, grupp: String(grupp), kunder: a.kunder, krockarFaktiskt: a.krockar, krockarForvantat: +a.e.toFixed(1), z: +z.toFixed(2), zKostnad: +zKostnad.toFixed(2), kostnadAE: +ae.toFixed(2), flaggor };
    });
  };
  const rader = [
    ...segment('Ålder', r => AGE_BANDS[ageBand(r.age)][2]),
    ...segment('Drivmedel', r => r.car.drivmedel),
    ...segment('Effekt', r => HP_LABELS[hpBand(r.car.hk)]),
    ...segment('Bilvärde', r => VALUE_LABELS[valueBand(r.car.varde)]),
  ];
  const skada = pred.reduce((s, x) => s + x.r.skadekostnad, 0), premie = pred.reduce((s, x) => s + x.premie, 0);
  const skadekvot = skada / premie;
  const totalFlaggor = [];
  if (Math.abs(skadekvot - model.malSkadekvot) > limits.skadekvotAvvikelse)
    totalFlaggor.push(`skadekvoten är ${skadekvot.toFixed(2)}, målet är ${model.malSkadekvot}`);
  const flaggade = rader.filter(r => r.flaggor.length);
  return { modellversion: model.version, kalibrerad: model.kalibrerad, skadekvot: +skadekvot.toFixed(3), malSkadekvot: model.malSkadekvot,
    totalFlaggor, flaggade, rader, ok: !flaggade.length && !totalFlaggor.length, gransvarden: limits };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = monitor();
  console.log(`Modell v${r.modellversion} (kalibrerad ${r.kalibrerad}) · skadekvot ${r.skadekvot} (mål ${r.malSkadekvot})`);
  console.table(r.rader.map(x => ({ segment: x.segment, grupp: x.grupp, kunder: x.kunder, krockar: `${x.krockarFaktiskt} / ${x.krockarForvantat}`, z: x.z, 'kostnad A/E': x.kostnadAE, flagga: x.flaggor.join('; ') || '' })));
  for (const t of r.totalFlaggor) console.log('FLAGGA:', t);
  console.log(r.ok ? 'OK: inga segment avviker mer än slumpen förklarar.' : `${r.flaggade.length} segment flaggade. Överväg ny kalibrering (node calibrate.js).`);
  process.exit(r.ok ? 0 : 2);
}
