# Flux Agent Live Smoke Contract

`node scripts/tablewise-smoke.mjs` verifies the deployed TableWise group-app integration without
adding dependencies.

Environment variables:

| Name | Default | Purpose |
| --- | --- | --- |
| `TABLEWISE_URL` | `https://insights.torget.bjarby.com` | Base URL of the deployed board |
| `TABLEWISE_DATE` | Today in UTC | Visit date sent to menu and timing |
| `TABLEWISE_TIMEOUT_MS` | `10000` | Per-request timeout |

The runner checks:

1. The group tile is marked as the group application and publishes the selection script.
2. The restaurant fallback returns at least one real restaurant.
3. The selected restaurant works with menu, reviews, and timing endpoints.

An empty real menu or zero real reviews is a passing response when the documented arrays and source
fields are present. The runner exits non-zero only for an unavailable endpoint or a contract-shape
failure.
