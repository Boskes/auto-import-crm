# Testrapportage CRM-MVP auto-import

Datum: 2026-06-08
Scope: lokale frontend-only MVP met LocalStorage, JSON import/export en demo-/seeddata.

## Samenvatting

De MVP is technisch en functioneel gevalideerd voor de afgesproken kernflow: lead aanmaken, voertuig koppelen, importdossier opvolgen, status wijzigen, taak toevoegen/afronden en dossierdetails raadplegen. Unit tests slagen en de app start lokaal via `npm start` met HTTP 200 op de startpagina.

## Testomgeving

| Onderdeel | Waarde |
|---|---|
| Workspace | `C:\Users\jurge\AppData\Local\hermes\kanban\workspaces\t_8383678b` |
| Runtime | Node.js via npm scripts |
| Startcommando | `npm start` |
| Testcommando | `npm test` |
| URL | `http://127.0.0.1:4173/` |
| Opslag | Browser LocalStorage (`autoImportCrmMvpData.v1`) |

## Demo-/seeddata

Er zijn twee bruikbare manieren voorzien:

1. In de applicatie: knop `Demo data`.
2. Als importbestand: `demo-data/auto-import-crm-demo-data.json`.

De demo-set bevat:

| Entiteit | Aantal | Voorbeelden |
|---|---:|---|
| Klanten/leads | 3 | Jan Peeters, Sara De Smet, GreenFleet BV |
| Voertuigen | 3 | BMW X3, VW Golf Variant, Mercedes eVito |
| Importdossiers | 3 | IMP-2026-001 t/m IMP-2026-003 |
| Taken | 5 | open, bezig, wacht op derde, afgerond |
| Documenten | 4 | COC, aankoopfactuur, CMR, keuring |
| Notities | 3 | intake, transport, risico |
| Partners | 3 | garage, transporteur, inspectiebedrijf |
| Statushistoriek | 2 | aankoop -> transport, transport -> keuring |

## Uitgevoerde tests

| Test | Verwacht resultaat | Resultaat |
|---|---|---|
| Unit tests datalaag | Alle datamodeltests slagen | OK: 7/7 pass |
| Startpagina via webserver | HTTP 200 op `http://127.0.0.1:4173/` | OK: HTTP 200 |
| Demo data laden | Navigatietellers tonen representatieve dataset | OK: 3 klanten, 3 dossiers, 3 voertuigen, 5 taken via seedtest; browser toont data na seed |
| Lead aanmaken | Nieuwe lead wordt opgeslagen | OK: Mila Verbruggen toegevoegd; klanten/leads van 3 naar 4 |
| Voertuig koppelen | Nieuw voertuig wordt aan lead gekoppeld | OK: Volvo XC60 gekoppeld aan Mila; voertuigen van 3 naar 4 |
| Importdossier aanmaken | Dossier koppelt klant + voertuig | OK: IMP-2026-004 aangemaakt voor Mila + Volvo; dossiers van 3 naar 4 |
| Dossierstatus wijzigen | Status wijzigt en historiekregel ontstaat | OK: IMP-2026-004 van `intake` naar `voertuig_gevonden`; 1 historiekregel |
| Taak toevoegen | Taak wordt aan dossier gekoppeld | OK: `Validatietaak: aankoopvoorstel naar Mila` toegevoegd |
| Taak afronden | Taakstatus wordt `afgerond` | OK: afgeronde taken van 1 naar 2 |
| Dossierdetails raadplegen | Detailpagina toont gekoppelde klant/voertuig en statusflow | OK: detailpagina voor IMP-2026-004 geopend met relaties Mila + Volvo |
| Browserconsole | Geen JS-fouten tijdens validatie | OK: 0 console errors |

## Werkelijke testoutput

`npm test`:

