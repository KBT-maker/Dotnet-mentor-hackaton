import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePersonnummer, parseRegnummer, makePnr, loadData } from './lib.js';
import { loadModel } from './calibrate.js';
import { ageCurve, price } from './pricing.js';
import { monitor } from './monitor.js';

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
