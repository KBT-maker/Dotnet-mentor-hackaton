// Basbelopp och uppdelning av en premie i kronor per faktor.
//
// Basbelopp = prismotorns pris för en "typisk kund utan krockar": mediankundens ålder, bilvärde och hk,
// vanligaste drivmedlet, neutral ort (stöldindex 1,00) och 0 krockar de senaste 5 åren.
// Uppdelning = Shapley-värden: för varje faktor medelvärdet av dess effekt över alla ordningar i vilken
// faktorerna byts från referenskundens värde till personens. Summerar exakt till (premie - basbelopp).
import { parsePersonnummer } from './lib.js';
import { price } from './pricing.js';

export const FACTORS = [
  ['age', 'Ålder'], ['history', 'Skadehistorik'], ['value', 'Bilens värde'],
  ['hp', 'Motorstyrka'], ['fuel', 'Drivmedel'], ['region', 'Bostadsort'],
];

export function referenceCustomer(data, now = new Date()) {
  const median = a => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
  const ages = [], vals = [], hks = [];
  for (const k of data.kunder) {
    const car = data.bilar.get(k.regnummer), p = parsePersonnummer(k.personnummer, now);
    if (!car || !p.ok || p.alder < 18) continue;
    ages.push(p.alder); vals.push(car.varde); hks.push(car.hk);
  }
  const fuels = {};
  for (const c of data.bilar.values()) fuels[c.drivmedel] = (fuels[c.drivmedel] || 0) + 1;
  const drivmedel = Object.entries(fuels).sort((a, b) => b[1] - a[1])[0][0];
  return { age: median(ages), car: { varde: median(vals), hk: median(hks), drivmedel }, crashes: 0, years: 5, regionIdx: 1 };
}

function mix(ref, person, mask) {
  const use = i => (mask >> i) & 1;
  return {
    age: use(0) ? person.age : ref.age,
    crashes: use(1) ? person.crashes : ref.crashes,
    years: ref.years,
    car: { varde: use(2) ? person.car.varde : ref.car.varde, hk: use(3) ? person.car.hk : ref.car.hk,
      drivmedel: use(4) ? person.car.drivmedel : ref.car.drivmedel },
    regionIdx: use(5) ? person.regionIdx : ref.regionIdx,
  };
}

export function breakdown(model, ref, person) {
  const n = FACTORS.length, fact = [1, 1, 2, 6, 24, 120, 720];
  const v = Array.from({ length: 1 << n }, (_, m) => price(model, mix(ref, person, m)).pris);
  const delar = FACTORS.map(([, namn], i) => {
    let phi = 0;
    for (let m = 0; m < 1 << n; m++) {
      if ((m >> i) & 1) continue;
      let s = 0; for (let j = 0; j < n; j++) s += (m >> j) & 1;
      phi += fact[s] * fact[n - s - 1] / fact[n] * (v[m | (1 << i)] - v[m]);
    }
    return { namn, kr: Math.round(phi) };
  });
  // Avrundning: lägg resten på största posten så att summan blir exakt
  const total = v[(1 << n) - 1] - v[0];
  const rest = total - delar.reduce((s, x) => s + x.kr, 0);
  if (rest) delar.reduce((a, b) => (Math.abs(b.kr) > Math.abs(a.kr) ? b : a)).kr += rest;
  return { bas: v[0], premie: v[(1 << n) - 1], delar };
}
