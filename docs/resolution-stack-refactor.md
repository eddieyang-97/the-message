# Resolution stack refactor

Status: completed on 2026-07-23.

This document proposes a behavior-preserving refactor of the interaction state
described in [game-engine-architecture.md](game-engine-architecture.md). It does
not authorize rule, UI wording, timing, privacy, bot-policy, or log changes.

## Problem statement

The current engine represents one conceptual mechanism—play an action, ask all
responders, allow counters, then resolve—through several parallel structures:

- global `reactionWindow`;
- transmission `interactionStack` and `pending...` fields;
- `activeFunctionAction` plus `activeFunctionStack`;
- `pendingSecretOrder` plus `secretOrderStack`;
- nested `burnContexts`, each with another frame list and a cloned suspended
  reaction window.

Projection, legal-action generation, invariant checks, server timer
fingerprints, and counter dispatch all switch on these structures separately.
Played cards are also often placed in terminal zones before resolution.

This makes valid rule changes vulnerable to cross-layer omissions. The recent
post-`转移` command-boundary bug is representative: engine resolution, legal
actions, command dispatch, and arrival of a new snapshot must all agree on
which response context is active.

## Goals

- One authoritative owner for the active response window and response frames.
- Natural nesting: interrupting `烧毁` pushes a context and later pops it.
- One generic responder-advance operation.
- One shared counter-chain mechanism with typed domain snapshots.
- One semantic resolving zone for unresolved physical cards.
- Stable player/spectator projection and `GameCommand` contracts during the
  migration.
- Stronger, simpler invariants.
- Small commits with full behavior characterization at every step.

## Non-goals

- No rules changes or response-order changes.
- No change to public/private log content.
- No client-side prediction of legal actions.
- No persistence/database migration.
- No bot-policy or evaluation change.
- No arbitrary event-sourcing rewrite.
- No attempt to eliminate domain-specific transmission/function state where it
  expresses real rules rather than response plumbing.

## Target model

The target is a discriminated stack of resolution contexts. Exact TypeScript
names may change during implementation, but ownership should follow this
shape:

```ts
type ResolutionContext =
  | ReceiptResolution
  | FunctionResolution
  | SecretOrderResolution
  | BurnResolution;

interface ResolutionBase<Kind, Frame, Payload> {
  id: string;
  kind: Kind;
  window: ReactionWindow;
  frames: Frame[];
  payload: Payload;
  status: "responding" | "readyToResolve";
}

interface GameState {
  resolutionStack: ResolutionContext[];
  // Existing domain state remains while it is still independently useful.
}
```

The top context is the only active response context. Lower contexts are paused
in place and are not cloned. A normal function, secret order, or receipt
reaction is a root context. An interrupting burn is pushed above it; a nested
burn pushes again.

The context discriminant selects domain-specific payload and snapshot types,
while shared helpers handle responder validation, pass advancement, top-frame
selection, interaction IDs, and common counter validation.

### Context ownership

| Context | Owns | Resolves to |
| --- | --- | --- |
| Receipt | current receipt reaction window, transmission response frames, pending response-card payload | updated transmission, new recipient/window, or receipt decision |
| Function | function payload, target/counter state, function response frames | function effect or cancellation/follow-up choice |
| Secret order | offer/reaction payload and frames | selection constraint or cancelled order |
| Burn | burn target, counter state, frames | destroyed/unchanged intelligence, then parent resume |

Lock offer and final accept/decline are receipt prompts but not counter stacks.
They may remain in `TransmissionState.receiptStage` initially. A later cleanup
can expose a shared current-prompt selector without forcing them into card
resolution.

## Resolving physical cards

Do not add a second `resolvingCards` array. The ordered frames already identify
every physical card participating in resolution. Treat unique frame
`sourceCardId` values across `resolutionStack` as the resolving physical zone.

Card conservation becomes:

```text
draw pile
+ hands
+ accepted intelligence
+ public discard
+ hidden resolved orders
+ removed probes
+ transmitted intelligence
+ resolving frame cards
= current physical deck exactly once
```

This eliminates the current double meaning of `publicDiscard`.

At context completion, each source card has a typed destination policy:

- ordinary function/response/counter cards -> public discard;
- successful function `公开文本` -> target hand;
- countered function `公开文本` -> public discard;
- successful `掉包` -> transmitted intelligence, replaced card -> discard;
- countered `掉包` -> discard;
- resolved `秘密下达` -> hidden secret-order discard;
- `试探` -> removed probes;
- `烧毁` and `识破` -> public discard;
- destroyed target intelligence -> public discard.

