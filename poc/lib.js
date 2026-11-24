// Gemensamma hjälpfunktioner: CSV, personnummer, regnummer.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.DATA_DIR || path.join(here, '..');

export function readCsv(file) {
  const text = fs.readFileSync(path.join(DATA_DIR, file), 'utf8').replace(/^﻿/, '');
  const [head, ...lines] = text.split(/\r?\n/).filter(Boolean);
  const cols = head.split(',');
  return lines.map(l => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v])));
}

export function loadData() {
  const bilar = new Map(readCsv('bilar.csv').map(r => [r.regnummer, {
    regnummer: r.regnummer, marke: r.marke, modell: r.modell, arsmodell: +r.arsmodell,
    varde: +r.vardering_kr, drivmedel: r.drivmedel, hk: +r.effekt_hk,
  }]));
  const kunder = readCsv('kunder.csv').map(r => ({
    personnummer: r.personnummer, regnummer: r.regnummer, ar: +r.antal_ar_forsakrad,
    krockar: +r.antal_krockar, skadekostnad: +r.total_skadekostnad_kr, premie: +r.total_premie_kr,
  }));
  const ansokningar = readCsv('ansokningar.csv').map(r => ({
    id: +r.ansokan_id, personnummer: r.personnummer, regnummer: r.regnummer,
    krockar: +r.antal_krockar_senaste_5_ar,
  }));
  return { bilar, kunder, ansokningar };
}

// ---------- Personnummer ----------
function luhnOk(d10) {
  let s = 0;
  for (let i = 0; i < 10; i++) {
    let d = +d10[i] * (i % 2 === 0 ? 2 : 1);
    s += d > 9 ? d - 9 : d;
  }
  return s % 10 === 0;
}
export function luhnCheckDigit(d9) {
  for (let c = 0; c < 10; c++) if (luhnOk(d9 + c)) return c;
}

/** Bygger ett giltigt personnummer (12 siffror) från födelsedatum YYYYMMDD och 3-siffrigt löpnummer. */
export function makePnr(yyyymmdd, seq3) {
  return yyyymmdd + seq3 + luhnCheckDigit(yyyymmdd.slice(2) + seq3);
}

/** Tolkar personnummer. Returnerar {ok, pnr12, fodelse, alder, samordning} eller {ok:false, fel}. */
export function parsePersonnummer(input, now = new Date()) {
  const raw = String(input ?? '').trim();
  const plus = raw.includes('+');
  const d = raw.replace(/\D/g, '');
  let pnr12;
  if (d.length === 12) pnr12 = d;
  else if (d.length === 10) {
    const yy = +d.slice(0, 2), mm = +d.slice(2, 4), dd = +d.slice(4, 6);
    let century = Math.floor(now.getFullYear() / 100) * 100;
    let year = century + yy;
    if (year > now.getFullYear()) year -= 100;
    if (plus) year -= 100;
    pnr12 = String(year) + d.slice(2);
    void mm; void dd;
  } else return { ok: false, fel: 'FORMAT' };

  const y = +pnr12.slice(0, 4), m = +pnr12.slice(4, 6);
  let day = +pnr12.slice(6, 8);
  const samordning = day > 60;
  if (samordning) day -= 60;
  const fodelse = new Date(Date.UTC(y, m - 1, day));
  if (fodelse.getUTCFullYear() !== y || fodelse.getUTCMonth() !== m - 1 || fodelse.getUTCDate() !== day)
    return { ok: false, fel: 'DATUM' };
  if (!luhnOk(pnr12.slice(2))) return { ok: false, fel: 'KONTROLLSIFFRA' };

  let alder = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < day)) alder--;
  if (alder < 0) return { ok: false, fel: 'FRAMTID' };
  return { ok: true, pnr12, fodelse: fodelse.toISOString().slice(0, 10), alder, samordning };
}

// ---------- Regnummer ----------
// Gamla formatet ABC123, nya ABC12D. Bokstäverna I, Q, V, Å, Ä, Ö används inte.
export function parseRegnummer(input) {
  const r = String(input ?? '').toUpperCase().replace(/[\s-]/g, '');
  const ok = /^[A-HJ-PR-UW-Z]{3}\d{2}[0-9A-HJ-PR-UW-Z]$/.test(r);
  return ok ? { ok: true, regnr: r } : { ok: false, fel: 'FORMAT' };
}

export function hash(str) {
  let h = 2166136261;
  for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