```text
✔ contacts, vehicles, import cases, tasks, notes and documents support CRUD-style lifecycle
✔ customer graph exposes customer to vehicles, import dossiers, tasks, notes and documents relationships
✔ import dossier status changes are validated and written to status history
✔ note follow-up can automatically create a linked task
✔ validation rejects incomplete required MVP records
✔ JSON export/import roundtrip preserves schema and records
✔ demo seed data contains representative auto-import CRM scenarios
ℹ tests 7
ℹ pass 7
ℹ fail 0
```

Browservalidatie na extra testflow:

```json
{
  "contacts": 4,
  "vehicles": 4,
  "importCases": 4,
  "tasks": 6,
  "completedTasks": 2,
  "newCaseStatus": "voertuig_gevonden",
  "statusHistoryForNewCase": 1
}
```

## Installatie- en startinstructies

1. Ga naar de workspace:
   ```bash
   cd /c/Users/jurge/AppData/Local/hermes/kanban/workspaces/t_8383678b
   ```
2. Run de tests:
   ```bash
   npm test
   ```
3. Start de MVP:
   ```bash
   npm start
   ```
4. Open:
   ```text
   http://127.0.0.1:4173/
   ```
5. Laad demo-data:
   - klik `Demo data`, of
   - ga naar `Import/export` en importeer `demo-data/auto-import-crm-demo-data.json`.

## Aannames

| Aanname | Impact |
|---|---|
| Frontend-only MVP is voldoende voor beoordeling | Geen backend, auth of gedeelde database nodig |
| Documenten zijn metadata/linkrecords | Geen upload, opslag of preview van echte bestanden |
| LocalStorage is acceptabel voor demo en single-user test | Data is browsergebonden en niet multi-user |
| Demo-e-mails en links zijn fictief | Geen echte klant- of partnerdata gebruikt |
| Statusflow hoeft nog geen harde procesvalidatie af te dwingen | Gebruiker kan statussen vrij wijzigen binnen de optielijst |

## Bekende beperkingen

| Beperking | Risico | Advies |
|---|---|---|
| Geen authenticatie of rollen | Niet geschikt voor productiegebruik | Later backend + login + rollen toevoegen |
| Geen centrale database | Geen samenwerking tussen gebruikers | Backend/API en database ontwerpen zodra MVP gevalideerd is |
| Geen bestandsopslag | Documentflow is beperkt | File-upload + documentstatussen later toevoegen |
| Geen verplichte statusovergangen | Foutieve processtappen mogelijk | Statusflowregels toevoegen na procesvalidatie |
| Geen auditlog buiten dossierstatushistoriek | Beperkte traceerbaarheid | Audittrail toevoegen voor taken, documenten en klantwijzigingen |
| Geen automatische notificaties | Taken kunnen gemist worden | E-mail/Teams/WhatsApp reminders later automatiseren |

## Aanbevolen vervolgstappen

Nu nodig:

1. Laat een eindgebruiker de demo-flow beoordelen met de seeddata.
2. Valideer welke velden echt verplicht zijn voor intake, aankoop, transport en aflevering.
3. Beslis of deze MVP eerst lokaal blijft of naar een gedeelde testomgeving moet.

Kan later:

1. Backend met database en authenticatie.
2. Rolmodel voor sales, dossierbeheer en administratie.
3. Documentupload en automatische documentchecklist per dossierstatus.
4. Notificaties voor deadlines, ontbrekende documenten en statuswijzigingen.
5. Import van leads uit websiteformulieren of CRM-bronnen.

Risicovol zonder validatie:

1. Te vroeg een volledige workflow-engine bouwen.
2. Te veel velden verplicht maken voordat echte gebruikers de flow bevestigen.
3. Documentopslag bouwen zonder duidelijk juridisch/bewaarbeleid.

Automatiseringskansen:

1. Automatische taaktemplates per nieuwe dossierstatus.
2. Automatische documentchecklist per voertuigtype/importfase.
3. E-mail/WhatsApp reminders bij achterstallige taken.
4. JSON/CSV import van advertenties en leads.
5. Statusrapport naar klant vanuit dossiergegevens.
