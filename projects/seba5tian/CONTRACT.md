# seba5tian CONTRACT (TableWise: map widget, detail widgets, integration)

Status: DRAFT v0.1. Only seba5tian changes this file. Ask in #build.

We run at `/colony/seba5tian/` (UI) and `/t/seba5tian/` (backend). The UI fans out to the other teams' modules and
merges the results by `restaurant_id`.

## Shared rules (all modules)

- `restaurant_id`: string, stable, issued by discovery (daniela). Format `<source>:<id>`, e.g. `osm:node/123456`.
- Coordinates: `lat`, `lng` as numbers (WGS84).
- Dates: `YYYY-MM-DD`. Prices: `price_level` integer 1-4 (1 = cheap).
- Every module answers JSON, GET or POST, and never returns HTML. Unknown data = `null` or `[]`, not an error.
- Errors: HTTP 4xx/5xx with `{ "error": "message" }`.

## 1. SearchParams (emitted by bhaeha-team's form + location picker)

The form calls `window.TableWise.onSearch(params)` (the UI exposes it), or posts the same JSON to
`POST /t/seba5tian/search`.

```json
{
  "from": "2026-11-03",
  "to": "2026-11-03",
  "time": "19:00",
  "location": { "lat": 59.3293, "lng": 18.0686, "radius_m": 1500 },
  "cuisines": ["italian", "vegetarian"],
  "price_min": 1,
  "price_max": 3,
  "max_wait_min": 20,
  "diet": ["vegetarian"]
}
```

`from` and `to` are the same visit date (single date + time since 11:13); `time` HH:MM is optional and is also sent to every widget call.
`cuisines`, `diet` optional (empty = any). `radius_m` optional (default 1500).

## 2. Discovery (daniela) -> list of Restaurant

We expect (daniela to confirm path):

```json
[{
  "restaurant_id": "osm:node/123456",
  "name": "Trattoria X",
  "lat": 59.33, "lng": 18.07,
  "cuisines": ["italian"],
  "price_level": 2,
  "rating": 4.4,
  "contact": { "phone": "+46...", "website": "https://...", "address": "...", "opening_hours": "Mo-Su 11:00-22:00" }
}]
```

## 3. Detail widgets (we call, per clicked restaurant)

Each module serves one endpoint taking `restaurant_id`, `lat`, `lng`, `from`, `to`.

| Widget | Owner | Expected response |
|---|---|---|
| Menu + offers | menus team (unclaimed) | `{ "menus": [{ "date": "2026-11-03", "items": [{ "name": "...", "price": 12.5, "currency": "EUR" }] }], "offers": [{ "date": "...", "title": "...", "description": "..." }] }` |
| Reviews | gnik | `{ "suggested_meals": [{ "name": "...", "reason": "..." }], "red_flags": [{ "type": "wait_time\|hygiene\|dish\|other", "text": "...", "severity": 1 }] }` |
| Visit timing | visit-time team (unclaimed) | `{ "best_times": [{ "date": "...", "start": "14:00", "end": "16:00", "crowd": "low" }], "avg_wait_min": 10 }` |
| Contact | from Discovery | `contact` object above |

The owning team publishes the real path in its own CONTRACT.md; we adapt to what they publish. A module that is
down shows "not available" in its widget; the rest of the UI keeps working.

## What we offer

- `GET /t/seba5tian/health` -> `{ "ok": true }`
- `GET /t/seba5tian/modules` -> `{ "modules": { discovery|timing|reviews|menus: { team, path } } }`, the endpoints the UI calls
- UI: `window.TableWise.onSearch(params)` for the input form (a built-in fallback form works until bhaeha-team's ships).
- The UI calls the other modules directly (same origin) and accepts both the shape above and each producer's own
  published shape (e.g. daniela: `id`, `priceLevel`, `phone`, `website`, `openingHours`).
- Currently wired: discovery `GET /t/daniela/search` (lat, lng, radiusMeters, cuisine, limit), timing
  `GET /t/omidteam/timing` (id, lat, lng, from, to, maxWaitMinutes), reviews `/t/gnik/reviews` (guess, gnik to confirm).

## Shared selection (click a restaurant on the map -> every tile follows)

Same origin, so no server is needed. Our map publishes the selection three ways: BroadcastChannel "tablewise",
localStorage key "tablewise.selection" (so tiles opened later also get it), and postMessage to iframes on our page.

Include one script in your tile and register a callback:

```html
<script src="/colony/seba5tian/tablewise-select.js"></script>
<script>
  TableWiseSelect.onSelect((s) => {
    // s = { restaurant: { id, name, lat, lng, cuisines, phone, website, address }, from, to, time, ts }
    loadMyWidget(s.restaurant.id, s.restaurant.lat, s.restaurant.lng, s.from, s.time);
  });
</script>
```

`onSelect` also fires once at load with the last selection. Treat all fields as text (use textContent).
Ids are `osm:...` or `overture:<uuid>`. Only seba5tian changes this file.

## Google Places proxy (our server)

`GET /t/seba5tian/places?lat=&lng=&radius_m=&cuisines=&limit=` returns `{ "restaurants": [Restaurant], "source": "google-places" }`
in the Restaurant shape above, with `restaurant_id` = `google:<placeId>`, `price_level`, `rating`, `rating_count`,
`distance_m` and `contact.opening_hours` converted to OSM format. It needs the server variable
`GOOGLE_PLACES_API_KEY`; without it the endpoint answers 503 `{ "configured": false }` and the UI uses the other sources.
The key never reaches the browser. Results are cached for 10 minutes and the endpoint allows 40 searches per minute.
Note: ids are `google:...`, other modules that only know osm/overture ids should accept any id and use lat/lng.
