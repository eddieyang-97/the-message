# 风声 Web App MVP — Implementation Handoff

_Last updated: 15 July 2026_

This document is the implementation handoff for the custom physical edition of 《风声》.  
The physical deck audit is complete and confirmed. For individual card instances, `cards.ts` is the authoritative source.

---

## 1. Product scope

Build a private browser-based game for 2 or 5–8 friends.

### MVP includes

- Private rooms and room codes
- Hidden factions and private hands
- Server-authoritative rules and hidden information
- Legal-action enforcement
- Reconnection after refresh or disconnect
- Chinese-only player-facing UI
- Complete support for the audited 87-card physical deck
- A deliberate 2-player duel variant with its own 73-card deck
- Deterministic and auditable game-state transitions

### Excluded from MVP

- Characters and character abilities
- Expansions
- Bots
- Public matchmaking
- Rankings
- Spectators
- User accounts/passwords
- Heavy animation

Correctness and auditability take priority over scalability, abstraction, and visual polish.

---

## Design principles

### Player-facing language

All player-facing text must be Chinese, including lobby text, buttons, prompts, validation errors, game logs, and reconnection messages.

Internal TypeScript identifiers, filenames, database fields, and protocol types may use English.

### Separation of responsibilities

- Executable rules belong in typed `.ts` modules.
- Physical card data belongs in the typed `cards.ts` manifest.
- Human-readable rules and unresolved decisions belong in `.md` files.
- Do not encode unresolved rule assumptions inside card data.

### Prefer explicit rules over premature abstraction

Prefer explicit card-specific handlers and validators over a generic effect DSL during MVP.

Extract shared abstractions only after two or more confirmed rules have genuinely identical timing and semantics.

Cards such as 离间, 转移, 截获, 掉包, and 锁定 may look similar at a high level, but their legal timing, priority, restoration, and information effects differ.

### Authoritative state invariants

Every accepted command must leave the authoritative game state valid.

Run invariant checks after every transition in development and tests. Never rely on a later phase to repair temporarily invalid authoritative state.

### Server-generated legal actions

The rules engine is responsible for generating legal actions.

The client renders those actions and submits the selected command. It must not independently determine whether an action is legal.

### Stable physical-card identity

Cards are physical instances, not only card definitions.

Preserve stable physical-card IDs throughout the draw pile, hands, pending transmission, accepted intelligence areas, discard zones, and removed-card zones.

Two cards with the same name may still differ by color, direction-circle icon, transmission method, or private mapping.

### Information visibility is part of correctness

Information access is a rules concern, not merely a UI concern.

Every transition should make clear which resulting information is public, private to one player, private to a subset of players, or server-only.

No hidden information should be inferable from client payload shape, omitted list length, action ordering, or error detail.

---

## 2. Authoritative project files

Keep these files together in the repository:

```text
docs/fengsheng_mvp_handoff.md
src/game/cards.ts
src/game/cards.test.ts
```

Recommended source-of-truth order:

1. `src/game/cards.ts` — individual physical cards and deck invariants
2. This handoff — game rules, timing, and implementation direction
3. Automated tests
4. UI copy and implementation details

Do not reconstruct the deck from family-level counts. Instantiate games from `PHYSICAL_DECK`.

---

## 3. Confirmed physical deck

### Totals

- Physical cards: **87**
- Cards with direction-circle icon: **28**
- Red: **21**
- Blue: **21**
- Black: **42**
- Red-blue dual: **3**

### Transmission totals

- 密电: **41**
- 文本: **10**
- 直达: **31**
- 任意: **5**

### Family totals

| Card | Count |
|---|---:|
| 公开文本 | 5 |
| 试探 | 9 |
| 破译 | 6 |
| 烧毁 | 5 |
| 锁定 | 9 |
| 截获 | 6 |
| 掉包 | 5 |
| 离间 | 5 |
| 秘密下达 | 9 |
| 调虎离山 | 6 |
| 危险情报 | 5 |
| 识破 | 6 |
| 转移 | 5 |
| 增援 | 3 |
| 机密文件 | 3 |

### Important structural checks

- 破译, 截获, 识破, 调虎离山:
  - red ×2, blue ×2, black ×2
  - exactly one circle card in each color
- 锁定:
  - red ×3, blue ×3, black ×3
  - exactly one circle card in each color
- 增援:
  - red ×1, blue ×1, black ×1
