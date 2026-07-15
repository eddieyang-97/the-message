# 风声 Rules Decisions

This document tracks gameplay decisions that are not yet fully specified.

Do not silently invent answers in implementation.  
Each unresolved item should remain explicit until confirmed.

---

## Status legend

- `UNRESOLVED` — blocks or may affect implementation
- `PARTIALLY CONFIRMED` — confirmed core rule with unresolved edge cases
- `PROVISIONAL` — temporary implementation choice, not yet confirmed
- `CONFIRMED` — authoritative decision

---

## Core setup

### Two-player duel variant

**Status:** CONFIRMED

- Two players are supported as a deliberate reduced duel variant.
- Assign one 潜伏 and one 军情; do not include 特工.
- Both players can infer the opponent's faction from the known distribution.
- Derive the duel deck from the authoritative `PHYSICAL_DECK` during initialization.
- Remove all 6 截获 cards.
- Remove the 3 identity-code 试探 cards.
- Keep the 6 draw/discard 试探 cards and their function effects.
- Remove all 5 离间 cards.
- The resulting duel deck contains exactly 73 cards.
- The standard 87-card manifest and its invariants remain unchanged.
- Test the duel deck composition and filtering separately from the standard deck.

### Starting hand size

**Status:** CONFIRMED

Confirmed:

- Every player starts with 2 cards.
- The starting hand size is the same for the 2-player duel and standard 5–8-player games.
- The first player performs the normal 2-card turn-start draw before their first action.

---

### Initial active player

**Status:** CONFIRMED

Confirmed:

- Select the initial active player uniformly at random from all seated players.
- The server is responsible for generating the randomness.
- Normal turn progression follows clockwise seat order.
- The authoritative `seatOrder` records players in clockwise table order.
- Dead players cannot take turns or perform any game action or response.
- Dead seats are skipped automatically when advancing clockwise.
- A dead player cannot be selected as an intelligence recipient or other active target unless a card rule explicitly refers to intelligence already in front of dead players.

---

### Faction assignment visibility

**Status:** CONFIRMED

- Each player sees only their own faction.
- Factions remain hidden unless revealed by a rule or the game ends.
- Team composition is determined by player count:
  - 2 players: 军情1 / 潜伏1 / 特工0
  - 5 players: 军情2 / 潜伏2 / 特工1
  - 6 players: 军情2 / 潜伏2 / 特工2
  - 7 players: 军情3 / 潜伏3 / 特工1
  - 8 players: 军情3 / 潜伏3 / 特工2

---

## Turn structure

### Start-of-turn draw

**Status:** PARTIALLY CONFIRMED

Confirmed:

- The active player draws 2 cards at the start of their turn.
- This includes the first turn.

Unresolved:

- What happens if the draw pile is exhausted during this draw?

Decision:

> Pending confirmation.

---

### Action phase

**Status:** PARTIALLY CONFIRMED

Confirmed:

- A living active player must complete one intelligence transmission during their turn.
- They cannot voluntarily end their turn without transmitting.
- Successfully accepted intelligence satisfies the turn's transmission requirement.
- Before starting transmission, the active player must always have at least one card in hand.
- A function-card action or other voluntary action is illegal if it would leave the active player with no card to transmit.

Unresolved:

- How many function cards may the active player play per turn?
- Can the active player play multiple function cards before transmitting?

Decision:

> Pending confirmation.

---

### End-of-turn rules

**Status:** PARTIALLY CONFIRMED

Confirmed hand-limit timing:

- Maximum hand size is 7 immediately before starting the mandatory transmission.
- If the active player has more than 7 cards at that point, they choose and discard cards until 7 remain.
- These forced discards are public and face up.
- The player cannot start transmission while holding more than 7 cards.
- This is a pre-transmission check, not an end-of-turn hand-limit check.
- The active player's turn ends immediately when the transmitted intelligence is accepted.
- No further active-player function-card actions occur after acceptance.

Unresolved:

- Can unresolved reaction windows continue after the active player would otherwise end their turn?

Decision:

> Pending confirmation.

---

## Transmission

### Default transmission direction

**Status:** CONFIRMED

- 密电 defaults to clockwise.
- 文本 defaults to clockwise.
- A circle icon lets the sender choose clockwise or counterclockwise at transmission start.
- The selected direction remains fixed for that transmission.
- 直达 ignores direction.

---

### Declining intelligence

