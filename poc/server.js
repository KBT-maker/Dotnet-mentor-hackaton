import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadData, makePnr } from './lib.js';
import { loadModel } from './calibrate.js';
import { createEngine } from './engine.js';
import { mockRouter, DEMO } from './mocks.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = +process.env.PORT || 3000;
const data = loadData();
const model = loadModel();
const mocks = mockRouter(data);
const engine = createEngine({ model, data, mockBase: `http://127.0.0.1:${PORT}` });

const demoCases = [
  { namn: 'Protected identity', personnummer: DEMO.skyddad, regnummer: data.ansokningar[0].regnummer },
  { namn: 'Under 18', personnummer: DEMO.minderarig, regnummer: data.ansokningar[1].regnummer },
  { namn: 'Mistyped ID number', personnummer: '199001011235', regnummer: data.ansokningar[2].regnummer },
  { namn: 'Car does not exist', personnummer: makePnr('19900101', '234'), regnummer: 'ZZZ999' },
  { namn: 'Deregistered car', personnummer: makePnr('19900101', '234'), regnummer: 'ASD123' },
  { namn: 'Car with driving ban', personnummer: makePnr('19900101', '234'), regnummer: 'KOR456' },
  { namn: 'Unknown person, known car', personnummer: makePnr('19880808', '345'), regnummer: data.ansokningar[3].regnummer },
];

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/mock/')) {
      const r = mocks(url.pathname);
      return r ? json(res, r.status, r.body) : json(res, 404, { fel: 'okänd mock-endpoint' });
    }
    if (url.pathname === '/api/quote') {
      const q = url.searchParams;
      return json(res, 200, await engine.quote({ personnummer: q.get('personnummer'), regnummer: q.get('regnummer'), krockar: q.get('krockar') }));
    }
    if (url.pathname === '/api/ansokningar') return json(res, 200, data.ansokningar);
    if (url.pathname === '/api/demo') return json(res, 200, demoCases);
    if (url.pathname === '/api/model') return json(res, 200, model);
    if (url.pathname === '/api/batch') {
      const out = [];
      for (const a of data.ansokningar) {
        const r = await engine.quote({ personnummer: a.personnummer, regnummer: a.regnummer, krockar: a.krockar });
        out.push({ id: a.id, personnummer: a.personnummer, regnummer: a.regnummer, krockar: a.krockar, utfall: r.utfall, kod: r.kod, pris: r.pris,
          bil: r.indata ? `${r.indata.bil.marke} ${r.indata.bil.modell} ${r.indata.bil.arsmodell}` : null, alder: r.indata?.alder ?? null, avvikelse: !!r.indata?.avvikelse });
      }
      return json(res, 200, out);
    }
    const file = path.join(here, 'public', url.pathname === '/' ? 'index.html' : url.pathname);
    if (file.startsWith(path.join(here, 'public')) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
      return res.end(fs.readFileSync(file));
    }
    json(res, 404, { fel: 'hittades inte' });
  } catch (e) { console.error(e); json(res, 500, { fel: 'internt fel' }); }
}).listen(PORT, () => console.log(`Nordisk Bilförsäkring pricing: http://localhost:${PORT}`));