- 离间:
  - red ×1, blue ×1, black ×3
  - all direct, no circles
- 机密文件:
  - three red-blue dual cards
  - all direct, no circles
- 危险情报:
  - five black cards
  - printed transmission choice is 任意
- 秘密下达:
  - red ×3, blue ×3, black ×3
  - every physical card stores its own word-to-color mapping
- 试探:
  - three identity-code variants
  - six draw/discard variants
  - each faction is the draw faction twice
  - for each draw faction, one copy has a circle and one does not

The audited circle positions are encoded directly in `cards.ts`. Do not derive them from family assumptions.

---

## 4. Factions and victory

### 军情

The entire 军情 team wins when any **living** 军情 player has at least three blue intelligence.

### 潜伏

The entire 潜伏 team wins when any **living** 潜伏 player has at least three red intelligence.

### 特工

Each 特工 is independent.

A living 特工 personally wins when they have at least six physical intelligence cards of any colors.

### Faction distribution

| Players | 军情 | 潜伏 | 特工 |
|---:|---:|---:|---:|
| 2 | 1 | 1 | 0 |
| 5 | 2 | 2 | 1 |
| 6 | 2 | 2 | 2 |
| 7 | 3 | 3 | 1 |
| 8 | 3 | 3 | 2 |

### Two-player duel variant

The 2-player game is a deliberate reduced variant, not the standard physical-game configuration.

- Assign one 军情 and one 潜伏. Do not include 特工.
- Both players can infer the opponent's faction from their own faction and the known distribution.
- Build the duel deck from `PHYSICAL_DECK`, preserving every retained physical card's stable ID and printed properties.
- Remove all 6 截获 cards.
- Remove only the 3 identity-code 试探 cards.
- Keep all 6 draw/discard 试探 cards; their function effects remain legal.
- Remove all 5 离间 cards because there is no meaningful third target for redirection.
- The resulting duel deck contains exactly 73 physical cards.
- Do not change `PHYSICAL_DECK` or its standard 87-card invariants. Apply the duel filter during game initialization.
- Maintain separate automated invariants for the duel deck composition.

---

## 5. Death and intelligence resolution

A player dies immediately upon having three black intelligence.

When intelligence is accepted:

1. Move the physical card into the receiver’s intelligence area.
2. Check whether the receiver now has three black intelligence.
3. If dead, stop resolving that intelligence for the receiver.
4. If alive, resolve any on-receive effect.
5. Check victory.

Death takes priority over both on-receive effects and victory.

A 特工 who reaches six total cards by receiving their third black intelligence dies and does not win.

Intelligence in front of dead players remains on the table.

---

## 6. Turn setup

- Every player starts with 2 cards in both the 2-player duel and standard 5–8-player games.
- Deal starting hands from the shuffled mode-specific deck without exposing card identities.
- The active player draws 2 cards at the start of their turn.
- `seatOrder` records the players in clockwise table order, and normal turns advance clockwise.
- Whether the first player performs the normal turn-start draw remains unresolved and must not be assumed in code.
- Initial active-player selection and whether dead seats are skipped remain unresolved.

---

## 7. Transmission model

### Default direction

- 密电 defaults to clockwise.
- 文本 defaults to clockwise.
- A card with a direction-circle icon lets the sender choose clockwise or counterclockwise when transmission begins.
- The selected direction remains fixed for that transmission.
- 直达 ignores table direction.

### Receiver response

The intended recipient chooses:

- 接收
- 不接收

If declined:

- 密电 and 文本 continue along their fixed route.
- 直达 returns to the sender.

Use explicit server state for the current intelligence, intended recipient, fixed route, direction, and response window.

---

## 8. Timing and card rules

### 截获

- Played before intelligence is accepted.
- The user becomes the new pending recipient.
- After a successful 截获, there is no ordinary pass/reject step for that interceptor.
- Possible next outcomes include:
  - interceptor accepts
  - another player plays 截获
  - 掉包
  - 识破 or another legal response
- 截获 can itself be intercepted.
- Each 截获 can be countered by 识破.
- If countered, restore the exact previous pending-recipient state.
- 截获 has priority over 锁定.
- The active player cannot play 截获 during their own turn, including intercepting their own intelligence back.

Represent each intercept as a reversible interaction frame rather than mutating only one recipient field.

### 识破

- Counters a legal counterable card or interaction.
- For 截获, restoring the previous pending state must be exact.
- Model counter chains explicitly. Do not infer restoration from the current board alone.

