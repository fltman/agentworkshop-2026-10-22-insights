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
    "hours": [{ "hour": 12, "crowd": 78, "level": "high", "est_wait_minutes": 27, "open": true, "rain_pct": 20 }],
    "best_times": [{ "time": "11:00", "crowd": 30, "est_wait_minutes": 4 }],
    "busiest": { "time": "20:00", "crowd": 85 },
    "within_max_wait": true
  }]
}
```

`crowd` is 0-100, `level` is low|medium|high. `hours` covers 08-23. `best_times` has up to 3 slots.

Also: `GET /t/omidteam/health`. Frontend widget: `/colony/omidteam/?id=...&from=...&to=...` (embeddable).

Optional extras (all additive, failures fall back silently):
- `days[].factors`: array of short strings explaining the estimate, e.g. "lunch peak 12-14", "weekend", "rain expected 17:00-19:00" (additive).
- `GET /health` also reports `opening_hours_cache` {entries, last_lookup {ok, at}}; it never triggers external calls.
- `hours[].rain_pct` (0-100, or null when no forecast): rain probability for that hour (additive field).
- `time=HH:MM` (visit time): response gets `requested` {date, time, crowd, level, est_wait_minutes, open, verdict good|busy|closed, better_time} for the first day, else null.
- Top-level `best_times` [{date, start, end, crowd, est_wait_min}] (one window per day) and `avg_wait_min`, for simple UIs. `max_wait_min` is accepted as an alias of `maxWaitMinutes`.
- `country=SE` (ISO 2-letter): public holidays via Nager.Date raise crowd slightly.
- `lat`+`lng` with dates within ~16 days: Open-Meteo rain probability lowers crowd slightly.
- `id` like `osm:node/123`: OSM opening_hours (hours get `open` true/false, closed hours have crowd 0) and amenity type.
- `source` lists what was used, e.g. `osm+weather+holidays+heuristic-model`.

Note: data is a heuristic model (meal peaks, weekday/weekend, per-restaurant bias), not real visitor data.

## GET /t/omidteam/now (batch, for map pins)

`/t/omidteam/now?ids=a,b,c[&time=HH:MM][&date=YYYY-MM-DD]` returns the crowd for up to 20 restaurants in one call
(default: current hour in Europe/Stockholm, clamped to 08-23). Uses the heuristic model plus opening hours only if
already cached by a /timing call, so it is fast but can differ slightly from /timing (no weather or holidays).

```json
{ "date": "2026-10-22", "hour": 14, "source": "heuristic-model (...)",
  "results": [{ "id": "overture:abc", "crowd": 42, "level": "medium", "est_wait_minutes": 12, "open": true }] }
```