Settlement must be idempotent within one transition and checked by invariants.
Projection should display only terminal `publicDiscard` cards; it should no
longer need a pending-`公开文本` filter.

## Counter model

The current snapshot restoration approach is sound and should be retained.
Each domain supplies:

- how to capture its reversible snapshot;
- how to restore a target frame's snapshot;
- how to capture state before the counter;
- the allowed counter card and actor restrictions.

A shared `playCounterInContext` performs common work:

1. require the actor to be the current responder;
2. require the requested target to be the top frame;
3. reject self-countering and invalid hand/card use;
4. capture the pre-counter snapshot;
5. restore the target snapshot;
6. move the counter card from hand into a new resolving frame;
7. restart responses anchored on the counter's target/source as confirmed by
   current rules;
8. assert invariants.

Domain adapters prevent one universal snapshot type from becoming an unsafe
bag of optional fields.

## Passing and continuation

Use one shared operation to advance `context.window.nextResponderIndex`.
Reaching the end sets the top context to `readyToResolve`; a domain resolver
then performs its typed continuation.

Nested interruptions no longer need `suspendedReactionWindow` or
`suspendedReactionCompleted`:

- parent context stays on the stack with its exact responder index;
- burn pushes a child context;
- death/host cleanup may mark any affected context `readyToResolve` through a
  shared context-normalization helper;
- resolving the child pops it and resumes or resolves the now-top parent.

No function callbacks belong in `GameState`; continuations must be serializable
discriminated data and pure resolver code.

## Read model during migration

Introduce selectors before changing storage:

- `currentResolutionContext(state)`;
- `currentReactionWindow(state)`;
- `currentResponseFrames(state)`;
- `topResponseFrame(state)`;
- `currentResponderId(state)`;
- `currentPromptFingerprint(state)`.

Initially these selectors read legacy fields. Projection, legal-action
generation, invariant code, `ReactionTimeoutScheduler`, and bot-facing code
move to selectors first. Storage can then change behind a smaller boundary.

The server should not import raw engine stack fields after this step.

## Migration plan

### Phase 0: clean behavioral baseline

- Land all known rule fixes independently.
- Keep [rules-decisions.md](rules-decisions.md) synchronized.
- Require full tests, typecheck, and production build.

### Phase 1: characterization

Add tests that freeze current behavior for:

- multi-level `识破` in each domain;
- `离间` followed by counter/counter-counter;
- successful and countered transfer/swap/lure/decrypt;
- reaction rounds that reopen after those actions;
- burn interrupting each supported window;
- nested burns and death during nested burn;
- resolving-card visibility and conservation;
- player versus spectator response-stack privacy;
- room/session command dispatch and reconnect snapshots;
- timer fingerprints and stale scheduled callbacks.

No production state shape changes occur in this phase.

### Phase 2: selectors and shared primitives

- Centralize current-window/frame/top-frame lookup.
- Centralize response-window creation and pass advancement.
- Centralize interaction ID allocation and common frame fields.
- Move projection and timer fingerprinting to selectors.
- Preserve all legacy storage and external types.

### Phase 3: migrate function and secret-order contexts

These domains are bounded and prove typed payload/snapshot adapters without the
full transmission lifecycle.

- Move response windows and frames into `resolutionStack` one domain at a time.
- Keep post-response private choices in their existing domain state initially.
- Move their unresolved physical cards into frame ownership.
- Delete each legacy stack only after its domain is fully migrated.

### Phase 4: migrate receipt interactions

- Create the receipt root context for intelligence reactions.
- Move transmission response frames and pending action payloads into it.
- Preserve `TransmissionState` fields that describe durable receipt rules and
  commitments.
- Reproduce all server-boundary transfer/swap/intercept/counter tests.
- Remove `interactionStack` and migrated `pending...` fields.

### Phase 5: migrate burn nesting

- Push burn contexts onto `resolutionStack`.
- Preserve parent contexts in place.
- Replace suspended-window clone/restore with normal stack pop/resume.
- Remove `burnContexts`, `suspendedReactionWindow`, and
  `suspendedReactionCompleted`.

### Phase 6: finish physical-zone cleanup

- Ensure all unresolved played cards live only in resolution frames.
- Settle cards to final zones on context completion.
- Remove projection filters compensating for temporary discard.
- Strengthen conservation checks for resolution-frame uniqueness and terminal
  settlement.

### Phase 7: remove compatibility state

