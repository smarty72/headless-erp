## Wat en waarom

<!-- Wat verandert er, en welk probleem lost het op? Link het issue: "Sluit #12". -->

## Wie

- Gevraagd door: <!-- Martin / Dave -->
- Gemaakt door: <!-- mens, Claude, Codex, ... -->

## Soort wijziging

- [ ] Database (migratie, RLS, functie)
- [ ] API
- [ ] Web-app
- [ ] Documentatie of afspraken
- [ ] CI of tooling

## Getest

<!-- Wat heb je gedraaid en wat was het resultaat? -->

- [ ] `supabase test db`
- [ ] `api`: `npm run typecheck` en `npm test`
- [ ] `web`: `npm run build`
- [ ] Handmatig bekeken (beschrijf hieronder, liefst met screenshot op mobiel formaat)

## Database

- [ ] Geen migratie
- [ ] Nieuwe migratie, bestaande migraties niet aangepast
- [ ] Nieuwe tabellen hebben `tenant_id`, RLS en een isolatietest

> Migraties naar productie gaan pas na expliciete toestemming van Martin, los van deze merge.

## Controle voor merge

- [ ] CI is groen
- [ ] Afspraken in `AGENTS.md` gevolgd
- [ ] Geen geheimen of `.env`-bestanden in de diff
- [ ] Minstens één **menselijke** review (een agent-review telt niet als goedkeuring)
