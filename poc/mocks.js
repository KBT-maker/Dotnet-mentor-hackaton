// MOCK-API:er som står i för externa källor. I produktion byts de mot riktiga integrationer:
//   SPAR (Skatteverket)        -> /mock/spar/person/:pnr
//   Transportstyrelsen         -> /mock/transportstyrelsen/fordon/:regnr
//   BRÅ / Larmtjänst           -> /mock/bra/stold/:lan
// Svaren är deterministiska så att demon blir repeterbar.
import { hash, makePnr } from './lib.js';

const ORTER = [
  { ort: 'Stockholm', lan: 'Stockholm', pn: '11421' }, { ort: 'Solna', lan: 'Stockholm', pn: '17141' },
  { ort: 'Göteborg', lan: 'Västra Götaland', pn: '41301' }, { ort: 'Borås', lan: 'Västra Götaland', pn: '50430' },
  { ort: 'Malmö', lan: 'Skåne', pn: '21120' }, { ort: 'Helsingborg', lan: 'Skåne', pn: '25220' },
  { ort: 'Uppsala', lan: 'Uppsala', pn: '75320' }, { ort: 'Linköping', lan: 'Östergötland', pn: '58219' },
  { ort: 'Örebro', lan: 'Örebro', pn: '70210' }, { ort: 'Karlstad', lan: 'Värmland', pn: '65224' },
  { ort: 'Umeå', lan: 'Västerbotten', pn: '90325' }, { ort: 'Östersund', lan: 'Jämtland', pn: '83131' },
  { ort: 'Luleå', lan: 'Norrbotten', pn: '97231' }, { ort: 'Jönköping', lan: 'Jönköping', pn: '55318' },
];
// Antagande: stöldrisk per län relativt rikssnitt. Påhittade, illustrativa siffror. Produktion: BRÅ-stölder ÷ fordonsbestånd (SCB/Trafikanalys) per län.
const STOLDINDEX = { Stockholm: 1.25, 'Västra Götaland': 1.12, Skåne: 1.30, Uppsala: 1.0, Östergötland: 0.95,
  Örebro: 0.95, Värmland: 0.75, Västerbotten: 0.70, Jämtland: 0.65, Norrbotten: 0.70, Jönköping: 0.85 };

// Demo-personer med särskilda egenskaper (giltiga personnummer)
export const DEMO = {
  skyddad: makePnr('19850214', '123'),
  avliden: makePnr('19410303', '456'),
  minderarig: makePnr('20100505', '789'),
};
// Bilar som inte får försäkras (hittas inte i bilar.csv, så vi hårdkodar fordonsstatus för demo)
export const DEMO_BILAR = { ASD123: 'avstalld', KOR456: 'korforbud' };

export function mockRouter(data) {
  return function handle(pathname) {
    let m;
    if ((m = pathname.match(/^\/mock\/spar\/person\/(\d{12})$/))) {
      const pnr = m[1];
      if (pnr === DEMO.avliden) return { status: 200, body: { personnummer: pnr, avliden: true } };
      const o = ORTER[hash(pnr) % ORTER.length];
      return { status: 200, body: { personnummer: pnr, avliden: false, skyddadIdentitet: pnr === DEMO.skyddad,
        folkbokford: pnr === DEMO.skyddad ? null : { postnummer: o.pn, ort: o.ort, lan: o.lan } } };
    }
    if ((m = pathname.match(/^\/mock\/transportstyrelsen\/fordon\/([A-Z0-9]{6})$/))) {
      const regnr = m[1];
      if (DEMO_BILAR[regnr]) return { status: 200, body: { regnummer: regnr, marke: 'Volvo', modell: 'V60', arsmodell: 2018,
        status: DEMO_BILAR[regnr] === 'avstalld' ? 'Avställd' : 'Påställd', korforbud: DEMO_BILAR[regnr] === 'korforbud' } };
      const b = data.bilar.get(regnr);
      if (!b) return { status: 404, body: { fel: 'Fordonet finns inte i fordonsregistret' } };
      return { status: 200, body: { ...b, effekt_hk: b.hk, status: 'Påställd', korforbud: false, besiktning: 'Godkänd' } };
    }
    if ((m = pathname.match(/^\/mock\/bra\/stold\/(.+)$/))) {
      const lan = decodeURIComponent(m[1]);
      return { status: 200, body: { lan, stoldindex: STOLDINDEX[lan] ?? 1.0, kalla: 'ANTAGANDE: påhittade illustrativa värden, inte verklig BRÅ-statistik' } };
    }
    return null;
  };
}
