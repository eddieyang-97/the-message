# 风声 Rules and Rulings

This document is the authoritative record of confirmed gameplay rules and rulings. New unresolved questions should be discussed and confirmed before being added here.

---

## Core setup

### Two-player duel variant

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
- Direction is not requested in duel mode; circle transmissions use the only meaningful route automatically.

### Starting hand size

- Every player starts with 2 cards.
- The starting hand size is the same for the 2-player duel and standard 5–8-player games.
- The first player performs the normal 2-card turn-start draw before their first action.

---

### Initial active player

- Select the initial active player uniformly at random from all seated players.
- The server is responsible for generating the randomness.
- Normal turn progression follows clockwise seat order.
- The authoritative `seatOrder` records players in clockwise table order.
- Dead players cannot take turns or perform any game action or response.
- Dead seats are skipped automatically when advancing clockwise.
- A dead player cannot be selected as an intelligence recipient or other active target unless a card rule explicitly refers to intelligence already in front of dead players.

---

### Faction assignment visibility

- Each player sees only their own faction.
- Factions remain hidden unless revealed by a rule or the game ends.
- When a player dies for any reason, reveal that player's faction immediately to every player and record it permanently in the public audit log.
- Team composition is determined by player count:
  - 2 players: 军情1 / 潜伏1 / 特工0
  - 5 players: 军情2 / 潜伏2 / 特工1
  - 6 players: 军情2 / 潜伏2 / 特工2
  - 7 players: 军情3 / 潜伏3 / 特工1
  - 8 players: 军情3 / 潜伏3 / 特工2

---

## Turn structure

### Start-of-turn draw

- The active player draws 2 cards at the start of their turn.
- This includes the first turn.
- Whenever a draw is attempted with an empty draw pile, immediately reshuffle all eligible discard zones and continue the same draw.
- If the draw pile and eligible reshuffle pool are both empty, draw as many cards as possible and end that draw effect without error.

---

### Action phase

- A living active player must complete one intelligence transmission during their turn.
- They cannot voluntarily end their turn without transmitting.
- Successfully accepted intelligence satisfies the turn's transmission requirement.
- Before starting transmission, the active player must always have at least one card in hand.
- A function-card action or other voluntary action is illegal if it would leave the active player with no card to transmit.
- The active player may play any number of legal function cards before starting transmission.
- Once transmission begins, active-phase function cards are no longer legal; only actions legal in the current reaction window may be played.
- On-receive intelligence effects are resolution steps, not active-phase function-card plays, and still resolve after acceptance.

---

### End-of-turn rules

Hand-limit timing:

- Maximum hand size is 7 immediately before starting the mandatory transmission.
- If the active player has more than 7 cards at that point, they choose and discard cards until 7 remain.
- These forced discards are public and face up.
- The player cannot start transmission while holding more than 7 cards.
- This is a pre-transmission check, not an end-of-turn hand-limit check.
- The active player's turn ends immediately when the transmitted intelligence is accepted.
- No further active-player function-card actions occur after acceptance.
- A transmitted intelligence is not accepted until all reaction windows and mandatory receipt decisions have resolved.
- Therefore the turn cannot end while a reaction window belonging to that transmission remains unresolved.

---

## Transmission

### Default transmission direction

- 密电 defaults to clockwise.
- 文本 defaults to clockwise.
- A circle icon lets the sender choose clockwise or counterclockwise at transmission start.
- The selected direction remains fixed for that transmission.
- 直达 ignores direction.

---

### Declining intelligence

- For 密电 and 文本, the intelligence continues along the fixed route.
- For 直达, the intelligence returns to the sender.

---

### Transmission returning to sender

- Any current recipient may use 转移 during their own final receipt-response priority, provided the intelligence is not locked; this includes but is not limited to intelligence returned to its original sender.
- 转移 chooses a different intended recipient.
- The new recipient still receives a normal response window.
- 截获 remains legal.
- A returned original sender must accept unless they use 转移. Any transferred target is likewise committed to acceptance unless they use another legal 转移 before accepting.
- The sender cannot decline returned 直达, 文本, or 密电 again.
- Other confirmed legal reaction windows remain available before acceptance.

---

## Reaction timing

