# Dotnet Mentor Hackathon: Prissättning av bilförsäkring

Dotnet Mentor har fått ett nytt uppdrag. Försäkringsbolaget Nordisk Bilförsäkring AB vill ha en lösning som räknar fram vad en bilförsäkring ska kosta, och har anlitat oss för att ta fram den. Under hackathonet är er grupp konsultteamet som ska leverera lösningen.

Uppdraget är enkelt att beskriva men svårt att lösa väl. En kund anger registreringsnumret på sin bil och sitt personnummer och får tillbaka ett pris på sin försäkring. Hur ni kommer fram till det priset, och hur väl ni kan stå för det, är det som avgör.

Hackathonet handlar inte om vem som skriver mest kod. Det handlar om vem som löser rätt problem på rätt sätt.

## Produkten som ska prissättas

Nordisk Bilförsäkring säljer en enda bilförsäkring till privatpersoner: en helförsäkring för personbil. Den täcker skador som bilen orsakar andra i trafiken, skador på den egna bilen vid krock samt stöld, brand och glasskador.

Priset anges som en årspremie i hela kronor, alltså det kunden betalar för ett års försäkring.

## Uppdraget

Bygg en lösning som tar emot två inparametrar och lämnar tillbaka en utparameter.

```
In:  regnummer      bilens svenska registreringsnummer
In:  personnummer   personnumret för den som vill teckna försäkringen
Ut:  pris           årspremien i hela kronor
```

Går det inte att lämna ett pris, eller bör bolaget inte göra det, ska lösningen säga det och förklara varför på ett sätt som en kund förstår.

Hur ni bygger lösningen bestämmer ni själva. Ni väljer fritt programmeringsspråk, ramverk, databas och verktyg. Lösningen kan vara helt terminalbaserad, ha ett grafiskt gränssnitt, vara en webbsida eller något helt annat. Det viktiga är att den fungerar och att ni kan stå för den.

### Vad bolaget förväntar sig

Nordisk Bilförsäkring har inte beställt ett program. De har beställt en lösning på ett problem, och de förväntar sig en färdig produkt och ett färdigt tänk. Ni ansvarar för helheten, till exempel:

* **Riskanalys**: vad gör en kund dyr eller billig att försäkra, och hur vet ni det?
* **Prismodell**: hur blir riskanalysen ett pris i kronor?
* **Teknik**: en lösning som fungerar, går att lita på och går att bygga vidare på.
* **Verklighet**: lösningen ska klara att användas av riktiga kunder, i ett riktigt försäkringsbolag, i Sverige i dag.
* **Förklaring**: ni ska kunna förklara varför en viss person med en viss bil får ett visst pris.

Listan är inte komplett. Att själva komma på vad mer som behövs är en del av uppdraget.

## Data från Nordisk Bilförsäkring

Bolaget har lämnat över tre datafiler. Alla är kommaseparerade textfiler med en rubrikrad, och alla belopp anges i hela kronor.

### bilar.csv

Ett utdrag ur fordonsregistret, kompletterat med en aktuell marknadsvärdering av varje bil.

* `regnummer`: bilens registreringsnummer, till exempel ABC123 eller ABC12D
* `marke`: bilens märke
* `modell`: bilens modell
* `arsmodell`: bilens årsmodell
* `vardering_kr`: bilens uppskattade marknadsvärde i dag
* `drivmedel`: bensin, diesel, el eller hybrid
* `effekt_hk`: motorns effekt i hästkrafter

### kunder.csv

Ett utdrag ur bolagets kundregister. Varje rad är en bil som bolaget försäkrar i dag och visar hur försäkringen har gått sedan den tecknades. En kund med flera försäkrade bilar finns på flera rader. Uppgifter om bilen finns i bilar.csv och hittas via regnumret.

* `personnummer`: kundens personnummer, tolv siffror
* `regnummer`: registreringsnumret på den försäkrade bilen
* `antal_ar_forsakrad`: hur många hela år bilen har varit försäkrad hos bolaget
* `antal_krockar`: hur många krockar kunden har orsakat med bilen under den tiden
* `total_skadekostnad_kr`: allt bolaget har betalat ut i ersättning för skador på försäkringen under den tiden. Alla skador är inte krockar, även stöld, brand och glasskador ingår.
* `total_premie_kr`: allt kunden har betalat till bolaget för försäkringen under den tiden

### ansokningar.csv

Personer som har ansökt om bilförsäkring hos bolaget och väntar på ett pris. Uppgifterna har fyllts i av de sökande själva. Uppgifter om bilen finns i bilar.csv och hittas via regnumret.

* `ansokan_id`: ansökans nummer
* `personnummer`: den sökandes personnummer, tolv siffror
* `regnummer`: registreringsnumret på bilen som ska försäkras
* `antal_krockar_senaste_5_ar`: hur många krockar den sökande själv har orsakat de senaste fem åren, enligt egen uppgift

## Redovisning

När tiden är slut redovisar varje grupp sin lösning för juryn och de andra grupperna. Redovisningen ska svara på följande frågor.

* Hur förstod ni problemet, och vad behöver bolaget egentligen?
* Vad påverkar priset, och hur vet ni det?
* Hur räknar er prismodell, och varför ser den ut som den gör?
* Hur fungerar lösningen tekniskt?

### Livetest

Redovisningen avslutas med ett livetest.

1. Ni går med i mötet och delar er skärm och visar er lösning.
2. Ni förklarar hur er prismotor fungerar.
3. Juryn ger er några olika exempel på personnummer och regnummer. Alla grupper får samma exempel.
4. Ni kör varje exempel i er lösning och visar resultatet.
5. Ni förklarar för varje exempel varför priset blev som det blev, eller varför lösningen inte lämnade något pris.

Exemplen kan innehålla personer och bilar som inte finns i någon av datafilerna. Se till att er lösning är redo att köras när det är er tur.

## Regler

1. Den enda LLM ni får använda är det abonnemang ni fått tillgång till via oss hos Anthropic.
2. Ni väljer fritt programmeringsspråk, ramverk och tekniker.
3. Ni får söka information på webben, till exempel dokumentation eller fakta om försäkring.

## Bedömning

Det finns inget enskilt rätt svar, men det finns bättre och sämre sätt att komma fram till ett. Juryn bedömer tre saker.

1. **Hur ni har tolkat problemet.** Har ni förstått vad bolaget egentligen behöver, och inte bara vad som står i uppdraget?
2. **Hur ni har tänkt kring helheten i er problemlösning.** Hänger riskanalys, prismodell, teknik och förklaring ihop till något som bolaget faktiskt kan använda?
3. **Om ni har fått med alla aspekter som behövs.** Har ni tänkt på allt som krävs för att lösningen ska fungera för bolaget på riktigt?

Lycka till!
