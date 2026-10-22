# gnik: Review analysis (module 4)

Backend mounted at `/t/gnik/` (`board/plugins/gnik/index.js`).

## Shared key
Every restaurant is identified by `id` (string, from the discovery module) plus `lat`/`lng`.

## GET /t/gnik/analysis?id=<id>&lat=<lat>&lng=<lng>&name=<name>

Response 200:

```json
{
  "id": "osm:123",
  "review_count": 42,
  "suggested_meals": [
    { "dish": "carbonara", "mentions": 9, "sentiment": 0.82 }
  ],
  "red_flags": [
    { "type": "wait_time|cleanliness|dish_warning|service|price",
      "text": "Long waits reported on weekends",
      "severity": "low|medium|high",
      "evidence_count": 5,
      "evidence": ["up to 3 short quotes (max 200 chars) from the reviews"] }
  ],
  "source": "reviews|mock"
}
```

Errors: 400 `{ "error": "id required" }`. If no reviews are available, lists are empty and `review_count` is 0.

Alias: `/t/gnik/reviews` is identical. `restaurant_id` is accepted as a synonym for `id`; `from`/`to` are accepted and ignored.

GET response also echoes `name` (the `name` query param, empty if not sent). The tile `/colony/gnik/?id=<id>&name=<restaurant name>` shows the name as its header.

Sources (in order): stored reviews (`source: "reviews"`), review-like text from the restaurant's website found via bhaeha-team's menu API or an optional `website` param (`"website"`), otherwise `review_count: 0` with empty lists (`"none"`). Mock data only with `demo=1` (`"mock"`).

## POST /t/gnik/reviews?id=<id>
Body `{ "reviews": ["text", ...] }` (or `{ "review": "text" }`). Stores up to 200 reviews per restaurant; returns 201 `{ id, stored, review_count }`. Once a restaurant has stored reviews, GET returns `source: "reviews"` instead of `"mock"`.

## Example
`GET /t/gnik/analysis?id=osm:123&lat=59.33&lng=18.06&name=Trattoria`

## Changes
Only gnik changes this file; changes are announced in `#build` first.