### General reaction order

- Reaction opportunities are offered to one living player at a time.
- A new reaction window starts with the next living player clockwise after the pending action's target.
- Priority continues clockwise through every living player, with the target receiving the final reaction opportunity before resolution.
- Each priority prompt offers pass plus every card and non-card action currently legal for that player in the window; do not split these into separate card-specific prompts.
- The server generates the legal-action set, and the UI presents the legal responses in the current response panel while highlighting playable cards in hand.
- After a reaction is played, open a fresh window starting with the next living player clockwise after that new action's target.
- When every living eligible-by-seat player passes consecutively, close the window and resolve the pending interaction.
- Dead players are skipped.
- Prompt all living players in sequence even when the server knows they hold no applicable reaction card, so timing and prompt order do not leak hidden hand information.
- When the target receives final priority, combine their legal card reactions and any required target decision in one prompt when possible.
- Priority anchors for current confirmed actions:
  - targeted function card: the declared target
  - 截获: the new pending recipient/interceptor
  - 转移 or 离间 redirection: the newly declared target
  - 掉包: the current intended intelligence recipient
  - self-effect: the card user

---

### 截获

- Played before intelligence is accepted.
- The interceptor becomes the new pending receiver and is committed to accepting the intelligence if that 截获 remains the final successful intercept.
- 截获 may itself be intercepted.
- Each 截获 may be countered by 识破.
- If countered, restore the previous pending-recipient state exactly.
- 截获 has priority over 锁定.
- A successful 截获 removes any 锁定 attached to the previous intended recipient.
- Do not offer the final interceptor an accept/decline decision, a new 锁定 opportunity, or a 破译 opportunity.
- 掉包 remains legal after 截获; the replacement intelligence inherits the interceptor's mandatory-acceptance commitment.
- 转移 is not legal after 截获 because the interceptor is committed to accepting.
- After all reactions finish, the final successful interceptor accepts the pending intelligence automatically.
- The active player cannot play 截获 during their own turn.
- This includes intercepting their own intelligence back after another player intercepts it.

Implementation note:

> Use a reversible interaction stack. Do not overwrite only one recipient field.

---

### 识破

- It may counter any card action that is currently the top unresolved card-action interaction.
- It may counter another 识破.
- A player cannot use 识破 to counter their own card action.
- Counter chains use the same clockwise reaction-priority system.
- Countering an action restores the exact authoritative state from immediately before that action.
- There is no rules-level chain-depth limit; practical server safeguards must not change legal outcomes.

---

### 锁定

- Only the active player may use it.
- Only during their own transmission.
- Played before acceptance.
- When intelligence reaches an intended recipient through its normal route, offer the active sender an exclusive sender-first opportunity to play 锁定 before opening the regular reaction window.
- If the sender passes or that 锁定 is countered, do not offer another 锁定 against the same recipient during that receipt cycle.
- The current intended recipient cannot decline.
- 截获 can override the locked recipient.
- Do not offer a new 锁定 after a successful 截获 because the interceptor is already committed to accepting.

---

### 掉包

- Played before intelligence is accepted.
- Replaces the pending intelligence with the 掉包 card.
- The original intelligence is discarded face up.
- Original transmission method, route, and direction remain unchanged.
- The replacement 掉包 is face up.
- When sent normally from hand as intelligence, 掉包 uses its printed 文本 method.
- After one 掉包 resolves, another 掉包 may replace the new pending intelligence during the same transmission.
- A 掉包 may therefore replace another 掉包.
- Each successfully replaced pending intelligence is discarded face up.
- 识破 may counter a pending 掉包 action.
- A countered 掉包 does not discard or replace anything; restore the exact pending intelligence and transmission state from before that 掉包 was played.

---

### 转移

- Any current intended recipient may use 转移 during their own final receipt-response priority, including a player who was not the original sender.
- 转移 is legal only while the intelligence is not locked and the current recipient is not committed by 截获.
- Choose a different living intended recipient.
- This does not cause immediate acceptance; normal response timing resumes.
- After 转移 and its reactions resolve, the final transferred target is committed to acceptance. No new 锁定 opportunity opens; the target may still use 破译, 掉包, or another legal 转移 before mandatory acceptance.
- 调虎离山 cannot force the committed transferred target to refuse.
- 截获 remains legal.

