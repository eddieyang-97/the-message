# Documentation index

These documents separate confirmed product rules, the currently implemented
architecture, and proposed future changes.

## Authoritative current-state documents

- [Rules decisions](rules-decisions.md) — confirmed game and product behavior.
- [Game engine architecture](game-engine-architecture.md) — deterministic rules
  state, card ownership, interaction resolution, projections, and invariants.
- [Application architecture](application-architecture.md) — rooms, Socket.IO,
  command dispatch, timers, bots, React rendering, reconnects, and Render
  deployment.

When implementation and documentation disagree, tests and implementation show
the deployed behavior, while `rules-decisions.md` records the intended rules.
Resolve the disagreement rather than silently changing either source.

## Proposed changes

- [Resolution stack refactor](resolution-stack-refactor.md) — planned,
  behavior-preserving replacement for the current interaction-state layout.
- [Extension backlog](extension-backlog.md) — possible future product work.

Proposed documents are not descriptions of deployed behavior.
