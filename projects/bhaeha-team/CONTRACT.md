# Contract: Menus + Special Offers (module 3, bhaeha-team)

Base path: `/t/bhaeha-team/`

## GET /t/bhaeha-team/menu

Query parameters:

| name | required | example |
|---|---|---|
| `id` | yes | `osm:node:123456` (the stable restaurant id from the discovery module) |
| `lat`, `lng` | yes | `59.3293`, `18.0686` |
| `from`, `to` | yes | `2026-10-24`, `2026-10-26` (ISO dates, inclusive) |

Example: `/t/bhaeha-team/menu?id=osm:node:123456&lat=59.3293&lng=18.0686&from=2026-10-24&to=2026-10-26`

Response 200:

```json
{
  "id": "osm:node:123456",
  "from": "2026-10-24",
  "to": "2026-10-26",
  "menu_url": "https://example.com/menu",
  "days": [
    {
      "date": "2026-10-24",
      "items": [
        { "name": "Dish of the day", "price": 14.5, "currency": "EUR", "tags": ["vegetarian"], "daily_special": true }
      ]
    }
  ],
  "offers": [
    { "title": "Lunch 2-for-1", "description": "Weekdays 11-14", "valid_from": "2026-10-24", "valid_to": "2026-10-26" }
  ],
  "source": "mock",
  "confidence": 0.3
}
```

Optional query parameter: `demo=1` fills `days` and `offers` with mock data even when real data exists.

Additive fields (only present for ids found in OpenStreetMap): `website`, `opening_hours`, `diet` (e.g. `["vegetarian"]`).

Notes:
- Ids of the form `osm:<node|way|relation>:<number>` are looked up in OpenStreetMap (Overpass). OSM has no menus, so the result has `source: "osm"`, a `menu_url` when tagged, and empty `days`/`offers` (nothing is invented). With `demo=1` the source is `"osm+mock"`.
- Any other id, or an OSM lookup failure, falls back to `source: "mock"` with generated days and offers.
- `source: "website"`: the OSM `menu_url` page was fetched and "dish + price" lines were extracted (heuristic, undated, so the same items are listed for every date in the range, `daily_special` false, confidence 0.4).
- `source` is always one of `"mock"`, `"osm"`, `"website"`, `"osm+mock"`.
- `days`/`offers` may be empty arrays; `menu_url` may be `null`.
- `price` may be `null`.

Errors: `400 {"error": "<what is missing or invalid>"}`.

## GET /t/bhaeha-team/restaurants (additive)

Real Stockholm restaurants from Overture Maps (open data, CDLA-Permissive-2.0), served from a bundled file, so it works when Overpass is down. Params: `lat`, `lng` (required), `radius_m` (50-5000, default 600), `limit` (1-100, default 25).

```json
{ "source": "overture", "restaurants": [
  { "id": "overture:b38a3c58-...", "name": "Moldau", "lat": 59.3155, "lng": 18.0300, "category": "european_restaurant",
    "website": "http://...", "phone": "+468847548", "address": "Bergsunds strand 33", "confidence": 1, "distance_m": 120 } ] }
```

`/menu` also accepts these `overture:<id>` ids. It returns `name`, `phone`, `address`, `website`, and `source: "overture"` (or `"website"` when dish prices were scraped from the site).

Optional `live=1`: tries OpenStreetMap (Overpass mirrors in parallel, 4 s budget, 10 min cache) first and returns `source: "osm"` with ids `osm:<node|way|relation>:<n>`. If Overpass is down it silently returns the Overture list (`source: "overture"`). Without `live=1` the answer is always the fast bundled Overture list.
