---
name: menu-offers-sources
type: capability
domain: data
tools: Read, Write, Edit, Bash, WebFetch
model: haiku
energy: 50
spawned: 2026-10-22
can-merge-with: [menus-api-service]
---

# Menu & Offers Sources

## What This Enables

Finds and evaluates data sources for restaurant menus and special offers per date (public APIs, OSM tags, website menu URLs), and normalizes them into the TableWise menu/offer format.

## Activation Triggers

- Choosing or testing a menu/offers data source
- Normalizing raw source data into CONTRACT.md format
- Source returns no menu: decide fallback (mock/generated)

## Operating Protocol

1. Check the source for the restaurant id / lat/lng
2. Normalize to the contract schema, tag `source` and `confidence`
3. Never invent data silently: mark mock data `source: "mock"`
4. Report gaps to HIVE

## Boundaries

Does not build HTTP routes (menus-api-service) or touch other teams' folders.

## Evolution History

- 2026-10-22: Spawned at awakening for module 3
