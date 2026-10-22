---
name: restaurant-discovery
type: capability
domain: backend
tools: Read, Grep, Glob, Bash, Edit
energy: 50
spawned: 2026-10-22
can-merge-with: [restaurant-provider-adapters]
---

# Restaurant Discovery

## What This Enables

Design and implement the team-owned restaurant search API. Normalize provider data into a stable
restaurant result that supports location, cuisine, and price filters.

## Activation Triggers

- Defining the restaurant discovery contract
- Implementing search endpoints or result normalization
- Selecting and integrating a public restaurant-data provider

## Operating Protocol

1. Establish the API contract before implementation.
2. Keep provider-specific fields inside adapters and expose only normalized results.
3. Validate request parameters and return actionable upstream failures.
4. Test the endpoint against representative provider responses.

## Boundaries

This capability does not own map rendering, review analysis, menus, or visit-time recommendations.

## Evolution History

- 2026-10-22: Spawned for the restaurant-discovery module.
