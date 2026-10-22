# Restaurant Discovery Contract

## Owner

Team `daniela` owns restaurant discovery and contact data.

## Endpoint

`GET /t/daniela/search`

### Query parameters

| Name | Required | Description |
| --- | --- | --- |
| `lat` | Yes | Latitude from -90 to 90. |
| `lng` | Yes | Longitude from -180 to 180. |
| `radius_m` | No | Search radius from 100 to 5,000; defaults to 1,500. `radiusMeters` remains accepted as an alias. |
| `cuisines` | No | Comma-separated cuisine tags, such as `italian,japanese`. `cuisine` remains accepted as an alias. |
| `price_min` | No | Lowest accepted price level from 1 to 4. |
| `price_max` | No | Highest accepted price level from 1 to 4. |
| `limit` | No | Result limit from 1 to 50; defaults to 20. |

### Response

```json
{
  "restaurants": [
    {
      "restaurant_id": "osm:node/123",
      "name": "Example Bistro",
      "lat": 59.3293,
      "lng": 18.0686,
      "cuisines": ["italian"],
      "price_level": 2,
      "address": "Example Street 1, Stockholm",
      "phone": "+46 8 123 45 67",
      "website": "https://example.test",
      "openingHours": "Mo-Su 11:00-22:00",
      "source": "openstreetmap"
    }
  ]
}
```

`restaurant_id`, `lat`, and `lng` are the cross-team identity fields. Consumers must tolerate missing optional
restaurant fields.

## Management Statistics

`GET /t/daniela/stats` powers the management tile at `/colony/daniela/`.

```json
{
  "generated_at": "2026-10-22T10:40:00.000Z",
  "period_seconds": 300,
  "uptime_seconds": 120,
  "searches": {
    "total": 42,
    "recent": 12,
    "errors_recent": 1,
    "cache_hit_rate_recent": 0.5,
    "average_latency_ms_recent": 164
  },
  "active": {
    "users_recent": 4,
    "restaurants_recent": 31
  }
}
```

“Users” means unique anonymous search clients observed during the five-minute reporting window.
The service stores no user profile and never exposes client identifiers.

## Provider Discovery

The initial provider is [OpenStreetMap Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API),
which exposes restaurant points and contact tags without application credentials. The server calls it,
never the browser, and uses a short in-memory cache to reduce public-service load. `OVERPASS_URL` can
override the endpoint for local tests or a hosted provider.

[Nominatim](https://nominatim.org/release-docs/develop/api/Search/) remains an optional future
geocoding provider for text-to-location input; it is not needed when the map supplies coordinates.