**Status:** CONFIRMED

- For 密电 and 文本, the intelligence continues along the fixed route.
- For 直达, the intelligence returns to the sender.

---

### Transmission returning to sender

**Status:** CONFIRMED

Confirmed:

- When 直达, 文本, or 密电 returns to its active sender, the sender may use 转移.
- 转移 chooses a different intended recipient.
- The new recipient still receives a normal response window.
- 截获 remains legal.
- If the sender does not play 转移, they must accept the returned intelligence regardless of transmission method.
- The sender cannot decline returned 直达, 文本, or 密电 again.
- Other confirmed legal reaction windows remain available before acceptance.

---

## Reaction timing

### General reaction order

**Status:** PROVISIONAL

- Reaction opportunities are offered to one living player at a time.
- A new reaction window starts with the player affected by the pending interaction, then proceeds clockwise.
- Each player may perform a legal reaction or pass.
- After a reaction is played, open a fresh window starting from the player affected by that new interaction.
- When every living eligible-by-seat player passes consecutively, close the window and resolve the pending interaction.
- Dead players are skipped.
- Prompt all living players in sequence even when the server knows they hold no applicable reaction card, so timing and prompt order do not leak hidden hand information.

Decision:

> Use provisionally and revisit if playtesting reveals priority or pacing problems.

---

### 截获

**Status:** CONFIRMED

- Played before intelligence is accepted.
- The interceptor becomes the new pending receiver.
- 截获 may itself be intercepted.
- Each 截获 may be countered by 识破.
- If countered, restore the previous pending-recipient state exactly.
- 截获 has priority over 锁定.
- The active player cannot play 截获 during their own turn.
- This includes intercepting their own intelligence back after another player intercepts it.

Implementation note:

> Use a reversible interaction stack. Do not overwrite only one recipient field.

---

### 识破

**Status:** PARTIALLY CONFIRMED

Confirmed:

- It can counter 截获.
- Countering 截获 restores the exact previous pending state.

Unresolved:

- What other cards or effects may 识破 counter?
- Can 识破 counter another 识破?
- If counter chains are allowed, how is priority resolved?
- Is there any limit on chain depth?

Decision:

> Pending confirmation.

---

### 锁定

**Status:** CONFIRMED

- Only the active player may use it.
- Only during their own transmission.
- Played before acceptance.
- The current intended recipient cannot decline.
- 截获 can override the locked recipient.

---

### 掉包

**Status:** PARTIALLY CONFIRMED

Confirmed:

- Played before intelligence is accepted.
- Replaces the pending intelligence with the 掉包 card.
- The original intelligence is discarded face up.
- Original transmission method, route, and direction remain unchanged.
- The replacement 掉包 is face up.
- When sent normally from hand as intelligence, 掉包 uses its printed 文本 method.

Unresolved:

- Can multiple 掉包 cards chain on the same transmission?
- Can 掉包 replace another 掉包?
- Can 识破 counter 掉包?
- If a 掉包 is countered, is the original intelligence restored?

Decision:

> Pending confirmation.

---

### 转移

**Status:** CONFIRMED

- Only the active sender may use it.
- Only when their own transmitted intelligence returns to them during their turn.
- This applies to returned 直达, 文本, and 密电.
- Choose another intended recipient.
- This does not cause immediate acceptance.
- Normal response timing resumes.
- 截获 remains legal.

---

## Death and victory

### Black intelligence death

**Status:** CONFIRMED

- A player dies immediately upon receiving their third black intelligence.
- Death is checked before any on-receive effect.
- Death is checked before victory.

---

### 特工 victory

**Status:** CONFIRMED

- Each 特工 is independent.
- A living 特工 wins personally with six physical intelligence cards of any colors.
- A red-blue dual card counts as one physical card.
- A 特工 who receives their sixth card as their third black intelligence dies and does not win.

---

### Team victory

**Status:** CONFIRMED

- 军情 wins when any living 军情 player has at least three blue intelligence.
- 潜伏 wins when any living 潜伏 player has at least three red intelligence.
- A red-blue dual card satisfies either color requirement.
- Intelligence in front of dead players remains on the table.

Unresolved:

- If multiple victory conditions become true in the same atomic resolution, is there a tie or priority rule?
- Can both teams win simultaneously?
- Can a 特工 and a faction team win simultaneously?
- Does the game end immediately after the first detected winner?

