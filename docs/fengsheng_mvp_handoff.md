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

## Lobby and room flow

- Landing page offers create room and join by code.
- Creating requires a display name and a fixed player count chosen from 2, 5, 6, 7, or 8. The creator becomes host; capacity cannot change afterward.
- Generate a unique six-letter uppercase `A`–`Z` code, retrying active-room collisions. Code entry is case-insensitive and normalized to uppercase.
- Invite URLs use the code as the final path segment, for example `https://host/ABCDEF`. A valid link asks only for a display name; an invalid/expired link shows a Chinese error and a route home.
- Names support trimmed Chinese/Unicode text of 1–16 characters and must be unique within the room. A reconnect token restores an existing seat rather than creating a duplicate.
- Display numbered seats clockwise. Players move immediately to empty seats; moving to an occupied seat requires an accepted swap request.
- Before game start, players may leave and the host may remove players, including disconnected players. Removal invalidates that seat's reconnect token.
- If the host leaves, transfer host ownership to the longest-present remaining player. Delete an empty in-memory room immediately.
- Reject joins when full. After game start, reject new players and allow only reconnecting seats; spectators are excluded.
- Only the host starts. Require every seat to be occupied and connected; there is no separate ready state and filling the room does not auto-start.
- Host chooses “按当前座位开始” or “随机座位开始”. Preserve displayed order for the first option; uniformly shuffle seats server-side for the second. Then randomize the initial active player separately.
- Pending swap requests expire on start and do not block it.
- Lobby UI shows the code and “复制邀请链接” at the top; clockwise numbered seats with host/connection badges in the main area; player seat/leave controls; and host remove/start controls. Disabled start buttons explain the missing condition in Chinese.
- Add a host-only reaction-timeout dropdown with `关闭 / 10 / 15 / 20 / 30 / 60 秒`, defaulting to `15 秒`.

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
docs/rules-decisions.md
docs/fengsheng_mvp_handoff.md
src/game/cards.ts
src/game/cards.test.ts
```

Recommended source-of-truth order:

1. `src/game/cards.ts` — individual physical cards and deck invariants
2. `docs/rules-decisions.md` — authoritative gameplay and product decisions
3. This handoff — synchronized implementation direction
4. Automated tests
5. UI copy and implementation details

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

Victory is checked immediately after each accepted intelligence and its on-receive effect fully resolves. One atomic resolution adds intelligence to only one receiver, who has exactly one faction, so simultaneous faction/agent victories cannot newly arise. A red-blue card does not create a tie. End the game immediately when the first valid victory is detected; later actions cannot undo it.

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

Whenever a player dies for any reason, immediately reveal their faction to everyone and permanently record it in the public Chinese audit log. Host-imposed death of a disconnected player follows the same reveal rule.

---

## 6. Turn setup

- Every player starts with 2 cards in both the 2-player duel and standard 5–8-player games.
- Deal starting hands from the shuffled mode-specific deck without exposing card identities.
- The active player draws 2 cards at the start of their turn.
- The first player performs this normal 2-card draw before their first action.
- If a draw is attempted with an empty pile, immediately reshuffle eligible discards and continue; if no eligible cards remain, draw as many as possible and finish without error.
- Select the initial active player uniformly at random using server-generated randomness.
- `seatOrder` records the players in clockwise table order, and normal turns advance clockwise.
- Every living active player must complete one intelligence transmission and cannot voluntarily end their turn without doing so.
- Before starting transmission, the active player must retain at least one hand card; voluntary actions that would leave no card to transmit are illegal.
- Before transmission, the active player may play any number of otherwise legal function cards.
- After transmission begins, only actions legal in the current reaction window may be played.
- Immediately before transmission, the active player must discard chosen cards face up until their hand contains at most 7 cards; transmission cannot start above that limit.
- The active player's turn ends immediately when their transmitted intelligence is accepted; they cannot play further active-turn function cards afterward.
- Intelligence is not accepted until every reaction window and mandatory receipt decision for it has resolved, so a turn cannot end with an unresolved transmission interaction.
- Dead players cannot take turns, act, respond, or receive new intelligence. Advance clockwise to the next living player and skip dead seats.
- Dead players cannot be selected as active targets unless a card explicitly references intelligence already in front of dead players.
- Intelligence already in front of dead players remains on the table and may still be referenced by rules that explicitly count or target table intelligence.

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
- Once 直达, 文本, or 密电 returns to its active sender, the sender must accept it unless they first play a legal 转移; they cannot decline it again.
- Other legal reaction actions remain available before that forced acceptance, including 截获. A resolved 转移 creates a new normal receipt cycle for its final target.

Use explicit server state for the current intelligence, intended recipient, fixed route, direction, and response window.

---

## 8. Timing and card rules

### Provisional general reaction order

- Offer reaction priority to one living player at a time, beginning with the next living player clockwise after the pending action's target.
- Continue clockwise through every living player; the target receives the final opportunity before resolution.
- Give each player one server-generated prompt containing pass plus every card and non-card action currently legal for them; do not create separate card-specific prompts.
- The client may later highlight playable hand cards, but that UI choice does not change timing.
- Playing a reaction opens a fresh window beginning with the next living player clockwise after that new action's target.
- Resolve the pending interaction after every living player passes consecutively.
- Skip dead players, but do not skip living players based on their hidden hand contents; doing so would leak information through prompt timing.
- When possible, combine the target's legal card reactions and required target decision in its final prompt.
- Use the declared target as the priority anchor for targeted functions; the interceptor for 截获; the newly declared target for 转移/离间; the current intended recipient for 掉包; and the user for self-effects.
- Treat this policy as provisional until playtesting confirms it.
- Do not put wall-clock timing inside the deterministic rules engine. A future host-configurable room timeout may submit an ordinary pass command through the server layer.

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
- The final successful interceptor is committed to accepting automatically after all reactions finish.
- A successful 截获 removes the previous recipient's 锁定. Do not offer the interceptor a new accept/decline decision, 锁定, or 破译.
- The active player cannot play 截获 during their own turn, including intercepting their own intelligence back.

Represent each intercept as a reversible interaction frame rather than mutating only one recipient field.

### 识破

- Counters any card action that is currently the top unresolved card-action interaction, including another 识破.
- A player cannot counter their own card action.
- Restoring the state before the countered action must be exact.
- Model arbitrary counter chains explicitly. Do not infer restoration from the current board alone.
- Counter chains use the provisional target-anchored clockwise priority system and have no rules-level depth limit.

### 锁定

- Only the active player may play it during their own transmission.
- When intelligence reaches a recipient through a normal receipt route, give the active sender one exclusive sender-first chance to play it before the regular reaction window.
- If the sender passes or the 锁定 is countered, do not offer another attempt against the same recipient in that receipt cycle.
- The current intended recipient must accept and cannot decline.
- 截获 can override the locked recipient because 截获 has priority.
- Do not offer another 锁定 after a successful 截获 because the interceptor is already committed to accepting.

### 掉包

- Played before intelligence is accepted.
- Replace the pending intelligence with the 掉包 card.
- Discard the original intelligence face up.
- Preserve the original transmission method, route, and direction.
- The replacement 掉包 is face up.
- When a 掉包 card is sent normally from hand as intelligence, its printed method is 文本.
- After one 掉包 resolves, another may replace the new pending intelligence, including replacing another 掉包.
- Discard every successfully replaced pending card face up.
- 识破 may counter a pending 掉包; restore the exact prior pending intelligence and transmission state without discarding anything.

### 转移

- Only the active sender may use it.
- Only when their own transmitted intelligence returns to them during their turn.
- Applies equally to returned 直达, 文本, and 密电.
- Choose a different intended recipient.
- This does not cause immediate acceptance.
- Normal response timing resumes.
- After 转移 and its reactions resolve, the final target begins a normal receipt cycle: sender-first 锁定, then 破译 if unlocked, followed by accept/decline.
- 截获 remains legal.

### 调虎离山

- Play only when another player other than the original sender reaches an ordinary accept/decline decision.
- Force that intended recipient to decline, then apply the normal decline route: 文本/密电 continues along the fixed route and 直达 returns to the original sender.
- It is illegal against a 锁定 recipient, a successful interceptor, or returned intelligence that the original sender must accept.
- 识破 may counter it and restore the pending decision exactly. 离间 cannot redirect it.
- It changes neither turn order nor seat eligibility; a subsequent recipient begins a normal receipt cycle.

### 离间

May redirect the target of:

- 试探
- 锁定
- 转移
- 公开文本
- 危险情报

The new target cannot be the original target.

At most one 离间 may be played against an original card action. 识破 may counter it and restores the original target.

### 破译

Only the current intended recipient may privately inspect a 密电 or 直达 intelligence before deciding whether to accept or decline. It is legal after 转移 creates a normal receipt cycle. It is illegal after a successful 锁定 or 截获 because those recipients must accept.

### 烧毁

- May be played during any open action or reaction window in any phase.
- Targets only accepted black intelligence in front of a living player whose physical card lacks the printed “不可烧毁” mark.
- Owner-confirmed physical mapping: all black 掉包, black 直达 锁定, and all 危险情报 are marked 不可烧毁. Encode the result explicitly on every physical manifest entry and consult that property at runtime; do not infer burnability from family rules.
- Cannot target intelligence in front of dead players or any red, blue, or red-blue card.
- Cannot interrupt the atomic acceptance → death → on-receive effect → victory sequence, so it cannot save a player after their third black intelligence arrives.
- 识破 may counter it and leaves the target card unchanged. A recorded victory cannot be undone.
- Extend the physical-card manifest with the audited burnability mark before implementing this validator; do not infer it from card family alone.

### 危险情报

As a function card:

1. Choose another player.
2. Inspect their hand.
3. Choose one card from that hand.
4. Discard it.

The target must have at least one hand card when the action is declared. A player with an empty hand is not a legal target.

Declare and fully resolve 离间/识破 reactions before revealing a hand. A redirected target must also have a non-empty hand. If the action survives, show the final target's hand privately only to the card user, who chooses one card to discard face up. Do not open another response window after revealing the hand.

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
- 真情报 means accepted red, blue, or red-blue intelligence; black does not count.
- Count physical cards once each, so red-blue counts once. Face orientation does not change the count.
- An accepted face-up 掉包 counts when that physical card is red or blue; a black 掉包 does not.
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
3. Randomly take one card only from the cards that were already in their hand before receiving the played 公开文本, without inspecting it first.
4. If the obtained card is also 公开文本, discard the obtained card face up.

The target must already have at least one hand card before this action begins. A player with an empty hand is not a legal target. The newly given 公开文本 is not part of the random-selection pool and cannot be taken back by this effect.

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

Resolve this on-receive effect completely before victory checking, ending the turn, advancing clockwise, or performing the next turn-start draw. This resolution is not an active-phase function-card action.

### 秘密下达

- Played in a dedicated window after the active player irrevocably ends their function phase but before selecting the intelligence, transmission method, route, or direction.
- Once this window opens, the active player cannot return to active-phase function-card play.
- The user declares one printed code word.
- The physical card’s private mapping determines the required color.
- The target must send matching intelligence when possible.
- A red-blue card satisfies either a red or blue requirement. If multiple cards match, the target chooses freely.
- If the target claims none exists, the server verifies the hand.
- The player who used 秘密下达 privately inspects the hand when the claim is made.
- If no matching card truly exists, the color restriction ends and the target transmits any otherwise legal card.
- At most one 秘密下达 applies to each transmission.
- 识破 may counter it and restore exact prior state. 离间 cannot redirect it.
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
- allow one card to be taken randomly from their hand without inspection

If the target has no hand cards, they cannot choose the hand-card alternative and must publicly state the code corresponding to their true faction.

Only the user of 试探 knows the exact mapping on that physical card.

Identity codes announced publicly remain permanently in the public audit log. Both 试探 variants are legal only during the active player's pre-transmission function phase, and 离间 may redirect the target before that target chooses a response.

#### Draw/discard variant

One faction draws 1. The other two factions discard 1.

The draw faction is encoded per physical card in `cards.ts`.

---

## 9. Discards and reshuffling

Unless stated otherwise, discarded cards are face up.

If an effect requires a player with no hand cards to discard, that discard does nothing.

Exceptions:

- Used 试探 is face down and permanently removed from reshuffles.
- Used 秘密下达 is face down but eligible for reshuffle.

When the draw pile is empty:

1. Gather all eligible face-up discards.
2. Add used 秘密下达.
3. Exclude all used 试探.
4. Shuffle to form the new draw pile.

Perform this reshuffle immediately whenever a draw is attempted with an empty pile, including partway through a multi-card draw, then continue the same effect. If no eligible cards remain, draw as many as possible and finish without error.

Keep separate server-side zones rather than a single discard array:

```ts
type DiscardZones = {
  publicEligible: CardId[];
  hiddenSecretOrders: CardId[];
  removedProbes: CardId[];
};
```

---

## 10. Hidden information, logs, and room lifecycle

- During play, each player sees only their own faction, hand, legal actions, and private card mappings they are entitled to know. Other factions remain hidden unless a rule reveals them or the game ends.
- Never send another hand, faction, private mapping, hidden discard identity, unrevealed card, or server-only verification detail to a client.
- Privately inspected cards are displayed transiently and are not retained in player-visible private history. Reconnecting players must remember prior inspections.
- Public logs use Chinese and include only visible actions/outcomes. Any future public replay must redact hidden and privately inspected information.
- At game end, reveal factions and final hands only; do not reveal unused cards, deck order, or past private inspections.
- The server may retain complete authoritative diagnostic events in process memory, but MVP retains neither completed games nor saved replays.

Reconnection:

- Give each player a private reconnect token. Refresh/reconnect restores the same seat and current private projection while the server process is alive.
- While any living player is disconnected, pause all gameplay progression.
- Reserve that seat indefinitely. The host may publicly mark a currently disconnected player dead, applying the normal dead-player state and skipping rules.
- Resolve host-imposed death atomically in the game engine: reveal and publicly log the faction immediately. Treat a dead current responder as passing and remove them from remaining priority. If the active sender dies, abort the turn, publicly discard pending transmitted intelligence, clear unresolved turn interactions, and advance clockwise; this takes precedence if they are also the intended recipient. An ordinary intended recipient's death behaves as a decline along the fixed route, but a locked or 截获-committed recipient causes the pending intelligence to be publicly discarded and the sender's turn to end. Cancel an unresolved mandatory function-card or 秘密下达 effect when a required participant dies; played cards remain spent. If one player remains alive, their faction wins immediately, except a surviving 特工 wins individually.
- A dead disconnected player no longer pauses the game; resume once no living player is disconnected.
- In-game host succession transfers authority when the host dies or disconnects to the next connected living player clockwise from that host's seat. Once assigned, a successor is not displaced and a previous host does not automatically reclaim authority by reconnecting. If nobody is eligible, leave the room temporarily without a host; when an eligible living player reconnects, resolve succession with the same clockwise rule. That reconnecting player may receive host authority even if they were a host earlier—prior host status is not a permanent blacklist.
- The host cannot replace or transfer an occupied seat after game start. AI control is deferred until after MVP.

Timeout and persistence:

- Keep wall-clock timing outside the deterministic engine. The configured room timeout submits an ordinary pass through the room/server layer for optional reaction priority only; mandatory decisions remain untimed.
- The host may change the timeout during play. Announce and log the change publicly, and apply it from the next reaction prompt without modifying a timer already running.
- Pause reaction timers while the game is paused for a disconnected living player.
- Store MVP rooms in server memory. Browser refresh works, but a server-process restart ends active games.
- Do not retain completed rooms or replays for MVP; database persistence is deferred.

---

## 11. Recommended engine architecture

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

## 12. Deferred testing priorities

The user has paused new test work during rapid implementation. When testing resumes, prioritize:

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
12. 烧毁 enforcing accepted-black, living-owner, and printed “不可烧毁” eligibility
13. 公开文本 death-before-effect ordering
14. 秘密下达 server verification
15. hidden discard and reshuffle eligibility
16. information projection: no hand, faction, mapping, or face-down leakage

Run `cards.test.ts` as a deck-data gate in CI.

---

## 13. Decision status

The deck count, identity, gameplay metadata, and per-card `不可烧毁` mapping audits are finished.

In-game host succession is confirmed: host death or disconnection transfers authority clockwise to the next connected living player, or remains pending with no host until an eligible living player reconnects. Reconnection does not displace an existing successor or automatically restore an old claim, but a prior host remains eligible during a genuinely hostless pending succession.

The general reaction-priority model is deliberately provisional: implement the confirmed provisional sequence now and revisit only if playtesting exposes pacing or priority problems. Reaction timeout values, AI takeover, database persistence, and retained replays are deferred product features, not engine-rule blockers.

Keep any future decisions centralized in `docs/rules-decisions.md` and then synchronize this handoff.

---

## 14. Immediate Codex task

Continue from the playable engine, authoritative Socket.IO session, reaction timer, lobby, game-table UI, and in-game host succession. Next implement the confirmed 烧毁 resolver, then deploy the production server to obtain a shareable URL.

Tests are enabled. Commit and push after each major verified milestone.

---

## 15. Definition of done for the first engine milestone

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