- Remove global `reactionWindow` after all consumers use the top context.
- Remove obsolete stack selectors/branches and compatibility aliases.
- Simplify `finishPassedReactionWindow` into per-context resolvers.
- Update architecture documentation to make the new model current.

## Compatibility constraints

Throughout migration, preserve:

- `GameCommand` request shapes and command names;
- player/spectator projection shapes unless separately approved;
- response stack IDs for the lifetime of a prompt;
- legal-action timing and responder anchoring;
- public/private visibility and audit wording;
- reconnect behavior and host pause semantics;
- timer behavior and client auto-pass prompt identity;
- bot access only through projections and normal dispatch.

Because production game state is in memory and does not survive deployment,
there is no persisted-state schema migration. That reduces deployment risk but
does not relax reconnect or in-process snapshot correctness.

## Invariants in the target model

The invariant checker should require:

- at most one active top response context;
- every lower context is paused or ready, never independently active;
- every window owner and frame type matches its context discriminant;
- response order and index remain valid for living players;
- frame IDs and physical source card IDs are globally unique;
- every counter targets an earlier frame in the same context;
- every resolving card exists in exactly one frame and no terminal zone;
- every context payload references valid players/cards/domain state;
- empty resolution stack implies no active response window;
- game over contains no unresolved contexts.

## Validation gates

Every migration commit should pass:

1. targeted tests for the migrated domain;
2. full Vitest suite;
3. TypeScript typecheck;
4. production Vite build;
5. `git diff --check`;
6. server/session boundary tests for affected commands;
7. deterministic multi-game bot smoke simulation when projections or legal
   actions change internally.

Before deployment, manually exercise one mobile and one desktop game through a
nested response sequence and reconnect during an active prompt.

## Stop conditions

Stop and separate a change from this refactor if it requires deciding:

- a new rule outcome;
- different response order or eligibility;
- new public/private information;
- changed log wording;
- changed timeout or auto-pass semantics;
- changed bot strategy.

Those decisions belong in their own rule/product change with independent tests
and review.

## Implementation record

### 2026-07-23: read-model boundary started

The first Phase 2 slice was implemented without changing `GameState` storage:

- `currentResolutionContext`, `currentReactionWindow`,
  `currentResponseFrames`, `topResponseFrame`, `currentResponderId`, and
  `currentPromptFingerprint` now provide a single read boundary over the
  legacy fields;
- player and spectator projection select response frames through this boundary;
- the server reaction-timeout scheduler no longer reads raw engine stack fields;
- characterization tests cover empty state, receipt, function, secret-order,
  nested-burn, public response-stack projection, and legacy timer fingerprints.

At this checkpoint mutation, invariant, and resolution code still wrote and
validated the legacy parallel fields. `resolutionStack` had not yet been
introduced.

### 2026-07-23: reaction-window primitives centralized

The second Phase 2 slice preserves the same window data and continuations while
removing scattered construction and pass advancement:

- every new reaction window is created through one builder/opening primitive;
- ordinary target-anchored windows and explicit secret-order responder lists
  share the same construction path;
- `passReaction` validates the actor and delegates responder advancement and
  completion to one primitive;
- cloned/restored windows retain their existing responder index and still bypass
  new-window construction as intended.

At this checkpoint legacy domain resolvers still owned completion after the
last pass.

### 2026-07-23: authoritative stack migration completed

Phases 3 through 7 are complete:

- `GameState.resolutionStack` is the sole owner of active reaction windows and
  response frames for receipt, function, secret-order, and burn domains;
- the legacy `reactionWindow`, `interactionStack`, `activeFunctionStack`,
  `secretOrderStack`, and `burnContexts` state fields have been removed;
- nested burns push contexts above their parent rather than cloning and
  suspending a global window;
- shared interaction IDs, window creation/restoration, passing, projections,
  and server timeout fingerprints all select from the authoritative stack;
- unresolved frame `sourceCardId` values form a real physical resolving zone;
  resolving cards no longer enter public discard, hidden secret-order storage,
  or removed-probe storage before settlement;
- context settlement moves every resolving card exactly once to its rule-defined
  destination, including countered and death-cleanup paths;
- invariants enforce global frame/card uniqueness, context/window agreement,
  stack nesting shape, and an empty stack at game end;
- characterization, engine, server/session boundary, projection, and timer
  tests were migrated to the selector boundary.

The implemented shape preserves command payloads, response order, public and
private information, log wording, timeout behavior, and game rules.
