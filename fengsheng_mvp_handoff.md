# 风声 Web App MVP — Rules & Implementation Handoff

_Last updated: 14 July 2026_

This document is the current source of truth for the custom 风声 ruleset and the implementation plan for the web app. Confirmed rules are separated from unresolved deck details so future work can resume cleanly.

---

# 1. Product Goal

Build a private, browser-based 风声 game for 5–8 friends.

The MVP should:

- Support private rooms and room codes.
- Support hidden factions and private hands.
- Enforce legal actions and timing.
- Support reconnecting after refresh or disconnect.
- Be server-authoritative so hidden information is never sent to the wrong player.
- Exclude characters and character abilities.
- Use the custom card set and faction rules documented below.
- Prioritize a reliable rules engine over animation and visual polish.

Not in the initial MVP:

- Characters
- Expansions
- Bots
- Public matchmaking
- Rankings
- Spectators
- Accounts/passwords
- Heavy animation
- Mobile-first layout

---

# 2. Core Factions

## 军情

- Team faction.
- The entire 军情 team wins when any living 军情 player has 3 blue intelligence.

## 潜伏

- Team faction.
- The entire 潜伏 team wins when any living 潜伏 player has 3 red intelligence.

## 特工

- Independent faction.
- A 特工 wins only for themselves.
- A 特工 wins when they personally have 6 intelligence cards of any colors.
- If there are multiple 特工, they compete independently.

## Player distribution

| Players | 军情 | 潜伏 | 特工 |
|---:|---:|---:|---:|
| 5 | 2 | 2 | 1 |
| 6 | 2 | 2 | 2 |
| 7 | 3 | 3 | 1 |
| 8 | 3 | 3 | 2 |

---

# 3. Death and Victory Resolution

## Three black intelligence

A player dies immediately when they have 3 black intelligence in front of them.

## Resolution order when intelligence is accepted

1. Place the intelligence in front of the receiving player.
2. Check death.
3. If the player died, stop resolving that intelligence.
4. If still alive, resolve any “on receive” effect printed on that intelligence.
5. Check victory.

Death therefore takes priority over card effects and victory.

Example:

- A 特工 has 3 red and 2 black intelligence.
- They receive a third black intelligence.
- They now have 6 total intelligence, but they die before the 特工 victory check.
- They do not win.

---

# 4. Transmission Methods

The game uses three transmission methods:

## 密电

- Passed face down.
- Continues according to the normal table route.
- Players may accept or pass according to the final confirmed rulebook wording.
- If it returns to the sender, the sender would normally have to accept unless another effect changes the outcome.

## 文本

- Passed face up.
- Continues according to the normal table route.
- Players may accept or pass.
- If it returns to the sender, the sender would normally have to accept unless another effect changes the outcome.

## 直达

- Sent directly to a chosen player.
- The target may accept or reject according to the final confirmed rulebook wording.
- If rejected and returned to the sender, the sender would normally have to accept unless another effect changes the outcome.

Exact route direction and any edition-specific wording should be confirmed from the physical copy before implementation is locked.

---

# 5. Global Discard and Reshuffle Rules

## Public discard

Unless otherwise stated, discarded cards are placed face up.

All players may inspect the public discard pile.

## Used 试探

- Discarded face down.
- Removed from circulation.
- Never included when the deck is reshuffled.

## Used 秘密下达

- Discarded face down.
- Hidden while in the discard area.
- Included when the deck is reshuffled.

## Deck exhaustion

When the draw deck is exhausted:

1. Gather all reshuffle-eligible public discards.
2. Add used 秘密下达.
3. Do not add used 试探.
4. Shuffle to create a new draw deck.
5. Continue play.

---

# 6. Confirmed Card Rules

## 6.1 秘密下达

### Count

6 total:

- 2 corresponding to red
- 2 corresponding to blue
- 2 corresponding to black

The printed codes are:

- 听风
- 看雨
- 日落

The exact mapping between these three names and red/blue/black still needs to be confirmed from the physical copy.

### Timing

Play before another player is about to transmit intelligence.

### Effect

The target must transmit intelligence of the encoded color if they have any valid card of that color.

If the target claims they do not have that color:

- The player who used 秘密下达 may inspect the target’s entire hand.
- If the claim is true, the restriction is lifted and the target may transmit normally.
- In the digital implementation, the server verifies whether the target has a matching card.

### Special interaction

机密文件 counts as both red and blue for satisfying 秘密下达.

- Red requirement: 机密文件 may be sent.
- Blue requirement: 机密文件 may be sent.
- Black requirement: 机密文件 may not be sent.

