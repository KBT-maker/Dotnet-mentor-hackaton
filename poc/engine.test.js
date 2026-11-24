import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePersonnummer, parseRegnummer, makePnr } from './lib.js';

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
