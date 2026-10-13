# HeadlessERP

Een API-first ERP voor zelfstandigen en kleine bedrijven (schilders, tuinarchitecten, timmerlieden). Elk kanaal (web, mobiel, WhatsApp, spraak, AI) praat met dezelfde API. Bedrijfsregels en rechten zitten in de database.

## Opbouw

| Map | Inhoud |
| --- | --- |
| `supabase/migrations` | Het schema: een vaste kern, JSONB-velden per branche, Row Level Security en het definitief maken van facturen |
| `supabase/tests/database` | pgTAP-tests die bewijzen dat bedrijven van elkaar gescheiden zijn en dat facturen kloppen |
| `api` | Node.js-API (Hono + OpenAPI). Elke query draait met het token van de gebruiker, dus RLS geldt altijd |
| `web` | Web-app "Vakwerk" (Vue 3, daisyUI, mobile first): onboarding, dashboard, klanten, artikelen, offertes, opdrachten met timer, facturen en betalingen |

## Principes

- **Multi-tenancy:** elke rij heeft een `tenant_id` en de primaire sleutel is `(tenant_id, id)`. Daardoor kan een foreign key nooit naar data van een ander bedrijf wijzen. RLS geeft toegang via `memberships`.
- **Rollen:** `owner`, `admin` en `medewerker` mogen schrijven, een `boekhouder` mag alleen lezen.
- **Branche-flexibiliteit:** extra velden staan in `attributes jsonb` en worden beschreven in `field_definitions`. Een definitie zonder `tenant_id` is een branche-template.
- **Facturen:** `finalize_invoice` kent een doorlopend nummer zonder gaten toe, rekent de totalen per btw-tarief uit en legt de klantgegevens vast. Daarna kan de factuur niet meer worden gewijzigd; corrigeren gaat met een creditfactuur.
- **Artikelen en voorraad:** arbeid, materialen en overige posten in `items`, met merk, artikelcode en btw-tarief (prijzen exclusief btw). Voor materialen kun je voorraad bijhouden: `stock_movements` is een grootboek van onveranderlijke mutaties en `stock_quantity` het saldo. Materiaalverbruik op een opdracht boekt automatisch af. `low_stock_items` toont artikelen onder de minimumvoorraad.
- **Onboarding:** branches staan als data in `industries` (met voorgesteld uurtarief en btw op arbeid). `onboard_tenant` maakt bedrijf, lidmaatschap en standaardartikelen in één transactie. Logo's staan in de Storage-bucket `logos` onder `<tenant_id>/`.
- **Werkstroom:** offerte → opdracht → uren en materiaal → factuur → betaling. `send_quote` geeft een offertenummer (O2026-0001) en zet de regels vast. `accept_quote` maakt in één stap een opdracht. `start_timer`/`stop_timer` houden uren bij (één lopende timer per persoon, afgerond op een kwartier). `create_invoice_from_job` maakt een conceptfactuur uit de offerteregels plus factureerbare uren en materiaal. Bij een opdracht met offerte zijn uren en materiaal standaard nacalculatie; meerwerk zet je op factureren. `register_payment` zet een volledig betaalde factuur op betaald.
- **Events:** elke belangrijke wijziging komt in `events` terecht. Dat is de basis voor webhooks, notificaties en AI-kanalen.

## Lokaal ontwikkelen

Vereist: Docker en Node.js 22 of hoger.

```bash
npx supabase start          # lokale Postgres, Auth en REST
npx supabase test db        # databasetests
cd api
cp .env.example .env        # vul de waarden uit `npx supabase status` in
npm install
npm test                    # integratietests tegen de lokale Supabase
npm run dev                 # API op http://localhost:3000, spec op /openapi.json
```

### Web-app

```bash
cd web
cp .env.example .env.local  # Supabase-URL, publishable key en API-URL
npm install
npm run dev                 # http://localhost:5173
```

De API staat verzoeken van `WEB_ORIGIN` toe (standaard `http://localhost:5173`, meerdere origins kommagescheiden). Na het inloggen leidt de app nieuwe gebruikers naar `/welkom`: branche kiezen, bedrijfsgegevens met logo, tarieven en betaaltermijn. Daarna volgt het dashboard.

Zet in Supabase onder Authentication > URL Configuration de **Site URL** op het adres van de web-app, anders wijst de bevestigingsmail naar de verkeerde plek.

