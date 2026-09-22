# StockAgent

Daglige aksjenyheter og sluttkurser for Oslo Børs. Aksjene velges i
[`lib/watchlist.ts`](lib/watchlist.ts). Appen viser lagrede nyhetsrapporter,
kildelenker, mulige rykter, kildefeil og et arkiv med de siste 30 rapportdatoene.

## Hvordan det fungerer

1. GitHub Actions starter innhentingen hver dag kl. **09.00 Europe/Oslo**, også i helger.
2. Jobben søker etter hvert selskaps navn og aliaser i norske og internasjonale Google News RSS-feeder.
3. Treff avgrenses på publiseringstid, dubletter fjernes, og overskrifter med rykteord merkes som **mulig rykte – ubekreftet**.
4. Groq lager en norsk oppsummering med nummererte kilder. Uten Groq eller ved AI-feil beholdes overskriftene.
5. Rapporter og kjørestatus lagres i Supabase. Appen leser disse uten å starte en ny innhenting.
6. Med godkjent Reddit-tilgang og `REDDIT_ENABLED=true` søker samme jobb også etter foruminnlegg. De vises separat som ubekreftede diskusjoner.

Selskapsmeldinger merkes ut fra kjente meldingsdistributører. Klassifiseringen
er en enkel regel basert på overskrift og kilde, ikke en faktasjekk. Google News
er en søkeindeks: dette gir ikke full dekning av NewsWeb, alle nettsider, sosiale
medier eller lukkede forum. AI-en leser overskrifter, ikke artiklenes fulltekst.

## Første oppsett

Krever **Node.js 24** og et Supabase-prosjekt.

```powershell
npm ci
if (!(Test-Path .env.local)) { Copy-Item .env.example .env.local }
```

Har du allerede `.env.local`, behold den og legg bare til eventuelle nye variabler.

**`CRON_SECRET` er valgfri for det vanlige oppsettet.** Den daglige GitHub-jobben
og `npm run news:daily` bruker den ikke. Nøkkelen beskytter HTTP-endepunktene
hvis du vil starte jobbene gjennom en ekstern scheduler eller et API-kall.
Dette er en hemmelighet du lager selv, ikke en nøkkel du får fra en leverandør.