### Discard

Used 秘密下达 is discarded face down, but returns to the deck during reshuffle.

---

## 6.2 危险情报

### Count and properties

- 6 cards
- All black

### As a function card

- Choose another player.
- Inspect that player’s entire hand.
- Choose one card from their hand.
- Discard the chosen card.

### Special protection

危险情报 cannot be targeted by 烧毁.

### As intelligence

The sender chooses any of the three transmission methods when sending it:

- 密电
- 文本
- 直达

The chosen method is fixed for that transmission unless another effect replaces the intelligence.

---

## 6.3 转移

### Timing

- Only during your own turn.
- Only when intelligence you transmitted has returned to you.

### Effect

- Choose another player.
- That player becomes the new intended recipient.
- The intelligence is not accepted immediately.
- Normal transmission and response timing continue.
- The redirected intelligence may still be intercepted by 截获.

The exact route behavior after the new recipient is chosen should be confirmed from the physical rules if necessary.

---

## 6.4 截获

### Timing and effect

- Used before intelligence is accepted.
- The player using 截获 becomes the new intended recipient.

### Priority

截获 has priority over 锁定.

### Chaining

截获 may itself be intercepted by another 截获.

This creates an intercept chain:

- Original recipient
- First interceptor
- Second interceptor
- Further interceptors as allowed

The last successful, unresolved 截获 determines the current intended recipient.

### Countering

Each individual 截获 may be countered by 识破.

If a later 截获 is countered, the intended recipient returns to the state immediately before that 截获.

---

## 6.5 锁定

### Timing restriction

锁定 may only be used during your own turn when you are the player transmitting the intelligence.

### Timing

Use before the intelligence is accepted.

### Effect

The current intended recipient must accept the intelligence.

They may not:

- Pass a 密电
- Pass a 文本
- Reject a 直达

### Priority interaction

截获 has priority over 锁定.

A 锁定 does not prevent another player from using 截获.

---

## 6.6 掉包

### Count

6 total:

- 2 red
- 2 blue
- 2 black

### Transmission method

All 掉包 cards are 文本.

### Timing

Use before an intelligence is accepted.

### Effect

- Replace the currently transmitted intelligence with the 掉包 card.
- Discard the original intelligence face up.
- The 掉包 becomes the intelligence being transmitted.
- Because all 掉包 are 文本, the new intelligence uses 文本 transmission.

Whether multiple 掉包 may be chained and whether every 掉包 may be targeted by 识破 should be confirmed, although the working assumption is yes unless the physical rules say otherwise.

---

## 6.7 增援

### As a function card

Draw:

- 1 card
- plus 1 additional card for each black intelligence in front of you

Therefore:

| Black intelligence in front of player | Cards drawn |
|---:|---:|
| 0 | 1 |
| 1 | 2 |
| 2 | 3 |

A living player cannot normally have 3 black intelligence.

Color, count, and transmission-method distribution are not yet confirmed.

---

## 6.8 公开文本

### Count

7 total:

- 2 red
- 2 blue
- 3 black

### Transmission method

All 公开文本 cards are 文本.

### As a function card

1. Choose another player who has at least one card in hand.
2. Give the played 公开文本 to that player, adding it to their hand.
3. Do not inspect their hand.
4. Randomly take one card from their hand and add it to your hand.
5. If the randomly obtained card is also 公开文本, discard that obtained 公开文本 face up immediately.

The target’s hand size remains unchanged.

### As red intelligence

When accepted:

- 潜伏: must discard 1 card.
- 军情 or 特工: choose either:
  - draw 1 card, or
  - discard 1 card.

This choice lets 军情 or 特工 conceal their identity.

### As blue intelligence

When accepted:

- 军情: must discard 1 card.
- 潜伏 or 特工: choose either:
  - draw 1 card, or
  - discard 1 card.

This choice lets 潜伏 or 特工 conceal their identity.

### As black intelligence

There are three different black 公开文本 cards:

- 黑色·潜伏
- 黑色·军情
- 黑色·特工

For the faction named on the card:

- A player of that faction must draw exactly 1 card.

For either of the other two factions:

- The player may choose to draw 1 or draw 2.

Choosing to draw only 1 allows the player to conceal their identity.

### Death timing

If receiving a black 公开文本 gives the player 3 black intelligence:

- They die immediately.
- They do not resolve the draw effect.

---

## 6.9 机密文件

### Count

3 total.

### As a function card

Count all true intelligence currently on the table, including intelligence in front of dead players.