---

## Death and victory

### Black intelligence death

- A player dies immediately upon receiving their third black intelligence.
- Death is checked before any on-receive effect.
- Death is checked before victory.

---

### 特工 victory

- Each 特工 is independent.
- A living 特工 wins personally with six physical intelligence cards of any colors.
- A red-blue dual card counts as one physical card.
- A 特工 who receives their sixth card as their third black intelligence dies and does not win.

---

### Team victory

- 军情 wins when any living 军情 player has at least three blue intelligence.
- 潜伏 wins when any living 潜伏 player has at least three red intelligence.
- A red-blue dual card satisfies either color requirement.
- Intelligence in front of dead players remains on the table.
- Victory is checked immediately after each accepted intelligence and its on-receive effect fully resolves.
- A single atomic resolution can add intelligence to only one receiver, who has exactly one faction.
- Therefore two teams, or a faction and a 特工, cannot newly satisfy victory simultaneously.
- A red-blue dual card does not create simultaneous team victories: only the living receiver's own faction can win from their intelligence.
- Once a victory condition is detected, the game ends immediately; later actions cannot create or undo another victory.

---

## Card-specific decisions

### 调虎离山

- May be played only when another player, other than the original sender, is at an ordinary accept/decline decision for pending intelligence.
- It forces that intended recipient to choose “decline”; the recipient does not accept the intelligence.
- It does not create a special route. Apply the pending intelligence's normal decline rule from that recipient:
  - 文本 and 密电 continue using the fixed route and direction.
  - 直达 returns to the original sender.
- It is illegal when 锁定 requires the intended recipient to accept.
- It is illegal against a successful interceptor because 截获 commits the interceptor to accepting.
- It is illegal when the current recipient is already committed to acceptance by a returned or transferred intelligence; that recipient must accept unless using an unlocked 转移.
- 识破 may counter 调虎离山 and restores the exact pending receipt decision.
- 离间 cannot redirect 调虎离山.
- It does not alter turn order or seat eligibility. If the intelligence continues to a new recipient, that player begins a normal receipt cycle.

---

### 离间

May redirect the target of:

- 试探
- 锁定
- 转移
- 公开文本
- 危险情报

The new target cannot be the original target.
- At most one 离间 may be played against each original card action; the redirected action cannot be redirected again with another 离间.
- 识破 may counter 离间 and restores the original target.

---

### 破译

- Allows inspection of a 密电 or 直达 intelligence before its receipt decision resolves.
- The recipient selected by a resolved 转移 may use 破译, 掉包, or another 转移 before their mandatory acceptance, provided the intelligence is not locked.
- Only the current intended recipient may use it.
- Reveal the inspected intelligence privately only to that recipient.
- It may be used only while the recipient still has a legal receipt decision or a pending mandatory acceptance after 转移.
- It cannot be used after a successful 锁定 because acceptance is mandatory.
- It cannot be used by a successful interceptor because 截获 commits that player to acceptance.

---

### 烧毁

- May be played during any open action or reaction window in any phase.
- Targets only already accepted black intelligence in front of a living player.
- The targeted black intelligence must not have the printed “不可烧毁” mark.
- Authoritative physical-card mapping supplied by the owner: every black 掉包, every black 直达 锁定, and every 危险情报 is marked 不可烧毁. The manifest stores this as an explicit per-card property; runtime rules must not infer it from card family, color, or transmission method.
- It cannot target intelligence in front of a dead player.
- It cannot target red, blue, or red-blue intelligence, including 机密文件.
- Card eligibility is determined by the physical card's color and printed mark, not merely by its card family.
- It cannot interrupt the atomic acceptance, death, on-receive-effect, and victory sequence.
- In particular, it cannot save a player after that player accepts their third black intelligence.
- 识破 may counter it; a countered 烧毁 leaves the targeted intelligence in its exact prior state.
- Removing intelligence cannot undo a recorded victory because the game ends immediately when victory is detected.

---

### 危险情报

As a function card:

1. Choose another player.
2. Inspect their hand.
3. Choose one card.
4. Discard it.