Decision:

> Pending confirmation.

---

## Card-specific decisions

### 调虎离山

**Status:** UNRESOLVED

Need:

- Exact printed effect text
- Legal timing window
- Valid targets
- Whether it can be redirected or countered
- Whether it affects turn order, seat eligibility, or transmission route

Decision:

> Pending physical-card transcription.

---

### 离间

**Status:** CONFIRMED

May redirect the target of:

- 试探
- 锁定
- 转移
- 公开文本
- 危险情报

The new target cannot be the original target.

Unresolved:

- Can 离间 itself be countered by 识破?
- If multiple 离间 cards are played, may targets be redirected repeatedly?

Decision:

> Pending confirmation for chaining/countering only.

---

### 破译

**Status:** CONFIRMED

- Allows inspection of a 密电 or 直达 intelligence before deciding whether to accept or decline.

Unresolved:

- Who may use it: only the current intended recipient, or any eligible player?
- Does the information remain private to the user?
- Can it be used after 锁定?
- Can it be used after 截获 changes the intended recipient?

Decision:

> Pending confirmation for timing details.

---

### 烧毁

**Status:** CONFIRMED

- May be played during any phase.
- Targets only already accepted intelligence on the table.
- Cannot target 危险情报.

Unresolved:

- Can it target intelligence in front of dead players?
- Can it remove a red-blue dual 机密文件?
- Does removing intelligence immediately re-check or undo victory?
- Can it be countered?

Decision:

> Pending confirmation for edge cases.

---

### 危险情报

**Status:** CONFIRMED

As a function card:

1. Choose another player.
2. Inspect their hand.
3. Choose one card.
4. Discard it.

As intelligence:

- It is black.
- The sender chooses 密电, 文本, or 直达 at transmission start.

Unresolved:

- Is the inspected hand visible only to the card user?
- Is the discarded card revealed face up?
- Can 离间 redirect the target after the original hand has been revealed?
- Can the target respond before their hand is inspected?

Decision:

> Pending confirmation for information timing.

---

### 增援

**Status:** CONFIRMED

- Draw one card.
- Draw one additional card per black intelligence in front of the user.
- A living player can therefore draw at most three cards.

Unresolved:

- If the draw pile empties mid-resolution, reshuffle immediately and continue drawing?
- Can the card be played if fewer cards than required are available after reshuffle?

Decision:

> Pending confirmation.

---

### 机密文件

**Status:** CONFIRMED

As a function card:

- Count all true intelligence on the table.
- Include intelligence in front of dead players.
- At least 4: draw 2.
- At least 7: draw 3.

As intelligence:

- Red-blue dual
- Direct
- Counts as red and blue for conditions
- Counts as one physical card for 特工
- Is not black
- Satisfies red or blue 秘密下达 requirements, but not black

Unresolved:

- Exact definition of “true intelligence” for the count
- Whether face-up 掉包 intelligence counts
- Whether any special card state can make accepted intelligence not count

Decision:

> Pending confirmation.

---

### 公开文本

**Status:** CONFIRMED

As a function card during the active player’s action phase:

1. Choose another player.
2. Give them the played 公开文本.
3. Randomly take one card from their hand without inspecting first.
4. If the obtained card is also 公开文本, discard the obtained card face up.

As accepted intelligence:

- Red:
  - 潜伏 must discard 1
  - 军情 / 特工 choose draw 1 or discard 1
- Blue:
  - 军情 must discard 1
  - 潜伏 / 特工 choose draw 1 or discard 1
- Black:
  - one subtype for each faction
  - matching faction must draw 1
  - other two factions choose draw 1 or draw 2

Death is checked before the on-receive effect.

Unresolved:

- If the target has no cards before receiving 公开文本, how is random taking resolved?
- Is the played 公开文本 inserted into the target’s hand before random selection?
- Can the card user randomly take back the same 公开文本 they just gave?
- If forced to discard with an empty hand, is the effect ignored?
- If a draw effect causes deck exhaustion, reshuffle immediately?

Decision:

> Pending confirmation.

---

### 秘密下达

**Status:** CONFIRMED

- Played before another player begins transmitting.
- The user declares one printed word.
- The card-specific mapping determines the required color.
- The target must transmit a matching color when possible.
- If the target claims no matching card exists, the server verifies their hand.
- The player who used 秘密下达 may inspect the target’s hand.
- Used face down.
- Included in later reshuffles.

