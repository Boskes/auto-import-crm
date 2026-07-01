# Auto-import CRM MVP

Werkende lokale CRM-MVP voor een Belgische auto-import flow. De applicatie gebruikt een statische HTML/JS/CSS frontend met LocalStorage als eenvoudige robuuste opslag. Er is geen backend of database-installatie nodig.

## Starten

```bash
npm start
```

Open daarna: http://127.0.0.1:4173/

Alternatief kan `index.html` via een eenvoudige webserver worden geopend. Een webserver is aanbevolen omdat de app ES modules gebruikt.

## Testen

```bash
npm test
```

Verwachte uitkomst na deze validatieslag: 7/7 tests pass.

## Demo-data laden

Er zijn twee opties:

1. Klik in de app op `Demo data`.
2. Importeer het JSON-bestand `demo-data/auto-import-crm-demo-data.json` via `Import/export`.

De demo-set bevat recente gegevens uit april, mei en juni 2026: 8 klanten/leads, 8 voertuigen, 8 importdossiers, 10 taken, 9 documenten, 8 notities, 3 partners en 8 statusgeschiedenisregels. De dossiers bevatten ook exportcases vanuit Duitsland naar Japan, China en Australie. De acht voertuigen tellen samen op tot EUR 53.850 winst, met per voertuig een winst tussen EUR 3.000 en EUR 8.000.

## Functionaliteit in scope

- Dashboard met KPI's, open taken, dossierstatussen, risico's en recente notities.
- CRUD voor:
  - klanten/leads;
  - voertuigen;
  - importdossiers;
  - taken;
  - notities;
  - documenten/documentmetadata;
  - partners.
- Statusbeheer voor importdossiers, taken, voertuigen, contacten en documenten.
- Statushistoriek bij importdossiers via de Statusflow-tab.
- Relaties zichtbaar vanuit detailpagina's:
  - klant -> voertuigen/importdossiers/taken/notities/documenten;
  - importdossier -> klant/voertuig/partner/taken/notities/documenten;
  - voertuig/document/taak/notitie -> gekoppeld object via type en ID.
- Snelle acties vanaf detailpagina's: taak, notitie of document toevoegen.
- JSON export/import voor backup en overdracht.
- Demo-data knop om de primaire CRM-flow meteen te testen.

## Primaire MVP-flow

1. Maak een klant/lead aan.
2. Maak of koppel een voertuig.
3. Maak een importdossier voor klant + voertuig.
4. Voeg taken, notities en documentmetadata toe.
5. Wijzig de dossierstatus via `Statusflow`; de app registreert de statushistoriek.
6. Gebruik dashboard en takenlijst voor opvolging.

## Technische keuzes

- Frontend-only MVP: minder setup, direct lokaal bruikbaar.
- LocalStorage met JSON schema: eenvoudig, transparant en exporteerbaar.
- Soft-delete via `is_archived` voor normale archiefacties; harde delete-functie bestaat in de datalaag maar de UI gebruikt standaard archiveren.
- Documenten worden bewust als metadata/link beheerd; echte file-upload is latere scope.

## Belangrijkste bestanden

- `index.html` - shell en dialogcontainer.
- `src/app.mjs` - UI, routing, formulieren, lijsten en detailpagina's.
- `src/crm-store.mjs` - datamodel, CRUD, validatie, relaties, statusflow, import/export.
- `src/styles.css` - responsive MVP styling.
- `tests/crm-store.test.mjs` - unit tests voor datalaag en primaire flow.