- The target must have at least one hand card when the action is declared; a player with an empty hand is not a legal target.
- Declare the action and target before revealing any hand information.
- Resolve all 离间, 识破, and other legal reactions before inspecting a hand.
- A redirected target must also have at least one hand card when selected.
- If the action survives, only the card user privately inspects the final target's hand.
- The card user chooses one card from that hand and discards it face up.
- Do not open another response window after the hand is revealed; the discard completes the action.

As intelligence:

- It is black.
- The sender chooses 密电, 文本, or 直达 at transmission start.

---

### 增援

- Draw one card.
- Draw one additional card per black intelligence in front of the user.
- A living player can therefore draw at most three cards.

- If the draw pile empties mid-resolution, reshuffle immediately and continue.
- If fewer cards remain than required after all eligible reshuffles, draw as many as possible and finish the effect.

---

### 机密文件

As a function card:

- Count all true intelligence on the table.
- “True intelligence” means accepted intelligence whose printed color is red, blue, or red-blue; black intelligence is not true intelligence.
- Count physical cards, so a red-blue card counts once rather than twice.
- Face-up or face-down state does not change whether accepted intelligence counts.
- A face-up accepted 掉包 counts when that physical 掉包 is red or blue; a black 掉包 does not count.
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

---

### 公开文本

As a function card during the active player’s action phase:

1. Choose another player.
2. Give them the played 公开文本.
3. Randomly take one card from the cards that were already in their hand before receiving the played 公开文本, without inspecting first.
4. If the obtained card is also 公开文本, discard the obtained card face up.

- The newly given 公开文本 is excluded from this random-selection pool and cannot be taken back by the same effect.
- The target must have at least one card in hand before this action begins; a player with an empty hand is not a legal target.

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

The on-receive effect resolves completely before victory checking, turn completion, clockwise advancement, and the next player's turn-start draw. It is not limited by active-phase function-card timing.

Empty-hand handling:

- Any forced discard does nothing when the affected player has no hand cards.

Draw handling:

- If any draw empties the pile, reshuffle immediately and continue.
- If no eligible cards remain, draw as many as possible and finish the effect.

---

### 秘密下达

- Played in a dedicated pre-transmission window after the active player irrevocably ends their function-card phase and declares that they are entering transmission.
- This window occurs before the active player selects the intelligence card, transmission method, route, or direction.
- Once this window opens, the active player cannot return to the function-card phase or play additional active-phase function cards.
- The user declares one printed word.
- The card-specific mapping determines the required color.
- The target must transmit a matching color when possible.
- A red-blue card may satisfy either a red or blue requirement.
- If multiple matching cards exist, the target chooses freely among them.
- If the target claims no matching card exists, the server verifies their hand.
- The player who used 秘密下达 privately inspects the target's hand to verify the claim.
- If the target truly has no matching card, the order's color restriction ends and the target transmits any otherwise legal card.
- At most one 秘密下达 may apply to each transmission.
- 识破 may counter 秘密下达 and restores the exact state before it was played.
- 离间 cannot redirect 秘密下达.
- Used face down.
- Included in later reshuffles.

---

### 试探

- Used face down.
- Permanently excluded from reshuffles.
- May be played only during the active player's pre-transmission function phase.
- 离间 may redirect its target before the target chooses a response.

Identity-code variant:

- The target either publicly states the code corresponding to their faction, or allows one card to be taken randomly from their hand without inspection.
- Only the user knows the card-specific mapping.
- If the target has no hand cards, the hand-card alternative is unavailable and they must publicly state the code corresponding to their true faction.
- Any publicly announced code remains permanently in the public audit log.

Draw/discard variant:

- One faction draws 1.
- The other two factions discard 1.

---

## Discard and reshuffle

### Discard visibility

- Normal discards are face up.
- Used 试探 is face down and removed permanently.
- Used 秘密下达 is face down but remains reshuffle-eligible.
- A forced discard instruction does nothing if the affected player has no hand cards.

---

### Reshuffle timing

Reshuffle pool:

- face-up eligible discards
- used 秘密下达

Excluded:

- used 试探