### 锁定

- Only the active player may play it during their own transmission.
- Played before acceptance.
- The current intended recipient must accept and cannot decline.
- 截获 can override the locked recipient because 截获 has priority.

### 掉包

- Played before intelligence is accepted.
- Replace the pending intelligence with the 掉包 card.
- Discard the original intelligence face up.
- Preserve the original transmission method, route, and direction.
- The replacement 掉包 is face up.
- When a 掉包 card is sent normally from hand as intelligence, its printed method is 文本.

### 转移

- Only the active sender may use it.
- Only when their own transmitted intelligence returns to them during their turn.
- Choose a different intended recipient.
- This does not cause immediate acceptance.
- Normal response timing resumes.
- 截获 remains legal.

### 调虎离山

Implement from the exact card text represented by the physical edition. Keep its play legality and effect in a dedicated validator/resolver rather than a generic redirect abstraction.

### 离间

May redirect the target of:

- 试探
- 锁定
- 转移
- 公开文本
- 危险情报

The new target cannot be the original target.

### 破译

Allows the player to inspect a 密电 or 直达 intelligence before deciding whether to accept or decline.

### 烧毁

- May be played during any phase.
- Targets only intelligence already accepted and on the table.
- Cannot target 危险情报.

### 危险情报

As a function card:

1. Choose another player.
2. Inspect their hand.
3. Choose one card from that hand.
4. Discard it.

As intelligence:

- It is black.
- The sender chooses 密电, 文本, or 直达 when transmission starts.
- Store the selected method in transmission state.

### 增援

As a function card, draw:

- one card normally
- plus one additional card per black intelligence in front of the user

A living player can therefore draw at most three cards from this effect.

### 机密文件

As a function card:

- Count all true intelligence currently on the table.
- Include intelligence in front of dead players.
- If count is at least 4, draw 2.
- If count is at least 7, draw 3.

As intelligence:

- Red-blue dual
- Direct
- Counts as red for red conditions
- Counts as blue for blue conditions
- Counts as one physical card for 特工
- Is not black
- Satisfies a red or blue 秘密下达 requirement, but not a black requirement

### 公开文本

As a function card during the active player’s action phase:

1. Choose another player.
2. Give that player the played 公开文本 card.
3. Randomly take one card from their hand without inspecting it first.
4. If the obtained card is also 公开文本, discard the obtained card face up.

As accepted intelligence:

- Red version:
  - 潜伏 must discard 1
  - 军情 and 特工 choose draw 1 or discard 1
- Blue version:
  - 军情 must discard 1
  - 潜伏 and 特工 choose draw 1 or discard 1
- Black versions:
  - one subtype per faction
  - the matching faction must draw 1
  - the other two factions choose draw 1 or draw 2

Death is checked before this on-receive effect.

### 秘密下达

- Played before another player begins transmitting.
- The user declares one printed code word.
- The physical card’s private mapping determines the required color.
- The target must send matching intelligence when possible.
- If the target claims none exists, the server verifies the hand.
- The player who used 秘密下达 may inspect the hand when the claim is made.
- Used face down.
- Included in later reshuffles.

The mapping is card-specific and stored in `cards.ts`.

### 试探

Used face down and permanently excluded from reshuffles.

Two variants exist.

#### Identity-code variant

Each physical card contains a private faction-to-public-code mapping.

The target chooses either:

- publicly say the code corresponding to their true faction; or
- let the card user choose a card from their hand

Only the user of 试探 knows the exact mapping on that physical card.

#### Draw/discard variant

One faction draws 1. The other two factions discard 1.

The draw faction is encoded per physical card in `cards.ts`.

---

## 9. Discards and reshuffling

Unless stated otherwise, discarded cards are face up.

Exceptions:

- Used 试探 is face down and permanently removed from reshuffles.
- Used 秘密下达 is face down but eligible for reshuffle.

When the draw pile is empty:

1. Gather all eligible face-up discards.
2. Add used 秘密下达.
3. Exclude all used 试探.
4. Shuffle to form the new draw pile.

Keep separate server-side zones rather than a single discard array:

```ts
type DiscardZones = {
  publicEligible: CardId[];
  hiddenSecretOrders: CardId[];
  removedProbes: CardId[];
};
```

---

## 10. Recommended engine architecture

Use a server-authoritative deterministic rules package.

Recommended concepts:

