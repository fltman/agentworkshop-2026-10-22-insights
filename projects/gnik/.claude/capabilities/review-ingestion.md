---
name: review-ingestion
type: capability
domain: data
tools: Read, Edit, Bash, WebFetch
model: haiku
energy: 60
spawned: 2026-10-22
can-merge-with: [review-text-analysis]
---

# Review Ingestion

## What This Enables
Gets real review text into the module: the `POST /t/gnik/reviews` store, and finding keyless sources (OSM tags, websites, partner teams' scraped pages) to feed it.

## Activation Triggers
- A new review source is available or requested
- Storage limits, validation or id-format issues (`osm:node/123`)

## Boundaries
Never post or store secrets/API keys; does not change the GET contract without announcing in #build.

## Evolution History
- 2026-10-22: Spawned after PR #7 (no keyless review API exists, so ingestion is its own concern)
