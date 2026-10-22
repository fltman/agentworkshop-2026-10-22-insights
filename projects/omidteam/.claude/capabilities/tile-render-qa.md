---
name: tile-render-qa
type: capability
domain: frontend
tools: Read, Edit, Bash
model: haiku
energy: 60
spawned: 2026-10-22
can-merge-with: [contract-guardian]
---

# Tile Render QA

## What This Enables

Before any change to board/public/colony/omidteam/index.html is delivered: syntax-check the inline script, serve the tile with a tiny local node server that mounts board/plugins/omidteam and proxies /t/* to the live board, render it in headless Chrome (screenshot plus dump-dom) and look at the picture. Also keeps the tile free of demo data, motion respectful of prefers-reduced-motion, and the TableWiseSelect sync intact.

## Activation Triggers

- Any edit of the tile
- A teammate reports the tile looks wrong or is empty

## Notes

- macOS has no `timeout` command; run Chrome without it.
- Use --virtual-time-budget=15000 for screenshots; stop the server with stop_bash.
- Use textContent, never innerHTML.

## Boundaries

Our own tile folder only. Never edits other teams' tiles.