- Reshuffle immediately whenever a draw is attempted with an empty pile, including during a multi-card draw.
- Continue the current draw after reshuffling.
- If both the pile and eligible reshuffle pool are empty, draw as many cards as possible and finish the effect without error.
- Discarded intelligence cards and discarded function cards are equally eligible unless a specific card rule places them in a special discard or removed zone.

---

## Hidden information and logging

### Client projection

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

- Public log records visible actions and outcomes in Chinese.
- Privately inspected information is shown transiently only to the authorized player.
- Do not retain inspected card identities in player-visible private history; the player must remember what they saw.
- Reconnection does not restore past inspection details.
- Server log records complete authoritative events for debugging.
- Public saved replays redact all hidden and privately inspected information.
- After the game ends, reveal factions and final hands.
- Do not reveal unused cards, deck order, or past private inspections after the game.

---

## Room and operational decisions

### Landing page and room entry

- The landing page offers two primary actions: create a room or join a room by code.
- The create-room control includes a required player-count field.
- Supported player-count choices are exactly `2`, `5`, `6`, `7`, and `8`; do not offer unsupported 3- or 4-player rooms.
- The selected count is the room's seat capacity. A 2-player room uses the confirmed duel rules and deck; 5–8-player rooms use the standard rules and deck.
- Player count is immutable after room creation. To use another capacity, create a new room.
- The lobby displays joined seats versus total capacity and rejects new joins when full.
- The creator enters a display name and becomes the room host.
- Manual joining requires a room code and display name. A valid invite URL supplies the room code, so the joiner enters only a display name.
- Display names may contain Chinese and other Unicode characters, are trimmed, must contain 1–16 characters, and must be unique within the room.
- A valid reconnect token restores the existing seat instead of creating a duplicate player.
- Only the host may start the game.
- The start control remains disabled until every seat in the room's fixed capacity is occupied.
- Filling the room does not start automatically; the host explicitly starts it.
- Before the game starts, the lobby displays numbered seats in clockwise order and players may change seats.
- A player may move their own seat into an empty slot immediately.
- Selecting an occupied slot sends that player a seat-swap request; swap only after the other player accepts.
- Declining or ignoring a swap request leaves both seats unchanged.
- Players may leave freely before game start; their seat becomes empty and their reconnect token no longer reserves it.
- The host may remove any player before game start, including a disconnected player; removal opens the seat and invalidates that player's reconnect token.
- If the host leaves, host ownership transfers deterministically to the longest-present remaining player.
- If no players remain after a pre-game leave, delete the in-memory room immediately and make its code invalid.
- Starting requires every seat to be occupied and every seated player to be currently connected.
- There is no separate ready/unready state; once the room is full and connected, the host may start immediately.
- Pending seat-swap requests do not block starting; they expire when the host starts the game, and the currently displayed seats are authoritative for “按当前座位开始”.
- After game start, reject new seated-player joins through the room URL; only valid reconnect tokens may restore existing seats.
- A visitor may instead join as a named spectator before or during a game. Spectators are listed publicly, receive only the public game projection, cannot issue gameplay commands, and may reconnect with their spectator token.
- Lobby layout shows the room code and a “复制邀请链接” control at the top; clockwise numbered seats with host and connection badges in the main area; seat-change and leave controls for players; and remove-player plus both start-mode controls for the host.
- Disabled start controls show a Chinese reason until every seat is occupied and connected.
- The lobby includes a host-only configuration box for reaction timeout.
- When starting, the host chooses either “按当前座位开始” or “随机座位开始”.
- “按当前座位开始” preserves the lobby's displayed clockwise order.
- “随机座位开始” uses server-generated randomness to uniformly shuffle all seated players.
- After the chosen final seat order is fixed, select the initial active player separately using the confirmed server-random rule.
- Creating a room generates a unique six-character alphabetical room code.
- Canonical room codes use uppercase ASCII letters `A`–`Z`.
- Code entry is case-insensitive and normalized to uppercase.
- If a generated code collides with an active room, generate another code before returning success.
- Each room has a directly shareable lobby URL consisting of the deployment base URL plus the room code as the final path segment, for example `https://host/ABCDEF`.
- Opening a valid room URL goes directly to that room's lobby/join flow.
- Opening an invalid or expired room URL shows a Chinese error and provides a route back to the landing page.

---

