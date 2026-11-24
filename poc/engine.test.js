import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePersonnummer, parseRegnummer, makePnr, loadData } from './lib.js';
import { loadModel } from './calibrate.js';
import { ageCurve, price } from './pricing.js';
import { monitor } from './monitor.js';
import http from 'node:http';
import { mockRouter } from './mocks.js';
import { createEngine } from './engine.js';

test('personnummer: giltigt, ogiltig kontrollsiffra, minderårig, samordning', () => {
  assert.equal(parsePersonnummer('200704042381').ok, true);
  assert.equal(parsePersonnummer('19900101-1235').fel, 'KONTROLLSIFFRA');
  assert.equal(parsePersonnummer(makePnr('20100505', '789'), new Date('2026-11-24')).alder, 16);
  assert.equal(parsePersonnummer(makePnr('19900161', '123')).samordning, true);
  assert.equal(parsePersonnummer('199013011234').fel, 'DATUM');
});
test('regnummer: gammalt och nytt format, förbjudna bokstäver', () => {
  assert.equal(parseRegnummer('abc 123').ok, true);
  assert.equal(parseRegnummer('ABC12D').ok, true);
  assert.equal(parseRegnummer('AVC123').ok, false);
});

test('ålderskurvan är jämn: ingen åldersskillnad om ett år ger mer än 15 % hopp i frekvensen', () => {
  const m = loadModel();
  for (let a = 18; a < 95; a++) assert.ok(Math.abs(ageCurve(m, a + 1) / ageCurve(m, a) - 1) < 0.15, `hopp vid ${a}`);
});
test('priset stiger med fler krockar och sjunker aldrig under minimipremien', () => {
  const m = loadModel(), car = { varde: 200000, hk: 150, drivmedel: 'bensin' };
  const p = c => price(m, { age: 40, car, crashes: c, years: 5 }).pris;
  assert.ok(p(0) <= p(1) && p(1) < p(3));
  assert.ok(p(0) >= m.minPremie);
});
test('övervakningen finner ingen avvikelse mot den data modellen kalibrerats på', () => {
  const r = monitor(loadModel(), loadData());
  assert.equal(r.ok, true, JSON.stringify(r.flaggade));
});

// Prismotorn mot mock-API:erna i processen
async function withEngine(fn) {
  const data = loadData(), mocks = mockRouter(data);
  const srv = http.createServer((req, res) => {
    const r = mocks(new URL(req.url, 'http://x').pathname);
    res.writeHead(r ? r.status : 404, { 'content-type': 'application/json' }); res.end(JSON.stringify(r ? r.body : {}));
  });
  await new Promise(ok => srv.listen(0, '127.0.0.1', ok));
  try { await fn(createEngine({ model: loadModel(), data, mockBase: `http://127.0.0.1:${srv.address().port}` }), data); }
  finally { srv.close(); }
}
const PNR = '199306292385', REG = 'FSE095';
test('ogiltigt antal krockar avvisas i stället för att ge fel pris', async () => {
  await withEngine(async e => {
    for (const k of [-3, 'abc', 2.5, 99]) {
      const r = await e.quote({ personnummer: PNR, regnummer: REG, krockar: k });
      assert.equal(r.utfall, 'AVSLAG', `krockar=${k}`); assert.equal(r.kod, 'OGILTIGT_KROCKAR'); assert.equal(r.pris, null);
    }
    for (const k of [0, 1, '2', null, '']) assert.equal((await e.quote({ personnummer: PNR, regnummer: REG, krockar: k })).utfall, 'PRIS');
  });
});
test('fler uppgivna krockar ger högre pris, och okänd historik är inte samma som noll krockar', async () => {
  await withEngine(async e => {
    const p = async k => (await e.quote({ personnummer: PNR, regnummer: REG, krockar: k })).pris;
    assert.ok(await p(0) < await p(1) && await p(1) < await p(2));
    assert.notEqual(await p(null), await p(0));
  });
});
test('kort kundhistorik får inte räknas som fem rena år', async () => {
  await withEngine(async (e, data) => {
    const per = new Map();
    for (const k of data.kunder) per.set(k.personnummer, [...(per.get(k.personnummer) || []), k]);
    const k = data.kunder.find(x => per.get(x.personnummer).length === 1 && x.ar === 1 && x.krockar === 0);
    const r = await e.quote({ personnummer: k.personnummer, regnummer: k.regnummer, krockar: null });
    assert.equal(r.utfall, 'PRIS');
    assert.equal(r.indata.histAr, 1);
    // en års ren historik ska ge lägre tilltro än fem års ren historik, alltså ett högre pris
    const fem = await e.quote({ personnummer: k.personnummer, regnummer: k.regnummer, krockar: 0 });
    assert.ok(r.pris >= fem.pris);
  });
});