- Fewer than 4 true intelligence: cannot use, or no effect; final wording still needs confirmation.
- 4–6 true intelligence: draw 2 cards.
- 7 or more true intelligence: draw 3 cards.

Reaching 7 means draw 3 total, not 2+3.

### As intelligence

- Transmission method: 直达
- Color: dual red and blue
- Counts as red for red-related conditions.
- Counts as blue for blue-related conditions.
- Counts as one physical intelligence card for 特工’s 6-intelligence condition.
- Is not black.
- Counts as one true intelligence when future 机密文件 cards count intelligence on the table.

### Victory examples

- A 潜伏 player with 2 red accepts 机密文件: 潜伏 reaches 3 red.
- A 军情 player with 2 blue accepts 机密文件: 军情 reaches 3 blue.

---

## 6.10 试探

Current confirmed properties:

- 18 total
- Encoded by faction/color group, with 6 red, 6 blue, 6 black in the physical distribution previously discussed
- Used 试探 is discarded face down
- Used 试探 is permanently excluded from reshuffles

The exact printed variants, effect text, transmission methods, and mapping still need to be confirmed from the physical copy.

---

# 7. Cards Still Requiring Full Confirmation

The following cards exist in the working deck but do not yet have fully confirmed rules, counts, colors, or transmission-method distributions:

- 识破
- 调虎离山
- 破译
- 烧毁
- 增援
- 试探
- possibly other cards in the physical edition

Specific unresolved example:

- The user referenced 7 识破 cards.
- Need to confirm how many are 直达 versus 密电.
- Do not rely on the earlier online deck count of 14; the physical edition may differ.

For every unresolved family, record:

1. Total number of copies
2. Color distribution
3. Transmission-method distribution
4. Function timing
5. Valid targets
6. Effect
7. Whether it can be countered by 识破
8. Whether it has a discard or reshuffle exception
9. Interaction with 截获, 锁定, 掉包, 转移, and 秘密下达

---

# 8. Rules Questions Still Open

Before locking the engine, confirm:

1. Exact mapping:
   - 听风 → ?
   - 看雨 → ?
   - 日落 → ?

2. Exact direction and route rules for:
   - 密电
   - 文本
   - 直达

3. Exact 识破 chain behavior:
   - Can 识破 counter another 识破?
   - If yes, does standard odd/even cancellation apply?
   - Which function cards are immune?

4. Can 掉包 be:
   - countered by 识破?
   - replaced by another 掉包?

5. After 转移:
   - Does transmission resume at the chosen player?
   - Does it restart a normal recipient response window?
   - For 密电/文本, where does it continue if that player passes?

6. Exact hand-limit and end-of-turn rules.

7. Initial hand size.

8. Draw count at the start of a normal turn.

9. Whether a player may play unlimited function cards during their action phase.

10. Death cleanup:
    - Does the dead player’s hand go to the public discard?
    - Does their intelligence remain on the table? Current working assumption: yes.
    - Are their faction and hand revealed?

11. Whether team victory requires the player reaching 3 red/blue to be alive. Current working assumption: yes.

12. Whether 机密文件 may be used as a function with fewer than 4 true intelligence, producing no effect, or whether it is illegal to play.

13. Exact counts and properties for every card family in the physical deck.

---

# 9. Recommended Technical Architecture

## Stack

Recommended:

- Frontend: Next.js + React + TypeScript
- Styling: Tailwind CSS
- Realtime transport: Socket.IO or native WebSocket
- Backend: Node.js + TypeScript
- Runtime validation: Zod
- Database: PostgreSQL
- ORM: Prisma
- Tests: Vitest
- End-to-end tests: Playwright
- Package manager: pnpm

Redis is optional for the MVP and can be added later if multiple server instances are needed.

## Monorepo layout

```text
fengsheng/
├── apps/
│   ├── web/
│   └── server/
├── packages/
│   ├── engine/
│   ├── rules/
│   ├── protocol/
│   ├── game-data/
│   └── ui/
├── docs/
│   ├── rules.md
│   ├── deck-audit.md
│   └── implementation-plan.md
└── pnpm-workspace.yaml
```

## Core principle

The server is authoritative.

The browser must never receive:

- Other players’ faction identities
- Other players’ hands
- Hidden face-down discard details
- Hidden card encodings
- Private inspection results intended for someone else

Each player receives a player-specific projection of the game state.

---

# 10. Rules Engine Design

## Command-driven state machine

The client sends commands such as:

- Start game
- Draw
- Play function card
- Select target
- Transmit intelligence
- Accept
- Pass
- Reject
- Play response
- Counter with 识破
- Confirm private choice

