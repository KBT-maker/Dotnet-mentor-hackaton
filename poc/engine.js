// Prismotorn: validerar, hämtar data från (mock-)API:er, bedömer risk, prissätter och förklarar.
import { parsePersonnummer, parseRegnummer } from './lib.js';
import { price, AGE_BANDS } from './pricing.js';
import { referenceCustomer, breakdown } from './base.js';

const kr = n => Math.round(n).toLocaleString('en-US') + ' kr';
const FUEL = { bensin: 'Petrol', diesel: 'Diesel', el: 'Electric', hybrid: 'Hybrid' };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const histText = (n, ar, r) => {
  const nn = Number.isInteger(n) ? n : +n.toFixed(1), period = ar === 5 ? 'the last five years' : `the last ${plural(Math.round(ar * 10) / 10, 'year')}`;
  return (nn === 0 ? `No crashes in ${period}.` : `${plural(nn, 'crash').replace('crashs', 'crashes')} in ${period}.`) +
    ` We expect a crash in about ${(r.freq * 100).toFixed(1)}% of years (your own history counts for ${Math.round(r.z * 100)}% of that estimate).`;
};
const pct = r => (r >= 1 ? '+' : '−') + Math.round(Math.abs(r - 1) * 100) + ' %';

export function createEngine({ model, data, mockBase }) {
  const ref = referenceCustomer(data);
  const kunderByPnr = new Map();
  const kunderByReg = new Map();
  for (const k of data.kunder) {
    (kunderByPnr.get(k.personnummer) || kunderByPnr.set(k.personnummer, []).get(k.personnummer)).push(k);
    (kunderByReg.get(k.regnummer) || kunderByReg.set(k.regnummer, []).get(k.regnummer)).push(k);
  }

  async function call(trace, api, url) {
    const t0 = performance.now();
    const res = await fetch(mockBase + url);
    const body = await res.json();
    trace.push({ api, url, status: res.status, ms: Math.round(performance.now() - t0) });
    return { status: res.status, body };
  }

  const nej = (utfall, kod, rubrik, meddelande, extra = {}) =>
    ({ utfall, kod, pris: null, rubrik, meddelande, ...extra });

  async function quote({ personnummer, regnummer, krockar = null }) {
    const trace = [];
    const done = r => ({ ...r, anrop: trace, modellversion: model.version });

    // 1. Validera indata
    const reg = parseRegnummer(regnummer);
    if (!reg.ok) return done(nej('AVSLAG', 'OGILTIGT_REGNR', "That license plate doesn't look right",
      'Swedish plates have three letters followed by three digits (ABC123), or three letters, two digits and a letter (ABC12D). Please check the plate and try again.'));
    const pn = parsePersonnummer(personnummer);
    if (!pn.ok) return done(nej('AVSLAG', 'OGILTIGT_PNR', "That personal ID number doesn't look right",
      { FORMAT: 'The personal ID number should have 10 or 12 digits, for example 19900101-1234.',
        DATUM: 'The birth date in the ID number is not a real date. Please check it and try again.',
        KONTROLLSIFFRA: 'The ID number looks like it has a typo (the last digit does not match). Please check the final digits.',
        FRAMTID: 'The birth date is in the future. Please check the ID number.' }[pn.fel]));
    if (pn.alder < 18) return done(nej('AVSLAG', 'FOR_UNG', 'You must be at least 18',
      'You need to be 18 to buy car insurance from us. A parent or guardian can buy the insurance for you.'));
    const pnr = pn.pnr12;
    const uppgivna = krockar == null || String(krockar).trim() === '' ? null : Number(krockar);
    if (uppgivna != null && (!Number.isInteger(uppgivna) || uppgivna < 0 || uppgivna > 50))
      return done(nej('AVSLAG', 'OGILTIGT_KROCKAR', "That number of crashes doesn't look right",
        'Please enter the number of crashes as a whole number from 0 and up, or leave the field empty if you are not sure.'));

    // 2. Hämta data från externa källor (parallellt)
    const [spar, fordon] = await Promise.all([
      call(trace, 'SPAR', `/mock/spar/person/${pnr}`),
      call(trace, 'Transportstyrelsen', `/mock/transportstyrelsen/fordon/${reg.regnr}`),
    ]);

    if (spar.body.avliden) return done(nej('AVSLAG', 'AVLIDEN', "We can't offer you insurance",
      'This ID number belongs to someone who cannot take out insurance. Please check that you typed it correctly.'));
    if (spar.body.skyddadIdentitet) return done(nej('MANUELL', 'SKYDDAD_IDENTITET', 'We need to help you personally',
      "We can't work out a price automatically right now. Please contact our customer service and an agent will help you. You don't need to share your address in advance."));
    if (fordon.status === 404) return done(nej('AVSLAG', 'OKANT_FORDON', "We can't find the car",
      `We couldn't find a car with plate ${reg.regnr} in the vehicle register. Please check the plate. If the car is newly registered, contact us and we will help you by hand.`));
    const f = fordon.body;
    if (f.status !== 'Påställd') return done(nej('AVSLAG', 'AVSTALLD', 'The car is deregistered',
      `Car ${reg.regnr} is currently taken off the road, so it can't be insured. Once it is back on the road you can apply again. Note that a car on the road must always have at least basic traffic insurance.`));
    if (f.korforbud) return done(nej('AVSLAG', 'KORFORBUD', 'The car has a driving ban',
      `Car ${reg.regnr} has a driving ban, so we can't insure it right now. Fix the issue behind the ban and apply again.`));

    const car = { regnummer: reg.regnr, marke: f.marke, modell: f.modell, arsmodell: f.arsmodell,
      varde: f.vardering_kr ?? f.varde, hk: f.effekt_hk, drivmedel: f.drivmedel };
    const bra = await call(trace, 'BRÅ', `/mock/bra/stold/${encodeURIComponent(spar.body.folkbokford.lan)}`);
    const regionIdx = bra.body.stoldindex;

    // 3. Skadehistorik: kombinera uppgiven historik och vår egen kundhistorik – ta den mest försiktiga.
    //    (GSR används inte: det är ett skaderegister för skadereglering och enligt en äldre källa inte avsett för att pröva nya kunder. Verifiera nuvarande regler.)
    const egna = kunderByPnr.get(pnr) || [];
    const egnaKrockar = egna.reduce((s, k) => s + k.krockar, 0);
    const egnaAr = egna.reduce((s, k) => s + k.ar, 0);
    // Varje källa anges som krockar + antal år den faktiskt täcker. Historik längre än 10 år räknas om till 10 år (inga avrundningar).
    const MAX_AR = 10;
    const kallor = [
      uppgivna != null && { kalla: 'Reported by you', antal: uppgivna, ar: 5 },
      egnaAr > 0 && { kalla: 'Our own customer records', antal: egnaAr > MAX_AR ? egnaKrockar * MAX_AR / egnaAr : egnaKrockar, ar: Math.min(egnaAr, MAX_AR) },
    ].filter(Boolean);
    // Försiktigast gäller: den källa som ger högst pris används. Kort historik får lägre tilltro via ar (trovärdighet), inte som "rena" år.
    const priceFor = k => price(model, { age: pn.alder, car, crashes: k.antal, years: k.ar, regionIdx }).raw;
    const vald = kallor.length ? kallor.reduce((best, k) => (priceFor(k) > priceFor(best) ? k : best)) : null;
    // Ingen uppgift alls -> okänd historik: prissätts på prior (inte som "0 krockar")
    const krockar5 = vald ? vald.antal : null;
    const histAr = vald ? vald.ar : 5;
    const egna5 = egnaAr > 0 ? egnaKrockar * 5 / egnaAr : 0;
    const avvikelse = uppgivna != null && egnaAr > 0 && Math.round(egna5) > uppgivna;

    // 4. Riskregler som kräver handläggare
    const hk = car.hk;
    const manuellt = [];
    const krockarPer5 = vald ? (vald.ar > 5 ? vald.antal * 5 / vald.ar : vald.antal) : null;   // jämförbart med "senaste fem åren"
    if (krockarPer5 != null && krockarPer5 >= 4) manuellt.push(`${Math.round(krockarPer5)} crashes in the last five years`);
    if (pn.alder < 25 && hk >= 300) manuellt.push(`the driver is under 25 and the car has ${hk} horsepower`);
    if (car.varde > 1000000) manuellt.push(`the car is worth more than 1,000,000 kr`);
    if ((kunderByReg.get(reg.regnr) || []).some(k => k.personnummer !== pnr)) manuellt.push('the car is already insured with us by someone else');
    const grund = { personnummer: pnr, alder: pn.alder, ort: spar.body.folkbokford.ort, lan: spar.body.folkbokford.lan, bil: car, krockar5, histAr, avvikelse,
      kallor: kallor.map(k => ({ ...k, antal: +k.antal.toFixed(1) })) };
    if (manuellt.length) return done(nej('MANUELL', 'RISKGRANSKNING', 'An agent needs to look at your application',
      "We can't give you a price straight away. This is because " + manuellt.join(' and ') +
      '. We will get back to you within two working days.', { indata: grund, skalForManuell: manuellt }));

    // 5. Prissättning
    const r = price(model, { age: pn.alder, car, crashes: krockar5, years: histAr, regionIdx });
    const utan = krockar5 > 0 ? price(model, { age: pn.alder, car, crashes: 0, years: histAr, regionIdx }).pris : null;
    const bd = breakdown(model, ref, { age: pn.alder, car, crashes: krockar5, years: histAr, regionIdx });
    const snitt = model.frekvens.snitt;
    const drivare = [
      { namn: 'Age', text: `You are ${pn.alder}. Drivers in your age group have a crash in about ${(r.ageFreq * 100).toFixed(1)}% of years, compared with ${(snitt * 100).toFixed(1)}% for all drivers.`, faktor: r.ageFreq / snitt },
      { namn: 'Crash history', text: krockar5 == null ? 'No crash history given, so we assume the average for your age group.' : histText(krockar5, histAr, r), faktor: r.freq / r.prior },
      { namn: 'Car value', text: `A car worth ${kr(car.varde)} costs about ${kr(r.sev)} to repair after a crash, plus about ${kr(r.smaskador)} a year for theft, fire and glass damage.`, faktor: null },
      { namn: 'Engine power', text: `${hk} horsepower`, faktor: r.hpF * r.fqHk },
      { namn: 'Fuel type', text: FUEL[car.drivmedel] || car.drivmedel, faktor: r.fuelF * r.fqFuel },
      { namn: 'Where you live', text: `${spar.body.folkbokford.ort} (${spar.body.folkbokford.lan}): theft risk is ${regionIdx.toFixed(2)}× the national average (an estimate, not based on real data).`, faktor: regionIdx },
    ];
    const meddelande = `Your yearly price is ${kr(r.pris)}.` +
      (utan && utan < r.pris ? ` With a clean crash record it would have been ${kr(utan)}.` : '') +
      (avvikelse ? ' Note: our own records show more crashes than you reported, so the price is based on those.' : '');
    return done({ utfall: 'PRIS', kod: 'PRIS', pris: r.pris, rubrik: `Your yearly price: ${kr(r.pris)}`, meddelande,
      indata: grund, drivare,
      bas: { pris: bd.bas, kund: { alder: ref.age, varde: ref.car.varde, hk: ref.car.hk, drivmedel: ref.car.drivmedel } },
      uppdelning: bd.delar,
      uppbyggnad: { krockkostnad: Math.round(r.krockkostnad), smaskador: Math.round(r.smaskador), forvantadKostnad: Math.round(r.forvantad),
        malSkadekvot: model.malSkadekvot, ratPris: Math.round(r.raw), minPremie: model.minPremie, minAvgransad: r.minAvgransad },
      utanKrockar: utan });
  }
  return { quote };
}
