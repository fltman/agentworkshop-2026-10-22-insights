---
name: restaurant-provider-adapters
type: capability
domain: data
tools: Read, Grep, Glob, Bash, Edit
energy: 60
spawned: 2026-10-22
can-merge-with: [restaurant-discovery]
---

# Restaurant Provider Adapters

## What This Enables

Evaluate public restaurant-data APIs and isolate their authentication, request construction, and
response translation behind provider adapters.

## Activation Triggers

- Comparing restaurant search APIs
- Adding or changing an upstream provider
- Handling provider-specific field or rate-limit behavior

## Operating Protocol

1. Prefer documented public APIs that provide location and restaurant metadata.
2. Never expose provider credentials or raw error bodies to clients.
3. Map provider responses into the discovery contract at the adapter boundary.
4. Keep test fixtures separate from deployable plugin paths named `data`.

## Boundaries

This capability does not define client UI behavior or modify modules owned by other teams.

## Evolution History

- 2026-10-22: Spawned to isolate upstream API variability.