The server:

1. Validates the command.
2. Applies the command to authoritative state.
3. Resolves automatic consequences.
4. Opens any required prompt or response window.
5. Projects a separate view for each player.
6. Broadcasts only permitted information.

## Recommended game phases

```text
LOBBY
SETUP
TURN_START
DRAW
ACTION
PRE_TRANSMISSION_RESPONSE
TRANSMISSION
PRE_ACCEPT_RESPONSE
INTELLIGENCE_ACCEPTED
ON_RECEIVE_EFFECT
DEATH_CHECK
VICTORY_CHECK
TURN_END
GAME_OVER
```

This list is provisional and should be refined after all timing rules are confirmed.

## Interaction windows

Do not implement responses as a simple numerical priority sort.

The game needs nested, sequential interaction windows because:

- 截获 can be followed by another 截获.
- A specific 截获 can be countered by 识破.
- A 识破 may potentially be countered by another 识破.
- 掉包 can change the intelligence before acceptance.
- 锁定 applies only after higher-priority interception opportunities.
- 转移 can reopen normal transmission responses.

Represent this as an explicit effect/response stack or a sequence of pending interactions.

---

# 11. Data Model Guidance

## Card definition

Each card definition should include:

- Card family
- Display name
- Intelligence color or colors
- Transmission method or allowed methods
- Copy count
- Function timing
- Target rule
- Effect identifier
- Whether it can be countered
- Discard destination
- Reshuffle behavior
- Variant code, where applicable

## Card instance

Each physical copy needs a unique instance ID.

This is required for:

- Hidden hands
- Random selection
- Reconnection
- Replay
- Preventing duplicate actions
- Auditing card movement

## Intelligence representation

Represent:

- Physical card count separately from color contribution.
- 机密文件 is one physical card but contributes both red and blue.
- 特工 counts physical intelligence cards, not color contributions.

## Discard zones

Use distinct logical zones:

- Public discard
- Hidden reshuffle discard for 秘密下达
- Removed-from-game pile for 试探

Do not infer reshuffle behavior solely from face-up or face-down orientation.

---

# 12. Multiplayer and Reconnection

## Room flow

- Host creates room.
- System returns a short room code.
- Friends join with display names.
- Players mark ready.
- Host starts once player count and faction distribution are valid.

## Reconnection

On join, issue a signed reconnect token stored locally in the browser.

After refresh or reconnect:

- Client sends room ID, player ID, and reconnect token.
- Server verifies the token.
- Server sends a fresh player-specific state.
- Any pending private prompt is restored.

## State versions

Every accepted command increments a game-state version.

Clients include the version they acted on.

Reject stale or duplicated commands.

This protects against:

- Double clicks
- Delayed socket messages
- Multiple browser tabs
- Replayed requests

---

# 13. UI Plan

## Desktop-first table

Recommended layout:

- Top bar:
  - Room code
  - Current phase
  - Active player
  - Deck/discard counts

- Left panel:
  - Player list
  - Alive/dead status
  - Public intelligence
  - Public card counts

- Centre:
  - Current intelligence
  - Sender
  - Current intended recipient
  - Transmission method
  - Active response chain

- Right panel:
  - Public game log

- Bottom:
  - Your hand
  - Context-specific action buttons
  - Private prompts

## Rules-first interaction

The UI should present only legal actions.

Examples:

- During a 截获 window:
  - Play 截获
  - Play 识破 when eligible
  - Pass

- Under 锁定:
  - No accept/pass choice; acceptance is automatic after higher-priority responses finish.

- Under 秘密下达:
  - Only matching-color intelligence is selectable when the target has at least one.
  - If no matching card exists, show the private hand-reveal resolution.

---

# 14. Public and Private Logs

## Public log

Should record only public facts, such as:

- A card family was played when its identity is public.
- A player transmitted using a declared method.
- A player accepted/passed/rejected.
- A public discard occurred.
- A player died.
- A faction or 特工 won.

## Private log

May record:

- Hand inspections
- Randomly taken card identities
- Hidden directive codes
- Hidden faction details
- Private target choices

Never leak private events into the public event stream.

---

# 15. Testing Plan

## Unit tests

Focus first on:

- Death before victory
- 机密文件 dual-color counting
- 特工 counts physical intelligence, not color contributions
- Used 试探 excluded from reshuffle
- Used 秘密下达 included in reshuffle
- 锁定 only during sender’s own turn
- 截获 priority over 锁定
- 截获 chains
- 识破 rollback of a specific 截获
- 掉包 discards original intelligence face up
- Public-text identity effects
- Black 公开文本 death before draw
- 危险情报 variable transmission method
- 危险情报 immunity to 烧毁
- 秘密下达 hand verification
- Random exchange from 公开文本 without leaking the target’s hand

