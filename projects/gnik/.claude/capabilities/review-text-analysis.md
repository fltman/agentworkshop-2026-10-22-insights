---
name: review-text-analysis
type: capability
domain: nlp
tools: Read, Edit, Bash
model: haiku
energy: 60
spawned: 2026-10-22
can-merge-with: [review-ingestion]
---

# Review Text Analysis

## What This Enables
Turns raw review text into suggested meals and red-flag outliers (waits, cleanliness, service, price, disliked dishes) in `board/plugins/gnik/index.js` (`analyze`).

## Activation Triggers
- Tuning dish/flag patterns, severity thresholds or sentiment scoring
- False positives or misses reported by other teams

## Boundaries
Does not store reviews or serve HTTP; does not touch other teams' folders.

## Evolution History
- 2026-10-22: Spawned after PR #3, the first delivered analyzer
