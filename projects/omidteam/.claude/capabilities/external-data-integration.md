---
name: external-data-integration
type: capability
domain: api-integration
tools: Read, Edit, Bash, WebFetch
model: haiku
energy: 60
spawned: 2026-10-22
can-merge-with: [crowd-timing-model]
---

# External Data Integration

## What This Enables

Adds free keyless data sources to the timing module with the proven pattern: short timeout, TTL cache with a short retry window on failure, silent fallback to the heuristic, `source` field listing what was used. Already used for OSM Overpass, Open-Meteo and Nager.Date.

## Activation Triggers

- api-scout reports a new usable API
- A provider is flaky or rate-limited (Overpass 502/406, needs User-Agent)

## Boundaries

Never breaks a request because a provider failed. No secrets, no new npm dependencies.

## Evolution History

- 2026-10-22: Spawned (need: same fetch/cache/fallback work done three times in one hour)