## Information-leak tests

For every state projection:

- Opponent hands are absent.
- Opponent factions are absent.
- Used 试探 details are absent.
- Used 秘密下达 details are absent.
- Inspection results are visible only to the authorised player.
- Random-selection candidates are not exposed.

## Scenario tests

Write complete game scenarios for:

- 密电 returns, sender plays 转移, then 截获 chain.
- 锁定 is played, then another player uses 截获.
- 截获 is countered by 识破.
- 掉包 replaces a hidden intelligence and reveals the original in discard.
- A 特工 reaches six total while simultaneously receiving a third black and dies.
- A player receives black 公开文本 as their third black and dies before drawing.
- A player receives 机密文件 and satisfies a red or blue faction victory.
- Deck exhaustion reshuffles 秘密下达 but excludes 试探.

---

# 16. Milestones

## Milestone 0 — Deck audit

Before coding card effects:

- Photograph or transcribe every unique physical card.
- Record exact copy counts.
- Record exact colors.
- Record exact transmission methods.
- Record exact text.
- Resolve every item in the open-questions section.

Deliverable:

- `docs/deck-audit.md`
- machine-readable deck manifest

## Milestone 1 — Lobby and sessions

- Create room
- Join room
- Ready state
- Start validation
- Reconnect token
- Basic socket connection

## Milestone 2 — Core hidden-information engine

- Authoritative state
- Player-specific views
- Hands
- Deck
- Discards
- Factions
- Turn order
- State versioning
- Reconnect

## Milestone 3 — Base transmission

- 密电
- 文本
- 直达
- Accept
- Pass
- Reject
- Intelligence placement
- Death
- Victory

## Milestone 4 — Timing and responses

- Response windows
- 截获 chains
- 识破 chains
- 锁定
- 转移
- 掉包

## Milestone 5 — Remaining card effects

- 秘密下达
- 危险情报
- 增援
- 公开文本
- 机密文件
- 试探
- 调虎离山
- 破译
- 烧毁
- Any other physical cards

## Milestone 6 — Playable private alpha

- Complete room flow
- Stable reconnection
- Full legal-action UI
- Public/private logs
- Error handling
- End-game display
- Rematch

## Milestone 7 — Polish

- Animations
- Sound
- Better responsive layout
- Match history
- Deployment hardening

---

# 17. Recommended First Coding Slice

Do not start by implementing every card.

First build a vertical slice containing:

1. A five-player room.
2. Faction assignment.
3. Private hands.
4. One normal turn.
5. One transmission method.
6. Accept/pass.
7. Intelligence placement.
8. Death at 3 black.
9. Faction victory at 3 matching color.
10. 特工 victory at 6 total.
11. Reconnection.
12. Player-specific state projection.

Then add the other two transmission methods.

Then add the response system.

Then add cards one family at a time.

---

# 18. Offline Resume Checklist

When resuming the project:

1. Open this document.
2. Review the “Rules Questions Still Open” section.
3. Audit the physical deck.
4. Fill in exact counts and transmission distributions.
5. Confirm 识破 timing and chaining.
6. Confirm route behavior after 转移.
7. Confirm hand size, draw rules, and end-of-turn rules.
8. Update the machine-readable deck manifest.
9. Only then freeze rules version `v0.1`.
10. Begin Milestone 1 and the first vertical slice.

---

# 19. Suggested GitHub Workflow

Recommended repository setup:

```text
main
develop
feature/lobby
feature/core-engine
feature/transmission
feature/response-stack
feature/card-<name>
```

Keep this document in:

```text
docs/implementation-plan.md
```

Also maintain:

```text
docs/rules.md
docs/deck-audit.md
packages/game-data/deck.json
```

Every rules change should update:

1. `docs/rules.md`
2. `packages/game-data/deck.json`
3. Corresponding engine tests

Do not let rule decisions live only in chat messages.

---

# 20. Current Status

Rules design is partially complete.

The strongest confirmed areas are:

- Factions
- Death and victory order
- Discard and reshuffle rules
- 锁定
- 截获
- 转移
- 掉包
- 危险情报
- 公开文本
- 机密文件
- 秘密下达

The next highest-value task is not coding. It is a complete physical-deck audit, especially:

- Exact 识破 count
- 识破 transmission split
- Exact card counts
- Exact transmission-method distribution for every family
- Exact printed wording for unresolved cards