### Reconnection

- A player receives a private reconnect token.
- Reconnection restores their seat and private projection.
- Refreshing the page should not lose the game.
- While any living player is disconnected, the entire game is paused and accepts no gameplay progression commands.
- The disconnected player's seat remains reserved indefinitely for their reconnect token.
- The host may publicly mark a currently disconnected player dead.
- Host-imposed death uses the normal dead-player state and resolution: the player cannot act, respond, receive intelligence, or take turns; future priority and turn order skip their seat; intelligence already in front of them remains on the table.
- Host-imposed death is resolved atomically by the authoritative game engine. The player's faction is revealed immediately and the death is permanently recorded in the public audit log.
- If the dead player is the current reaction responder, their opportunity is treated as a pass and they are removed from the remaining priority order.
- If the active sender dies, abort their turn. Any currently transmitted intelligence is discarded face up; clear unresolved turn interactions and advance clockwise to the next living player. This rule takes precedence when the sender is also the intended recipient.
- If an ordinary intended recipient dies, treat that receipt as a decline and continue using the transmission's normal fixed route. If that recipient was locked or committed by 截获, discard the pending intelligence face up and end the sender's turn instead.
- If a participant required for an unresolved function-card choice or 秘密下达 resolution dies, cancel that unresolved effect. Every already-played card remains spent in its existing discard/removal zone.
- After any death, if every surviving player belongs to 军情 or every survivor belongs to 潜伏, that faction wins immediately.
- 特工 remain individual opponents: multiple surviving 特工 must continue playing. A 特工 wins by elimination only when they are the sole surviving player.
- A dead disconnected player no longer pauses the game. Play resumes when no living player remains disconnected.
- After the game starts, host death or disconnection vacates host authority and transfers it to the next connected living player clockwise from that host's seat.
- Once a successor has received host authority, a previous host's reconnection neither displaces that successor nor automatically restores the previous claim.
- If no connected living successor is eligible, host succession remains pending with no current host. When an eligible living player reconnects, resolve succession using the same clockwise rule. A reconnecting player may receive host authority even if they held it earlier; prior host status is not a permanent disqualification.
- The host cannot replace a player or transfer their seat after the game starts.
- Before the game starts, the host may add AI players to empty seats and remove those AI players.
- During a game, the host may enable AI control for a disconnected living player. Reconnecting with that player's valid token restores human control automatically.

### Reaction timeout

- Reaction ordering in the rules engine does not depend on wall-clock time.
- The room host configures the reaction timeout in the pre-game lobby; the default is 15 seconds.
- The timeout control is a dropdown with `关闭`, `10 秒`, `15 秒`, `20 秒`, `30 秒`, and `60 秒`; default to `15 秒`.
- The host may change the reaction timeout after the game starts.
- Every timeout change is announced to all players and recorded in the public audit log.
- A changed value applies beginning with the next reaction prompt; it never shortens or extends a timer already running.
- When a configured timeout expires, the server submits the same deterministic pass command the player could submit manually.
- Reaction timing remains in the server/room layer rather than the deterministic rules engine.
- A reaction timeout applies only to optional reaction priority; it does not automatically answer mandatory accept/decline, card-selection, discard, or other required-choice prompts.
- While the game is paused for a disconnected living player, no reaction timer advances.

---

### Persistence

- Room and game state is stored in server memory.
- Browser refresh and reconnection restore the game while the same server process remains alive.
- Active games do not survive a server-process restart.
- Completed games and saved replays are not retained.

### New game in the same room

- After a game ends, the host may return every player to the lobby with the same room code, seats, reconnect tokens, capacity, and reaction-timeout setting.
- Clear the completed authoritative game session and reset every player's alive state before another game starts.
- The room must still be full and all players connected before the host can start the next game normally.

---

## Confirmed deck baseline

非规则类的未来功能统一记录在 [扩展功能清单](extension-backlog.md)。

The following files are authoritative:

```text
src/game/cards.ts
src/game/cards.test.ts
docs/rules-decisions.md
```

Deck totals:

- 87 cards
- 28 circle cards
- red 21
- blue 21
- black 42
- red-blue dual 3

Do not change the deck manifest to resolve gameplay ambiguities.
