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
        { "name": "Dish of the day", "price": 145, "currency": "SEK", "tags": ["vegetarian"], "daily_special": true }
      ]
    }
  ],
  "offers": [
    { "title": "Lunch 2-for-1", "description": "Weekdays 11-14", "valid_from": "2026-10-24", "valid_to": "2026-10-26" }
  ],
  "source": "website",
  "confidence": 0.4
}
```

Additive fields (only when the id is known): `name`, `website`, `phone`, `address`, `opening_hours`, `diet`.

No mock data: everything is real or empty.
- Ids `osm:<node|way|relation>:<n>` (also `osm:node/<n>`) are looked up live in OpenStreetMap (Overpass, cached 6 h). Ids `overture:<uuid>` come from the bundled Overture Maps file.
- The restaurant's `menu_url` or `website` is fetched (redirects followed safely) and "dish + price" lines are extracted. If the page has none, up to 3 same-site links that look like a menu (meny, menu, lunch, dagens ...) are tried. A page needs at least 3 dish lines to count. About 1 in 10 sites publishes a readable HTML menu; PDFs, images and JavaScript menus are not read (`source: "website"`, confidence 0.4). Pages are undated, so the same items are listed for every date in the range.
- If nothing readable is found, `days` and `offers` are empty arrays. Offers are never invented.
- Unknown ids return 200 with `source: "none"` and empty `days`/`offers`.
- `source` is one of `"website"`, `"osm"`, `"overture"`, `"none"`.

## GET /t/bhaeha-team/restaurants (additive)

Real Stockholm restaurants from Overture Maps (open data, CDLA-Permissive-2.0), served from a bundled file, so it works when Overpass is down. Params: `lat`, `lng` (required), `radius_m` (50-5000, default 600), `limit` (1-300, default 100).

```json
{ "source": "overture", "restaurants": [
  { "id": "overture:b38a3c58-...", "name": "Moldau", "lat": 59.3155, "lng": 18.0300, "category": "european_restaurant",
    "website": "http://...", "phone": "+468847548", "address": "Bergsunds strand 33", "confidence": 1, "distance_m": 120 } ] }
```

`/menu` also accepts these `overture:<id>` ids. It returns `name`, `phone`, `address`, `website`, and `source: "overture"` (or `"website"` when dish prices were scraped from the site).

Optional `live=1`: tries OpenStreetMap (Overpass mirrors in parallel, 4 s budget, 10 min cache) first and returns `source: "osm"` with ids `osm:<node|way|relation>:<n>`. If Overpass is down it silently returns the Overture list (`source: "overture"`). Without `live=1` the answer is always the fast bundled Overture list.

Currency: prices are in SEK (Swedish kronor) by default. Scraped pages keep their own currency when a symbol like € or $ is found.

## Why a menu is empty

When `/menu` finds no items it adds `empty_reason` (`no_website`, `site_unreachable`, `menu_is_pdf_or_image`, `no_readable_menu`) and a human-readable `empty_message`. UIs can show `empty_message` instead of a generic "no menu".