| Variabel                    | Bruk                                                      |
| --------------------------- | --------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`  | URL til Supabase-prosjektet; nødvendig for nyheter        |
| `SUPABASE_SERVICE_ROLE_KEY` | Hemmelig servernøkkel; nødvendig for nyheter              |
| `GROQ_API_KEY`              | Valgfri AI-oppsummering                                   |
| `GROQ_MODEL`                | Valgfri modell; standard `openai/gpt-oss-20b`             |
| `EODHD_API_KEY`             | Sluttkurser og historikk; nyhetsjobben fungerer uten      |
| `EODHD_NEWS_ENABLED`        | Sett `true` for ekstra nyhetskilde fra EODHD; standard av |
| `REDDIT_ENABLED`            | Standard `false`; aktiver først etter godkjent gratis API-tilgang |
| `REDDIT_CLIENT_ID`          | Klient-ID til den godkjente Reddit-appen                  |
| `REDDIT_CLIENT_SECRET`      | Hemmelig klientnøkkel til Reddit-appen                    |
| `REDDIT_USER_AGENT`         | `server:stockagent:v1.0 (by /u/ditt_reddit_brukernavn)`     |
| `REDDIT_SUBREDDITS`         | Kommadelt liste; standard `aksjer,SalmonEvolution`        |
| `CRON_SECRET`               | Tilfeldig streng på minst 32 tegn, kun for HTTP-jobbene   |

Ikke legg service role-nøkkelen i en variabel med `NEXT_PUBLIC_`-prefiks.
Den vanlige anon-nøkkelen brukes ikke til denne serverintegrasjonen.

AI-en kjører fortsatt hos Groq med `GROQ_API_KEY`; ingen OpenAI API-nøkkel er
nødvendig. Modellvalget deles av nyhets- og kursoppsummeringene via `lib/groq.ts`.
GPT-OSS bruker lav resonneringsinnsats og returnerer bare selve oppsummeringen.
Avkortede eller tomme svar behandles som feil, slik at de ikke lagres som ferdige analyser.
Bare overskrifter som tydelig navngir selskapet eller et av navnealiasene i
overvåkingslisten sendes til nyhetsoppsummeringen.
Andre treff beholdes som kildelenker, men relevansen må sjekkes i originalartikkelen.
Hvis `GROQ_MODEL` er satt i `.env.local`, hosting eller GitHub Actions-variablene,
overstyrer den standarden. Bytt gamle `llama-3.1-8b-instant`-verdier til `openai/gpt-oss-20b`.

### Opprett nyhetstabellene

Kjør disse i rekkefølge i **Supabase → SQL Editor**, eller bruk Supabase CLI
i et allerede tilknyttet prosjekt:

1. [`20260921090000_daily_news.sql`](supabase/migrations/20260921090000_daily_news.sql)
   oppretter nyhetstabellene og jobbfunksjonene med RLS og tilgang kun for service role.
2. [`20260922090000_independent_source_coverage.sql`](supabase/migrations/20260922090000_independent_source_coverage.sql)
   gir nyheter og Reddit hver sin tidsgrense og gjenoppretter vellykket dekning fra eldre rapporter.

**Har du kjørt den første migrasjonen allerede, trenger du bare den andre.**
Eksisterende rapporter og kurstabeller beholdes. Kjør den nye migrasjonen før
den oppdaterte nyhetsjobben tas i bruk.

Test deretter én innhenting og start appen:

```powershell
npm run news:daily
npm run dev
```

Åpne http://localhost:3000. Første innhenting dekker de siste 48 timene.
Videre kjøringer starter ved siste fullførte innhenting per aksje, separat for
nyheter og Reddit, maksimalt
sju dager tilbake. Kildene kan indeksere artikler forsinket; fullstendig historisk
dekning kan ikke garanteres. Tidsrom og kildekontroller vises i hver rapport.

## Aktiver automatisk kjøring

Workflowen ligger i [`.github/workflows/daily-news.yml`](.github/workflows/daily-news.yml).
Den kjører direkte på GitHub og trenger **ingen offentlig app-URL**. Du kan derfor
vente med valg av hosting; PC-en trenger heller ikke være på.

1. Legg endringene på repositoryets standardgren.
2. Åpne **GitHub → Settings → Secrets and variables → Actions**.
3. Legg til secrets `NEXT_PUBLIC_SUPABASE_URL` og `SUPABASE_SERVICE_ROLE_KEY`.
   Legg også til `GROQ_API_KEY` for AI, og `EODHD_API_KEY` hvis EODHD-nyheter aktiveres.
4. For EODHD-nyheter: opprett repository-variabelen `EODHD_NEWS_ENABLED=true`.
   Dette krever et abonnement med tilgang til [Financial News API](https://eodhd.com/financial-apis/stock-market-financial-news-api).
5. Åpne **Actions → Daglige aksjenyheter → Run workflow** for å kontrollere oppsettet.

Planen er kl. 09.00 norsk tid med automatisk sommer-/vintertid. Kl. 09.30 gjøres
et nytt forsøk ved feil. En allerede fullført dagsrapport hoppes over.
Manuell Actions-kjøring før kl. 09.00 hopper også over; bruk lokal kommando ved testing tidligere på dagen.

[GitHub opplyser](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
at planlagte jobber kan bli forsinket eller droppet ved høy belastning. Kl. 09.00
er derfor et planlagt starttidspunkt, ikke en garanti for levering på minuttet.
I offentlige repositories kan tidsplanen deaktiveres etter 60 dager uten aktivitet.
Appen viser manglende dagsrapport; Actions viser feil og jobbens kjørehistorikk.

## Hosting senere

Appen kan kjøres på en Next.js-kompatibel host med de samme miljøvariablene.
GitHub-jobben fortsetter uavhengig. Nettgrensesnittet har foreløpig ingen innlogging;
bruk privat hosting eller tilgangsbeskyttelse hvis overvåkingslisten skal være privat.

Hvis du heller vil bruke en ekstern scheduler, kan den gjøre en autentisert
`POST /api/cron/daily-news` med header `Authorization: Bearer <CRON_SECRET>`.
Endpointet kjører én dagsrapport og returnerer 200 ved fullføring, 409 hvis en jobb
allerede kjører, eller 503 ved delvis/mislykket innhenting. Gi funksjonen minst
300 sekunders kjøretid. GitHub-jobben trenger ikke `CRON_SECRET`.

## X og Reddit uten betalt API

Appen har **manuelle søkelenker** til X og Reddit for hver aksje, både i oversikten
og på aksjesiden. De søker på selskapsnavn, aliaser, børssymbol og cashtag, f.eks.
`$NOD`. X åpnes med siste treff; Reddit med nye innlegg fra siste uke. Dette er
vanlige lenker uten API-kall fra agenten. Innlogging kan være nødvendig.
Søkene følger ikke datoen i rapportarkivet.

**X:** Automatisk innhenting er ikke aktivert. [X sitt offisielle API krever
betaling for lesing](https://docs.x.com/x-api/getting-started/pricing).
Det er ingen X-nøkkel eller betalt X-tjeneste i dette oppsettet.

**Reddit:** En vanlig konto gir ikke automatisk API-tilgang.
[Reddit krever forhåndsgodkjenning](https://support.reddithelp.com/hc/en-us/articles/42728983564564-Responsible-Builder-Policy)
og [tilbyr gratis tilgang til kvalifiserte brukstilfeller](https://support.reddithelp.com/hc/en-us/articles/16160319875092-Reddit-Data-API-Wiki).
Gratis tilgang for akkurat denne appen må avklares med Reddit; den kan ikke garanteres.
Koblingen er ferdig implementert, men er **avslått som standard**.

### Aktiver Reddit etter godkjent gratis tilgang

1. Følg søknadslenken i [Reddit sin utviklerpolicy](https://support.reddithelp.com/hc/en-us/articles/42728983564564-Responsible-Builder-Policy).
   Beskriv privat aksjeovervåking, subredditene, daglige søk og lesing ved sidevisning.
   Appen skriver ikke innlegg eller kommentarer og sender ikke Reddit-tekst til AI.
   Den lagrer bare innleggs-ID-er i rapporten, og henter gjeldende titler ved visning.
2. Når denne bruken er godkjent med gratis tilgang, bruk klient-ID og klientnøkkel
   fra den godkjente serverappen. Koblingen bruker OAuth `client_credentials`.
3. Fyll inn `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET` og `REDDIT_USER_AGENT` i
   `.env.local`. Velg godkjente subredditer med `REDDIT_SUBREDDITS`, og sett
   `REDDIT_ENABLED=true`. Bruk samme oppsett på eventuell hosting.
4. I GitHub Actions legger du klient-ID, klientnøkkel og User-Agent som **secrets**
   med de samme navnene. Legg `REDDIT_ENABLED=true` og `REDDIT_SUBREDDITS` som
   repository-**variabler**. Workflowen er allerede koblet til disse.
5. Kjør `npm run news:daily`. En fullført rapport for dagens dato hoppes over;
   Reddit kommer med fra neste nye dagsrapport. Begge migrasjonene i første oppsett må være kjørt.

Søket leser innleggstitler og tekst for å kontrollere selskapsnavn/aliaser/ticker;
kommentarfeltene gjennomsøkes ikke. Det henter maksimalt tre sider à 100 treff per
aksje og markerer innhentingen som ufullstendig hvis flere sider er nødvendige.
Søkeindeksering kan være forsinket og full dekning er ikke garantert.
Feil hos Reddit gir delvis kjøring og nytt forsøk ved neste planlagte kjøring,
mens tilgjengelige nyheter fortsatt lagres og nyhetenes tidsgrense flyttes videre.
Reddit beholder sitt eget tidsvindu for å hente inn etterslepet når kilden svarer igjen.
Rapporten og jobben markeres fortsatt som delvise ved Reddit-feil; la
`REDDIT_ENABLED=false` frem til tilgangen er godkjent og konfigurert.
Ved forespørselsgrensen stopper
klienten videre kall i ventetiden Reddit oppgir.

Rapporten lagrer kun referanse-ID-er og kildestatus fra Reddit, ikke titler,
innhold eller forfattere. Gjeldende titler hentes uten innholdscache når rapporten
åpnes; slettede/fjernede innlegg filtreres bort. Hver visning kontrollerer maksimalt
100 referanser per aksje med ett `/api/info`-kall. «Forrige/Neste» åpner flere sider
på aksjesiden og beholder rapportdatoen. Alle lagrede referanser forblir tilgjengelige.
Ved lesefeil vises en melding,
ikke en gammel tekstkopi. Reddit-innlegg inngår ikke i Groq-oppsummeringen eller
antallet nyhetstreff. Gamle rapporter uten Reddit beholder sin opprinnelige dekning.

## Aksjeliste og drift

Endre `lib/watchlist.ts` for å legge til eller fjerne aksjer. Bruk EODHD-symbol
(f.eks. `NOD.OL`), korrekt selskapsnavn og eventuelle presise navnealiaser.
Endringen gjelder daglige søk fra neste kjøring etter at workflowens gren er oppdatert.
Filterknappene i appen velger hva du ser; alle aksjene i filen overvåkes.

- Hver norsk dato har én rapport per aksje. En databaselås hindrer parallelle duplikater.
- En avbrutt jobb kan overtas etter 15 minutter; en gammel arbeider kan ikke overskrive den nye.
- Delvis/mislykket innhenting kan forsøkes igjen. Resultater og status lagres atomisk.
- Ved nye forsøk samme dag beholdes allerede innhentede artikler og Reddit-referanser. Nyhetsoppsummeringen lages etter sammenslåing, slik at kildenumrene fortsatt stemmer. Kildestatus og antall treff per kilde gjelder siste forsøk; tidligere treff som er beholdt merkes i rapporten. En kildefeil markeres fortsatt som feil selv om eldre treff er tilgjengelige.
- Google News og EODHD bruker normalisert utgiverdomene og overskrift til å identifisere samme artikkel. Ulike utgivere med lik overskrift beholdes som separate kilder. Visningsnavnet til kilden beholdes.
- Feil fra en nyhetskilde stopper ikke de andre. AI-feil stopper ikke nyhetslagring.
- Den tekniske AI-oppsummeringen på aksjesiden laster separat, slik at et tregt AI-svar ikke holder igjen nyheter eller kurstabellen.
- Kursdata mellomlagres per aksje. Delvise kurslister og AI-feilmeldinger mellomlagres ikke som vellykkede resultater i en time.
- Lagringen er uavhengig av EODHD-kursdata. Sluttkursene er ikke sanntidskurser.
- Eksisterende kurssynk er nå `POST /api/sync` med `CRON_SECRET`; den krever fortsatt den eksisterende `stock_prices`-tabellen.
- Det gamle API-et `GET /api/report` krever også `CRON_SECRET` fordi det utløser AI-kall.

## Kontroller

```powershell
npm run check
```

Kjører lint, tester, produksjonsbygg med TypeScript-kontroll og en test av den
kjørende produksjonsappen. Sistnevnte bruker simulerte tjenester og kontrollerer
blant annet gjenoppretting etter kildefeil, AI-lasting og Reddit-paginering.
Workflowen
[Kodekontroll](.github/workflows/check.yml) kjører det samme ved push og pull requests,
uten API-nøkler eller tilgang til produksjonsdatabasen. Den daglige nyhetsjobben er separat.
GitHub Actions er oppdatert og festet til konkrete versjoners commit-ID-er.

Felles navnematching og søkefraser ligger i `lib/stock-search.ts`, validering av
rapportdato og sidetall i `lib/report-query.ts`, og Groq-oppsettet i `lib/groq.ts`.
Disse brukes på tvers av sidene og innhentingskildene for å unngå ulike regler
for samme selskapsnavn eller parameter.

ESLint beholdes foreløpig på 9.x: `eslint-plugin-react` og `eslint-plugin-jsx-a11y`
oppgir ennå ikke støtte for ESLint 10. Kontroller kompatibiliteten før neste
hovedversjonsoppgradering. `npm audit` brukes til å kontrollere kjente sårbarheter.

Testene dekker RSS, datoavgrensing, duplikater, kildesvikt, norsk tid/sommertid,
autentisering og databaselås/retry med en lokal PostgreSQL-motor (PGlite).
De bruker ingen ekte API-nøkler og skriver ikke til Supabase.