## Supabase-project

Productie draait in het project `headless-erp` (`xwbkyninahaibmtqfkhs`, regio eu-central-1 Frankfurt). Om dit project aan de Supabase CLI te koppelen en nieuwe migraties uit te rollen:

```bash
npx supabase link --project-ref xwbkyninahaibmtqfkhs
npx supabase db push
```

## API

| Methode | Pad | Doel |
| --- | --- | --- |
| GET | `/health` | Healthcheck |
| GET | `/openapi.json` | OpenAPI 3.1-specificatie; hieruit worden clients en AI-tools gegenereerd |
| GET | `/me/tenants` | Bedrijven waar de gebruiker lid van is, met de rol |
| GET | `/industries` | Branches met voorgesteld uurtarief en btw op arbeid |
| POST | `/onboarding` | Bedrijf in één keer neerzetten: gegevens, owner, uurtarief en voorrijkosten |
| GET | `/tenants/{tenantId}` | Bedrijfsgegevens met logo-URL |
| POST | `/tenants/{tenantId}/logo` | Logo uploaden (multipart, veld `file`, max 2 MB) |
| POST | `/tenants` | Nieuw bedrijf aanmaken; de aanroeper wordt owner |
| GET | `/tenants/{tenantId}/overview` | Kerncijfers voor het dashboard (lopende timer, open klussen, openstaand bedrag) |
| PATCH | `/tenants/{tenantId}` | Bedrijfsgegevens en betaaltermijn bijwerken |
| GET/POST | `/tenants/{tenantId}/customers` | Klanten (zoeken met `search`) |
| GET/PATCH/DELETE | `/tenants/{tenantId}/customers/{id}` | Klant met offertes, opdrachten en facturen; DELETE archiveert |
| GET/POST | `/tenants/{tenantId}/items` | Artikelen (arbeid, materiaal); filters `kind`, `search`, `low_stock=true` |
| GET/PATCH/DELETE | `/tenants/{tenantId}/items/{itemId}` | Artikel bekijken, bijwerken (niet de voorraad) of archiveren |
| GET/POST | `/tenants/{tenantId}/items/{itemId}/stock-movements` | Voorraadmutaties bekijken en boeken (inkoop, correctie, retour) |
| GET/POST | `/tenants/{tenantId}/quotes` | Offertes met totalen; aanmaken met regels |
| GET/PATCH/DELETE | `/tenants/{tenantId}/quotes/{id}` | Offerte; aanpassen en verwijderen alleen als concept |
| POST | `/tenants/{tenantId}/quotes/{id}/send`, `/accept`, `/decline` | Versturen (nummer), akkoord (maakt opdracht), afgewezen |
| GET/POST | `/tenants/{tenantId}/jobs` | Opdrachten (`status=open`); aanmaken zonder offerte (regie) |
| GET/PATCH | `/tenants/{tenantId}/jobs/{id}` | Opdracht met uren, materiaal en facturen; status wijzigen |
| POST/PATCH/DELETE | `/tenants/{tenantId}/jobs/{id}/time-entries[/{entryId}]` | Uren achteraf invullen of aanpassen |
| POST/DELETE | `/tenants/{tenantId}/jobs/{id}/materials[/{usageId}]` | Materiaal op de klus (boekt voorraad af) |
| POST | `/tenants/{tenantId}/jobs/{id}/invoice` | Conceptfactuur uit de opdracht |
| GET | `/tenants/{tenantId}/timer` | Lopende timer van de gebruiker |
| POST | `/tenants/{tenantId}/timer/start`, `/timer/stop` | Aan het werk: timer starten en stoppen |
| GET/POST | `/tenants/{tenantId}/invoices` | Facturen (`status=open`); losse conceptfactuur |
| GET/PATCH/DELETE | `/tenants/{tenantId}/invoices/{id}` | Factuur; regels bewerken en verwijderen alleen als concept |
| POST | `/tenants/{tenantId}/invoices/{id}/finalize` | Definitief: nummer, datum, vervaldatum volgens betaaltermijn |
| POST | `/tenants/{tenantId}/invoices/{id}/payments` | Betaling vastleggen |
| GET | `/tenants/{tenantId}/field-definitions` | Branchevelden en eigen velden van het bedrijf |

Authenticatie loopt via een Supabase-JWT in de header `Authorization: Bearer <token>`.