```ts
type GameState = {
  phase: GamePhase;
  activePlayerId: PlayerId;
  players: Record<PlayerId, PlayerState>;
  drawPile: CardId[];
  discardZones: DiscardZones;
  transmission?: TransmissionState;
  interactionStack: InteractionFrame[];
  winner?: WinnerState;
};
```

The client should receive only:

- projected public state
- that player’s own private state
- the current prompt
- legal action descriptors

Do not send the complete authoritative state to clients.

### Prefer explicit transitions

Use commands such as:

```ts
type GameCommand =
  | { type: "START_TRANSMISSION"; cardId: CardId; method?: TransmissionMethod; direction?: Direction; targetId?: PlayerId }
  | { type: "ACCEPT_INTELLIGENCE" }
  | { type: "DECLINE_INTELLIGENCE" }
  | { type: "PLAY_INTERCEPT"; cardId: CardId }
  | { type: "PLAY_COUNTER"; cardId: CardId; targetInteractionId: string }
  | { type: "PLAY_SWAP"; cardId: CardId }
  | { type: "CHOOSE_TARGET"; targetId: PlayerId }
  | { type: "CHOOSE_OPTION"; optionId: string };
```

Every command should go through:

1. authorization
2. phase/timing validation
3. card-specific validation
4. deterministic state transition
5. invariant checks
6. event-log emission

### Interaction stack

Use explicit frames for unresolved effects:

```ts
type InteractionFrame = {
  id: string;
  kind: string;
  sourcePlayerId: PlayerId;
  sourceCardId: CardId;
  snapshot: ReversibleInteractionSnapshot;
  legalResponders: PlayerId[];
};
```

This is especially important for chained 截获 and 识破.

---

## 11. Testing priorities

Before UI work, add engine tests for:

1. three-black death before victory
2. 特工 receiving sixth card as third black
3. red-blue dual-card victory counting
4. decline routing for all transmission methods
5. fixed circle-selected direction
6. direct intelligence returning to sender
7. locked recipient overridden by 截获
8. chained 截获 with nested 识破 restoration
9. active player forbidden from using 截获 on their turn
10. 掉包 preserving original route and method
11. 转移 reopening normal response timing
12. 烧毁 rejecting pending intelligence and 危险情报
13. 公开文本 death-before-effect ordering
14. 秘密下达 server verification
15. hidden discard and reshuffle eligibility
16. information projection: no hand, faction, mapping, or face-down leakage

Run `cards.test.ts` as a deck-data gate in CI.

---

## 12. Remaining decisions before a complete game

The deck audit is finished. Do not reopen it unless a failing test or physical-card comparison identifies a specific conflict.

The remaining work is implementation and a small number of gameplay-policy decisions:

- starting hand size
- draw/action/end-turn sequence
- hand limit and forced discard rules
- exact initial active-player selection
- disconnect timeout and host controls
- whether abandoned games can be resumed after server restart
- any still-unrecorded exact printed wording for 调虎离山
- precise generic 识破 eligibility beyond the confirmed 截获 interaction
- whether multiple 掉包 responses may chain in every timing window

Keep these decisions centralized in `docs/rules-decisions.md` rather than burying them in code.

---

## 13. Immediate Codex task

Start with the rules package, not the UI.

Suggested first prompt:

> Read `docs/fengsheng_mvp_handoff.md`, `src/game/cards.ts`, and `src/game/cards.test.ts`. Treat them as authoritative. First run the existing tests and inspect the repository. Then propose a minimal TypeScript domain model and implementation plan for a deterministic server-authoritative rules engine. Do not implement UI or networking yet. Identify any rule decisions that block the engine, but do not invent answers. After the plan, implement the smallest vertical slice: deck initialization, faction assignment, player-private state projection, and invariant tests.

After that vertical slice, implement transmission and response timing before individual action cards.

---

## 14. Definition of done for the first engine milestone

- Tests pass
- A game can be initialized for 2 or 5–8 players
- Faction counts are correct
- Standard games shuffle the 87-card physical deck without duplicating or losing cards
- 2-player games shuffle the confirmed 73-card duel deck without duplicating or losing retained cards
- Each client projection reveals only legal information
- A player can start 密电, 文本, or 直达 transmission
- Circle direction is selected and fixed
- Intended recipients can accept or decline
- Route progression is deterministic
- Death and victory order is tested
- State transitions emit readable Chinese audit events
