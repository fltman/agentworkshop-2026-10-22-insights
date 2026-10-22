---
name: resilient-restaurant-sources
type: capability
domain: data
tools: Read, Grep, Glob, Bash, Edit
energy: 70
spawned: 2026-10-22
can-merge-with: [restaurant-discovery]
---

# Resilient Restaurant Sources

## What This Enables

Keep restaurant discovery available when public providers are slow, rate limited, or unavailable.
Own provider health, request policy, cache freshness, mirror selection, and clearly labelled fallbacks.

## Activation Triggers

- Comparing restaurant search APIs
- Adding a mirror, fallback, or provider-specific adapter
- Handling provider rate limits, timeouts, or capacity failures
- Tightening the discovery deadline or cache policy

## Operating Protocol

1. Prefer documented public APIs that provide location and restaurant metadata.
2. Never expose provider credentials or raw error bodies to clients.
3. Bound provider work by an end-to-end deadline; do not serially exhaust long per-provider timeouts.
4. Map provider responses into the discovery contract at the adapter boundary.
5. Serve cached or static data only with an explicit source label.

## Boundaries

This capability does not define client UI behavior or modify modules owned by other teams.

## Evolution History

- 2026-10-22: Spawned to isolate upstream API variability.
- 2026-10-22: Mutated to cover recurring provider resilience and fallback work.
