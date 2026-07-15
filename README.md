# 风声 Web App

A private browser-based implementation of a custom physical edition of 《风声》 for 5–8 players.

## Status

Early development.

Current focus:

- authoritative game rules
- audited physical deck data
- deterministic server-side game engine
- hidden-information-safe player projections
- rule and invariant tests

UI and networking come later.

## Repository structure

```text
docs/
  fengsheng_mvp_handoff.md
  rules-decisions.md

src/game/
  cards.ts
  cards.test.ts
```

## Important files

### `src/game/cards.ts`

Authoritative manifest for the confirmed 87-card physical deck.

It includes stable physical card IDs, names, colors, transmission methods, direction-circle markers, card-specific variants, and integrity checks.

### `src/game/cards.test.ts`

Vitest coverage for deck counts, card structure, color distribution, circle counts, and known invariants.

### `docs/fengsheng_mvp_handoff.md`

Main implementation handoff covering product scope, rules, design principles, architecture, testing priorities, and implementation order.

### `docs/rules-decisions.md`

Tracks unresolved gameplay questions. Do not invent answers in code; record unresolved questions here until confirmed.

## Confirmed deck totals

- 87 physical cards
- 28 cards with direction-circle icons
- 21 red
- 21 blue
- 42 black
- 3 red-blue dual cards

## Development principles

- correctness over scalability
- server-authoritative game state
- deterministic state transitions
- explicit timing and interaction handling
- stable physical card identity
- server-generated legal actions
- strict hidden-information projection
- Chinese-only player-facing UI
- English identifiers are allowed internally
- prefer explicit card handlers over a premature generic effect system

## Setup

Install Node.js first, then:

```bash
npm install
```

Run tests:

```bash
npm test
```

Run tests in watch mode:

```bash
npm run test:watch
```

Run TypeScript checks:

```bash
npm run typecheck
```

## Recommended implementation order

1. deck initialization
2. faction assignment
3. player-private state projection
4. transmission routing
5. accept / decline flow
6. death and victory resolution
7. 截获 / 识破 interaction stack
8. remaining function cards
9. room server and persistence
10. Chinese UI

## Source of truth

Use this priority order:

1. `src/game/cards.ts`
2. `docs/fengsheng_mvp_handoff.md`
3. `docs/rules-decisions.md`
4. tests and implementation details

Do not reconstruct the deck from family-level counts.
