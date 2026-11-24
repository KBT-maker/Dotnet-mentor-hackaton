# Prismotor PoC – Nordisk Bilförsäkring

Zero-dependency Node 22 (ESM). Inga `npm install` behövs.

```
node calibrate.js   # kalibrerar modellen mot ../kunder.csv + ../bilar.csv -> faktorer.json (+ bakåttest)
node server.js      # http://localhost:3000   (PORT=... för annan port)
node validate.js    # korsvalidering (ut-av-urval) + val av utjämning av ålderskurvan
node monitor.js     # övervakning: faktiskt utfall mot modellen per segment (felkod 2 vid avvikelse)
node --test         # enhetstester
```

| Fil | Roll |
|---|---|
| `pricing.js` | Prismodellen (frekvens × allvarlighet + småskador) ÷ målskadekvot |
| `calibrate.js` | Lär faktorerna från historiken, skriver `faktorer.json` |
| `engine.js` | Validering → API-anrop → riskregler → pris + förklaring, eller avslag/manuell granskning |
| `mocks.js` | Mock-API:er: SPAR, Transportstyrelsen, BRÅ (stöldindex är ett antagande) (`/mock/...`) |
| `server.js` | `/api/quote`, `/api/batch`, `/api/model`, `/api/monitor`, `/api/demo`, `/api/ansokningar` + statiska filer |
| `public/index.html` | Webbgränssnitt |

`GET /api/quote?personnummer=199306292385&regnummer=FSE095&krockar=2`
