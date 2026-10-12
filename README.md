# HeadlessERP

Een API-first ERP voor zelfstandigen en kleine bedrijven (schilders, tuinarchitecten, timmerlieden). Elk kanaal (web, mobiel, WhatsApp, spraak, AI) praat met dezelfde API. Bedrijfsregels en rechten zitten in de database.

## Opbouw

| Map | Inhoud |
| --- | --- |
| `supabase/migrations` | Het schema: een vaste kern, JSONB-velden per branche, Row Level Security en het definitief maken van facturen |
| `supabase/tests/database` | pgTAP-tests die bewijzen dat bedrijven van elkaar gescheiden zijn en dat facturen kloppen |
| `api` | Node.js-API (Hono + OpenAPI). Elke query draait met het token van de gebruiker, dus RLS geldt altijd |

## Principes

- **Multi-tenancy:** elke rij heeft een `tenant_id` en de primaire sleutel is `(tenant_id, id)`. Daardoor kan een foreign key nooit naar data van een ander bedrijf wijzen. RLS geeft toegang via `memberships`.
- **Rollen:** `owner`, `admin` en `medewerker` mogen schrijven, een `boekhouder` mag alleen lezen.
- **Branche-flexibiliteit:** extra velden staan in `attributes jsonb` en worden beschreven in `field_definitions`. Een definitie zonder `tenant_id` is een branche-template.
- **Facturen:** `finalize_invoice` kent een doorlopend nummer zonder gaten toe, rekent de totalen per btw-tarief uit en legt de klantgegevens vast. Daarna kan de factuur niet meer worden gewijzigd; corrigeren gaat met een creditfactuur.
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
| POST | `/tenants` | Nieuw bedrijf aanmaken; de aanroeper wordt owner |
| GET/POST | `/tenants/{tenantId}/customers` | Klanten bekijken en aanmaken |
| GET | `/tenants/{tenantId}/field-definitions` | Branchevelden en eigen velden van het bedrijf |
| POST | `/tenants/{tenantId}/invoices/{invoiceId}/finalize` | Factuur definitief maken |

Authenticatie loopt via een Supabase-JWT in de header `Authorization: Bearer <token>`.
