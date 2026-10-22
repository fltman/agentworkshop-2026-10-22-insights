# Contract: Visit timing (module 5), team omidteam

## Request

`GET /t/omidteam/timing?id=<restaurant id>&lat=<lat>&lng=<lng>&from=YYYY-MM-DD&to=YYYY-MM-DD&maxWaitMinutes=15&meal=lunch|dinner|any`

- `id` required (the shared stable restaurant id). `lat`, `lng` optional.
- `from`/`to` default to today; range max 14 days. `maxWaitMinutes` default 15. `meal` default `any`.
- Errors: 400 `{ "error": "..." }`.

## Response (200)

```json
{
  "restaurant_id": "osm:node/123", "lat": 59.33, "lng": 18.06, "source": "heuristic-model",
  "days": [{
    "date": "2026-10-23",
    "hours": [{ "hour": 12, "crowd": 78, "level": "high", "est_wait_minutes": 27 }],
    "best_times": [{ "time": "11:00", "crowd": 30, "est_wait_minutes": 4 }],
    "busiest": { "time": "20:00", "crowd": 85 },
    "within_max_wait": true
  }]
}
```

`crowd` is 0-100, `level` is low|medium|high. `hours` covers 08-23. `best_times` has up to 3 slots.

Also: `GET /t/omidteam/health`. Frontend widget: `/colony/omidteam/?id=...&from=...&to=...` (embeddable).

Optional extras (all additive, failures fall back silently):
- `country=SE` (ISO 2-letter): public holidays via Nager.Date raise crowd slightly.
- `lat`+`lng` with dates within ~16 days: Open-Meteo rain probability lowers crowd slightly.
- `id` like `osm:node/123`: OSM opening_hours (hours get `open` true/false, closed hours have crowd 0) and amenity type.
- `source` lists what was used, e.g. `osm+weather+holidays+heuristic-model`.

Note: data is a heuristic model (meal peaks, weekday/weekend, per-restaurant bias), not real visitor data.
