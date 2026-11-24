// Prismodell: förväntad skadekostnad = frekvens × allvarlighet + småskador, delat med målskadekvot.
export const AGE_BANDS = [[18, 24, '18–24 år'], [25, 29, '25–29 år'], [30, 49, '30–49 år'],
  [50, 64, '50–64 år'], [65, 79, '65–79 år'], [80, 200, '80+ år']];
export const ageBand = a => AGE_BANDS.findIndex(([lo, hi]) => a >= lo && a <= hi);
export const HP_LABELS = ['<100 hk', '100–199 hk', '200–299 hk', '300–399 hk', '400+ hk'];
export const hpBand = hk => hk < 100 ? 0 : hk < 200 ? 1 : hk < 300 ? 2 : hk < 400 ? 3 : 4;

/**
 * @param m   kalibrerad modell (faktorer.json)
 * @param inp {age, car:{varde,hk,drivmedel}, crashes, years, regionIdx}
 *   crashes/years = observerade krockar under `years` år (null = okänt -> bara åldersprior)
 */
export function price(m, { age, car, crashes = null, years = 5, regionIdx = 1 }) {
  const ab = ageBand(age);
  const prior = m.frekvens.perAldersband[ab];
  let z = 0, own = 0;
  if (crashes != null && years > 0) { z = years / (years + m.trovardighetK); own = crashes / years; }
  const freq = z * own + (1 - z) * prior;

  const hpF = m.allvar.hk[hpBand(car.hk)];
  const fuelF = m.allvar.drivmedel[car.drivmedel] ?? 1;
  const sev = Math.exp(m.allvar.a) * Math.pow(car.varde, m.allvar.b) * hpF * fuelF;
  const attr = (m.smaskador.perDrivmedel[car.drivmedel] ?? m.smaskador.snitt) * car.varde * regionIdx;

  const krockkostnad = m.skala * freq * sev;
  const smaskador = m.skala * attr;
  const forvantad = krockkostnad + smaskador;
  const raw = forvantad / m.malSkadekvot;
  const pris = Math.round(Math.max(m.minPremie, raw));
  return { ab, prior, z, own, freq, sev, hpF, fuelF, attr, krockkostnad, smaskador, forvantad, raw, pris, minAvgransad: raw < m.minPremie };
}