Unresolved:

- If the target has a red-blue dual card, may it satisfy either declared red or blue?
  - Current intended rule: yes.
- If multiple matching cards exist, may the target choose freely?
- Can the target play function cards before satisfying the order?
- Can multiple 秘密下达 effects apply to the same player/turn?
- Can the effect be countered or redirected?
- What happens if the target truly has no matching card?

Decision:

> Pending confirmation for stacking and exact turn restriction.

---

### 试探

**Status:** CONFIRMED

- Used face down.
- Permanently excluded from reshuffles.

Identity-code variant:

- The target either publicly states the code corresponding to their faction, or allows the user to choose a card from their hand.
- Only the user knows the card-specific mapping.

Draw/discard variant:

- One faction draws 1.
- The other two factions discard 1.

Unresolved:

- When exactly may 试探 be played?
- Can 离间 redirect before or after the target chooses their response?
- For identity variant, is the chosen hand card random or selected by the 试探 user?
  - Current rule says selected by the 试探 user.
- What happens if the target has no hand cards?
- Is the publicly stated code stored permanently in the public game log?

Decision:

> Pending confirmation for timing and empty-hand cases.

---

## Discard and reshuffle

### Discard visibility

**Status:** CONFIRMED

- Normal discards are face up.
- Used 试探 is face down and removed permanently.
- Used 秘密下达 is face down but remains reshuffle-eligible.

---

### Reshuffle timing

**Status:** PARTIALLY CONFIRMED

Confirmed reshuffle pool:

- face-up eligible discards
- used 秘密下达

Excluded:

- used 试探

Unresolved:

- Does reshuffling occur immediately when a draw is attempted with an empty pile?
- Or only after the current effect finishes?
- What happens when both draw pile and eligible reshuffle pool are empty?
- Are discarded intelligence cards and discarded function cards treated identically?

Decision:

> Pending confirmation.

---

## Hidden information and logging

### Client projection

**Status:** CONFIRMED

A client may receive:

- public board state
- their own hand
- their own faction
- their own private card mappings when legally known
- current prompt
- legal actions

A client must not receive:

- other hands
- other factions
- hidden discard identities
- another player’s private mapping
- unrevealed cards
- server-only verification information

---

### Audit log

**Status:** PROVISIONAL

Recommended:

- Public log records visible actions and outcomes in Chinese.
- Private log records information visible only to one player.
- Server log records complete authoritative events for debugging.

Unresolved:

- Whether inspected cards are ever written to persistent private history
- Whether hidden information should be redacted from saved game replays
- Whether post-game reveal exposes all hidden information

Decision:

> Use three log scopes unless later changed.

---

## Room and operational decisions

### Reconnection

**Status:** PROVISIONAL

Recommended:

- A player receives a private reconnect token.
- Reconnection restores their seat and private projection.
- Refreshing the page should not lose the game.

Unresolved:

- How long a disconnected player may remain absent
- Whether the host may replace or remove them
- Whether a game pauses automatically

### Reaction timeout

**Status:** CONFIRMED

- Reaction ordering in the rules engine does not depend on wall-clock time.
- A room host may configure a reaction timeout later at the server/room layer.
- When a configured timeout expires, the server submits the same deterministic pass command the player could submit manually.
- The exact available timeout values, default setting, and disconnected-player behavior remain product decisions.

---

### Persistence

**Status:** UNRESOLVED

Questions:

- Must games survive server restart?
- Is in-memory state enough for MVP?
- Should an event log be persisted?
- Should completed games be retained?

Decision:

> Pending product decision.

---

## Confirmed deck baseline

The following files are authoritative:

```text
src/game/cards.ts
src/game/cards.test.ts
docs/fengsheng_mvp_handoff.md
```

Confirmed totals:

- 87 cards
- 28 circle cards
- red 21
- blue 21
- black 42
- red-blue dual 3

Do not change the deck manifest to resolve gameplay ambiguities.

---

## Next decisions to resolve first

These have the highest implementation impact:

1. Starting hand size
2. Complete turn sequence
3. Hand limit and end-of-turn discard
4. Exact 调虎离山 text
5. General reaction priority/pass system
6. Full 识破 eligibility
7. What happens when 直达 returns and 转移 is not used
8. Simultaneous victory handling
9. 掉包 chaining and countering
10. Empty-hand behavior for 公开文本 and 试探
