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

Notes:
- `source` is `"mock"`, `"osm"`, `"website"` etc. Mock data is always labelled.
- `days`/`offers` may be empty arrays; `menu_url` may be `null`.
- `price` may be `null`.

Errors: `400 {"error": "<what is missing or invalid>"}`.
