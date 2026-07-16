import {
  PHYSICAL_DECK,
  type Faction,
  type PhysicalCard,
  type PhysicalCardId,
  type ProbeCode,
  type SecretOrderWord,
  type SingleColor,
  type TransmissionMethod,
} from "./cards";

export type PlayerId = string;
export type GameMode = "duel" | "standard";
export type Direction = "clockwise" | "counterclockwise";
export type FixedTransmissionMethod = Exclude<TransmissionMethod, "任意">;
export type ReceiptStage = "lockOffer" | "reactions" | "decision";
export type PublicTextReceiptChoice = "drawOne" | "drawTwo" | "discardOne";
type ManifestCard = (typeof PHYSICAL_DECK)[number];

export interface TransmissionState {
  cardId: PhysicalCardId;
  senderId: PlayerId;
  method: FixedTransmissionMethod;
  direction?: Direction;
  intendedRecipientId: PlayerId;
  returnedToSender: boolean;
  interceptorCommitted: boolean;
  transferredRecipientCommitted: boolean;
  receiptCycle: number;
  receiptStage: ReceiptStage;
  lockOfferUsed: boolean;
  locked: boolean;
  faceUp: boolean;
  pendingTransfer?: {
    sourceCardId: PhysicalCardId;
    targetId: PlayerId;
  };
  pendingSwap?: {
    sourceCardId: PhysicalCardId;
  };
  pendingLure?: {
    sourceCardId: PhysicalCardId;
    targetId: PlayerId;
  };
  pendingDecrypt?: {
    sourceCardId: PhysicalCardId;
    playerId: PlayerId;
  };
  decryptedById?: PlayerId;
}

export type WinnerState =
  | { kind: "faction"; faction: Faction }
  | { kind: "agent"; playerId: PlayerId };

export interface ReactionWindow {
  kind:
    | "intelligence"
    | "transfer"
    | "lock"
    | "swap"
    | "lure"
    | "decrypt"
    | "burn"
    | "function"
    | "secretOrder";
  affectedPlayerId: PlayerId;
  responderOrder: PlayerId[];
  nextResponderIndex: number;
}

export type ActiveFunctionKind =
  | "reinforcement"
  | "confidentialFile"
  | "publicText"
  | "dangerousIntelligence"
  | "probeIdentity"
  | "probeDrawDiscard";

export interface ActiveFunctionAction {
  kind: ActiveFunctionKind;
  sourcePlayerId: PlayerId;
  sourceCardId: PhysicalCardId;
  originalTargetPlayerId: PlayerId;
  targetPlayerId: PlayerId;
  separationUsed: boolean;
  countered: boolean;
  stage:
    | "reactions"
    | "awaitingDiscard"
    | "awaitingProbeChoice"
    | "awaitingProbeDiscard";
}

export interface ActiveFunctionSnapshot {
  targetPlayerId: PlayerId;
  countered: boolean;
}

export interface ActiveFunctionFrame {
  id: string;
  sequence: number;
  kind: "function" | "separation" | "counter";
  sourcePlayerId: PlayerId;
  sourceCardId: PhysicalCardId;
  targetPlayerId: PlayerId;
  targetInteractionId?: string;
  snapshot: ActiveFunctionSnapshot;
}

export type CardActionKind =
  | "intercept"
  | "transfer"
  | "separation"
  | "counter"
  | "lock"
  | "swap"
  | "lure"
  | "decrypt";

export interface ReversibleInteractionSnapshot {
  intendedRecipientId: PlayerId;
  returnedToSender: boolean;
  interceptorCommitted: boolean;
  transferredRecipientCommitted: boolean;
  receiptStage: ReceiptStage;
  locked: boolean;
  receiptCycle: number;
  lockOfferUsed: boolean;
  pendingSwap?: {
    sourceCardId: PhysicalCardId;
  };
  pendingLure?: {
    sourceCardId: PhysicalCardId;
    targetId: PlayerId;
  };
  pendingDecrypt?: {
    sourceCardId: PhysicalCardId;
    playerId: PlayerId;
  };
  decryptedById?: PlayerId;
  pendingTransfer?: {
    sourceCardId: PhysicalCardId;
    targetId: PlayerId;
  };
}

export interface CardActionFrame {
  id: string;
  sequence: number;
  kind: CardActionKind;
  sourcePlayerId: PlayerId;
  sourceCardId: PhysicalCardId;
  targetPlayerId: PlayerId;
  targetInteractionId?: string;
  snapshot: ReversibleInteractionSnapshot;
  /** Compatibility aliases for older intercept-focused consumers. */
  previousRecipientId: PlayerId;
  previousReturnedToSender: boolean;
  separationUsed: boolean;
}

export interface PlayerState {
  id: PlayerId;
  faction: Faction;
  factionRevealed: boolean;
  alive: boolean;
  hand: PhysicalCardId[];
  intelligence: PhysicalCardId[];
}

export interface PendingPublicTextReceipt {
  recipientId: PlayerId;
  cardId: PhysicalCardId;
  stage: "choice" | "discard";
  choices: PublicTextReceiptChoice[];
}

export interface PendingSecretOrder {
  stage: "offering" | "reactions" | "selection";
  targetPlayerId: PlayerId;
  sourcePlayerId?: PlayerId;
  sourceCardId?: PhysicalCardId;
  word?: SecretOrderWord;
  requiredColor?: SingleColor;
  countered: boolean;
  verifiedNoMatch: boolean;
}

interface SecretOrderFrame {
  id: string;
  sequence: number;
  kind: "secretOrder" | "counter";
  sourcePlayerId: PlayerId;
  sourceCardId: PhysicalCardId;
  targetPlayerId: PlayerId;
  targetInteractionId?: string;
  snapshot: { countered: boolean };
}

interface BurnFrame {
  id: string;
  sequence: number;
  kind: "burn" | "counter";
  sourcePlayerId: PlayerId;
  sourceCardId: PhysicalCardId;
  targetPlayerId: PlayerId;
  targetInteractionId?: string;
  snapshot: { countered: boolean };
}

interface BurnContext {
  sourcePlayerId: PlayerId;
  sourceCardId: PhysicalCardId;
  targetPlayerId: PlayerId;
  targetIntelligenceCardId: PhysicalCardId;
  countered: boolean;
  suspendedReactionWindow?: ReactionWindow;
  suspendedReactionCompleted: boolean;
  frames: BurnFrame[];
}

export interface GameState {
  mode: GameMode;
  phase:
    | "initialized"
    | "discardingForTransmission"
    | "preTransmission"
    | "transmitting"
    | "resolvingReceipt"
    | "awaitingTurnEnd"
    | "awaitingTurnStartDraw"
    | "gameOver";
  activePlayerId: PlayerId;
  seatOrder: PlayerId[];
  players: Record<PlayerId, PlayerState>;
  drawPile: PhysicalCardId[];
  publicDiscard: PhysicalCardId[];
  hiddenSecretOrders: PhysicalCardId[];
  removedProbes: PhysicalCardId[];
  transmission?: TransmissionState;
  pendingPublicTextReceipt?: PendingPublicTextReceipt;
  pendingSecretOrder?: PendingSecretOrder;
  reactionWindow?: ReactionWindow;
  interactionStack: CardActionFrame[];
  activeFunctionAction?: ActiveFunctionAction;
  activeFunctionStack: ActiveFunctionFrame[];
  secretOrderStack: SecretOrderFrame[];
  burnContexts: BurnContext[];
  nextInteractionSequence: number;
  randomState: number;
  winner?: WinnerState;
  auditLog: string[];
  privateNotices: Record<PlayerId, PrivateCardNotice[]>;
}

export interface PrivateCardNotice {
  kind:
    | "publicTextGained"
    | "publicTextLost"
    | "dangerousDiscardMade"
    | "dangerousDiscardLost"
    | "probePlayed"
    | "secretOrderPlayed"
    | "secretOrderReceived";
  otherPlayerId: PlayerId;
  cardId: PhysicalCardId;
}

export interface PublicPlayerProjection {
  id: PlayerId;
  alive: boolean;
  faction?: Faction;
  handCount: number;
  hand?: PhysicalCard[];
  intelligence: PhysicalCard[];
}

export interface PlayerProjection {
  mode: GameMode;
  phase: GameState["phase"];
  activePlayerId: PlayerId;
  seatOrder: PlayerId[];
  drawPileCount: number;
  publicDiscard: PhysicalCard[];
  players: PublicPlayerProjection[];
  own: {
    id: PlayerId;
    faction: Faction;
    hand: PhysicalCard[];
  };
  auditLog: string[];
  privateNotices: Array<{
    kind: PrivateCardNotice["kind"];
    otherPlayerId: PlayerId;
    card: PhysicalCard;
  }>;
  transmission?: {
    senderId: PlayerId;
    method: FixedTransmissionMethod;
    direction?: Direction;
    intendedRecipientId: PlayerId;
    card?: PhysicalCard;
    returnedToSender: boolean;
    transferredRecipientCommitted: boolean;
    receiptStage: ReceiptStage;
    locked: boolean;
    faceUp: boolean;
    pendingTransfer?: {
      sourceCard: PhysicalCard;
      targetId: PlayerId;
    };
    decrypted?: boolean;
  };
  winner?: WinnerState;
  reactionWindow?: {
    kind: ReactionWindow["kind"];
    currentResponderId: PlayerId;
  };
  responseStack: Array<{
    id: string;
    kind: "card" | "counter" | "intelligence" | "secretOrderWindow";
    sourcePlayerId?: PlayerId;
    targetPlayerId: PlayerId;
    cardName?: PhysicalCard["name"];
    targetInteractionId?: string;
  }>;
  activeFunctionAction?: {
    kind: ActiveFunctionKind;
    sourcePlayerId: PlayerId;
    targetPlayerId: PlayerId;
    stage: ActiveFunctionAction["stage"];
    inspectedHand?: PhysicalCard[];
  };
  pendingPublicTextReceipt?: {
    recipientId: PlayerId;
    stage: PendingPublicTextReceipt["stage"];
    choices: PublicTextReceiptChoice[];
  };
  pendingSecretOrder?: {
    stage: PendingSecretOrder["stage"];
    targetPlayerId: PlayerId;
    sourcePlayerId?: PlayerId;
    word?: SecretOrderWord;
    requiredColor?: SingleColor;
    verifiedNoMatch: boolean;
    inspectedHand?: PhysicalCard[];
  };
  legalActions: Array<
    | { type: "ACCEPT_INTELLIGENCE" }
    | { type: "DECLINE_INTELLIGENCE" }
    | { type: "DISCARD_FOR_HAND_LIMIT"; cardId: PhysicalCardId }
    | {
        type: "PLAY_TRANSFER";
        cardId: PhysicalCardId;
        targetId: PlayerId;
      }
    | { type: "PASS_REACTION" }
    | { type: "PASS_LOCK" }
    | { type: "PLAY_LOCK"; cardId: PhysicalCardId }
    | { type: "PLAY_SWAP"; cardId: PhysicalCardId }
    | { type: "PLAY_LURE"; cardId: PhysicalCardId }
    | { type: "PLAY_DECRYPT"; cardId: PhysicalCardId }
    | {
        type: "PLAY_BURN";
        cardId: PhysicalCardId;
        targetPlayerId: PlayerId;
        targetIntelligenceCardId: PhysicalCardId;
      }
    | {
        type: "PLAY_SEPARATION";
        cardId: PhysicalCardId;
        targetId: PlayerId;
      }
    | { type: "PLAY_INTERCEPT"; cardId: PhysicalCardId }
    | { type: "PLAY_REINFORCEMENT"; cardId: PhysicalCardId }
    | { type: "PLAY_CONFIDENTIAL_FILE"; cardId: PhysicalCardId }
    | { type: "PLAY_PROBE"; cardId: PhysicalCardId; targetId: PlayerId }
    | { type: "CHOOSE_PROBE_IDENTITY"; choice: "announce" | "giveRandom" }
    | { type: "CHOOSE_PROBE_DISCARD"; cardId: PhysicalCardId }
    | { type: "ENTER_TRANSMISSION_PHASE" }
    | { type: "PLAY_SECRET_ORDER"; cardId: PhysicalCardId; word: SecretOrderWord }
    | { type: "CLAIM_NO_SECRET_ORDER_MATCH" }
    | {
        type: "PLAY_PUBLIC_TEXT";
        cardId: PhysicalCardId;
        targetId: PlayerId;
      }
    | {
        type: "PLAY_DANGEROUS_INTELLIGENCE";
        cardId: PhysicalCardId;
        targetId: PlayerId;
      }
    | {
        type: "PLAY_FUNCTION_SEPARATION";
        cardId: PhysicalCardId;
        targetId: PlayerId;
      }
    | { type: "CHOOSE_DANGEROUS_DISCARD"; cardId: PhysicalCardId }
    | {
        type: "CHOOSE_PUBLIC_TEXT_EFFECT";
        choice: PublicTextReceiptChoice;
      }
    | { type: "CHOOSE_PUBLIC_TEXT_DISCARD"; cardId: PhysicalCardId }
    | {
        type: "PLAY_COUNTER";
        cardId: PhysicalCardId;
        targetInteractionId: string;
      }
  >;
}

export type SpectatorProjection = Omit<
  PlayerProjection,
  "own" | "legalActions" | "privateNotices"
> & {
  spectator: true;
};

const CARD_BY_ID = new Map<PhysicalCardId, PhysicalCard>(
  PHYSICAL_DECK.map((card) => [card.id, card]),
);

export function isSupportedPlayerCount(count: number): boolean {
  return count === 2 || (count >= 5 && count <= 8);
}

export function buildDeckForPlayerCount(
  playerCount: number,
): readonly ManifestCard[] {
  if (!isSupportedPlayerCount(playerCount)) {
    throw new Error("仅支持2人决斗或5至8人标准游戏");
  }

  if (playerCount !== 2) return PHYSICAL_DECK;

  return PHYSICAL_DECK.filter((card) => {
    if (card.name === "截获" || card.name === "离间") return false;
    return !(
      card.name === "试探" && card.variant?.kind === "probeIdentity"
    );
  });
}

export function factionsForPlayerCount(playerCount: number): Faction[] {
  const distributions: Record<number, Faction[]> = {
    2: ["军情", "潜伏"],
    5: ["军情", "军情", "潜伏", "潜伏", "特工"],
    6: ["军情", "军情", "潜伏", "潜伏", "特工", "特工"],
    7: ["军情", "军情", "军情", "潜伏", "潜伏", "潜伏", "特工"],
    8: ["军情", "军情", "军情", "潜伏", "潜伏", "潜伏", "特工", "特工"],
  };
  const factions = distributions[playerCount];
  if (!factions) throw new Error("仅支持2人决斗或5至8人标准游戏");
  return [...factions];
}

/** A small deterministic PRNG suitable for reproducible game setup, not security. */
function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function shuffled<T>(values: readonly T[], random: () => number): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function nextStateRandom(state: GameState): number {
  state.randomState = (state.randomState + 0x6d2b79f5) >>> 0;
  let result = state.randomState;
  result = Math.imul(result ^ (result >>> 15), result | 1);
  result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
  return ((result ^ (result >>> 14)) >>> 0) / 4_294_967_296;
}

function shuffleWithState<T>(state: GameState, values: T[]): void {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(nextStateRandom(state) * (index + 1));
    [values[index], values[swapIndex]] = [values[swapIndex], values[index]];
  }
}

function refillDrawPile(state: GameState): boolean {
  if (state.drawPile.length > 0) return true;
  const eligible = [...state.publicDiscard, ...state.hiddenSecretOrders];
  if (eligible.length === 0) return false;
  state.publicDiscard = [];
  state.hiddenSecretOrders = [];
  shuffleWithState(state, eligible);
  state.drawPile.push(...eligible);
  state.auditLog.push(`弃牌堆洗回牌库：${eligible.length}张牌`);
  return true;
}

export function drawCards(
  state: GameState,
  playerId: PlayerId,
  count: number,
): PhysicalCardId[] {
  const player = state.players[playerId];
  if (!player?.alive) throw new Error("死亡玩家不能摸牌");
  if (!Number.isInteger(count) || count < 0) throw new Error("摸牌数量无效");
  const drawn: PhysicalCardId[] = [];
  while (drawn.length < count) {
    if (!refillDrawPile(state)) break;
    const cardId = state.drawPile.pop();
    if (!cardId) break;
    player.hand.push(cardId);
    drawn.push(cardId);
  }
  return drawn;
}

export function initializeGame(playerIds: readonly PlayerId[], seed: number): GameState {
  if (!isSupportedPlayerCount(playerIds.length)) {
    throw new Error("仅支持2人决斗或5至8人标准游戏");
  }
  if (new Set(playerIds).size !== playerIds.length) {
    throw new Error("玩家ID不得重复");
  }
  if (playerIds.some((id) => id.trim().length === 0)) {
    throw new Error("玩家ID不得为空");
  }

  const random = seededRandom(seed);
  const factions = shuffled(factionsForPlayerCount(playerIds.length), random);
  const drawPile = shuffled(buildDeckForPlayerCount(playerIds.length), random).map(
    (card) => card.id,
  );
  const players: Record<PlayerId, PlayerState> = Object.fromEntries(
    playerIds.map((id, index) => [
      id,
      {
        id,
        faction: factions[index],
        factionRevealed: false,
        alive: true,
        hand: [],
        intelligence: [],
      } satisfies PlayerState,
    ]),
  );

  for (let round = 0; round < 2; round += 1) {
    for (const id of playerIds) {
      const cardId = drawPile.pop();
      if (!cardId) throw new Error("起始发牌时牌堆不足");
      players[id].hand.push(cardId);
    }
  }

  const activePlayerId = playerIds[Math.floor(random() * playerIds.length)];
  for (let draw = 0; draw < 2; draw += 1) {
    const cardId = drawPile.pop();
    if (!cardId) throw new Error("首回合摸牌时牌堆不足");
    players[activePlayerId].hand.push(cardId);
  }

  const state: GameState = {
    mode: playerIds.length === 2 ? "duel" : "standard",
    phase: "initialized",
    activePlayerId,
    seatOrder: [...playerIds],
    players,
    drawPile,
    publicDiscard: [],
    hiddenSecretOrders: [],
    removedProbes: [],
    interactionStack: [],
    activeFunctionStack: [],
    secretOrderStack: [],
    burnContexts: [],
    nextInteractionSequence: 1,
    randomState: (seed ^ 0x9e3779b9) >>> 0,
    auditLog: [
      `游戏初始化完成：${playerIds.length}名玩家`,
      "每名玩家获得2张起始手牌",
      "首位行动玩家已随机选出",
      `${activePlayerId}在首回合开始时摸2张牌`,
    ],
    privateNotices: Object.fromEntries(playerIds.map((id) => [id, []])),
  };
  assertGameStateInvariants(state);
  return state;
}

export function assertGameStateInvariants(state: GameState): void {
  if (!isSupportedPlayerCount(state.seatOrder.length)) {
    throw new Error("状态中的玩家人数无效");
  }
  if (!state.seatOrder.includes(state.activePlayerId)) {
    throw new Error("当前玩家不在座位列表中");
  }
  if (
    ["initialized", "discardingForTransmission", "transmitting", "awaitingTurnStartDraw"].includes(
      state.phase,
    ) &&
    !state.players[state.activePlayerId]?.alive
  ) {
    throw new Error("死亡玩家不能成为当前行动玩家");
  }
  if (
    state.phase === "initialized" &&
    state.players[state.activePlayerId].hand.length === 0
  ) {
    throw new Error("当前玩家在传递前必须至少保留一张手牌");
  }
  if (new Set(state.seatOrder).size !== state.seatOrder.length) {
    throw new Error("座位列表包含重复玩家");
  }
  if (Object.keys(state.players).length !== state.seatOrder.length) {
    throw new Error("玩家状态与座位列表不一致");
  }
  for (const id of state.seatOrder) {
    if (!state.players[id] || state.players[id].id !== id) {
      throw new Error("玩家状态键、玩家ID与座位列表不一致");
    }
  }
  const expectedFactions = factionsForPlayerCount(state.seatOrder.length).sort();
  const actualFactions = Object.values(state.players)
    .map((player) => player.faction)
    .sort();
  if (actualFactions.join("|") !== expectedFactions.join("|")) {
    throw new Error("阵营数量与玩家人数不一致");
  }
  if (
    state.mode !== (state.seatOrder.length === 2 ? "duel" : "standard")
  ) {
    throw new Error("游戏模式与玩家人数不一致");
  }

  const expectedDeck = buildDeckForPlayerCount(state.seatOrder.length);
  const expectedIds = new Set(expectedDeck.map((card) => card.id));
  const locatedIds = [
    ...state.drawPile,
    ...state.publicDiscard,
    ...state.hiddenSecretOrders,
    ...state.removedProbes,
    ...(state.transmission ? [state.transmission.cardId] : []),
    ...Object.values(state.players).flatMap((player) => [
      ...player.hand,
      ...player.intelligence,
    ]),
  ];

  if (locatedIds.length !== expectedIds.size) {
    throw new Error("游戏区域中的牌数与当前模式牌组不一致");
  }
  if (new Set(locatedIds).size !== locatedIds.length) {
    throw new Error("同一实体牌出现在多个游戏区域");
  }
  if (locatedIds.some((id) => !expectedIds.has(id))) {
    throw new Error("游戏区域包含当前模式不允许的牌");
  }
  if ((state.phase === "transmitting") !== Boolean(state.transmission)) {
    throw new Error("传递阶段与待处理情报状态不一致");
  }
  if (
    (state.phase === "resolvingReceipt") !==
    Boolean(state.pendingPublicTextReceipt)
  ) {
    throw new Error("接收效果阶段与公开文本待处理状态不一致");
  }
  if (state.pendingPublicTextReceipt) {
    const pending = state.pendingPublicTextReceipt;
    const recipient = state.players[pending.recipientId];
    if (
      !recipient?.alive ||
      cardById(pending.cardId).name !== "公开文本" ||
      !recipient.intelligence.includes(pending.cardId) ||
      pending.choices.length === 0 ||
      pending.choices.some(
        (choice, index) => pending.choices.indexOf(choice) !== index,
      ) ||
      (pending.stage === "discard" &&
        (!pending.choices.includes("discardOne") || recipient.hand.length === 0))
    ) {
      throw new Error("公开文本待处理接收效果无效");
    }
  }
  if (state.transmission?.pendingTransfer && !hasReactionKind(state, "transfer")) {
    throw new Error("待处理转移必须拥有转移响应窗口");
  }
  if (
    state.reactionWindow?.kind === "transfer" &&
    !state.interactionStack.some((frame) => frame.kind === "transfer")
  ) {
    throw new Error("转移响应窗口缺少转移互动帧");
  }
  if (state.transmission?.pendingSwap && !hasReactionKind(state, "swap")) {
    throw new Error("待处理掉包必须拥有掉包响应窗口");
  }
  if (
    state.reactionWindow?.kind === "swap" &&
    !state.interactionStack.some((frame) => frame.kind === "swap")
  ) {
    throw new Error("掉包响应窗口缺少掉包互动帧");
  }
  if (state.transmission?.pendingLure && !hasReactionKind(state, "lure")) {
    throw new Error("待处理调虎离山必须拥有对应响应窗口");
  }
  if (
    state.reactionWindow?.kind === "lure" &&
    !state.interactionStack.some((frame) => frame.kind === "lure")
  ) {
    throw new Error("调虎离山响应窗口缺少互动帧");
  }
  if (state.reactionWindow) {
    if (
      state.phase !== "transmitting" &&
      !(
        state.phase === "initialized" &&
        state.reactionWindow.kind === "function"
      ) &&
      !(
        state.phase === "preTransmission" &&
        state.reactionWindow.kind === "secretOrder"
      ) &&
      !(
        state.reactionWindow.kind === "burn" &&
        ["initialized", "preTransmission", "transmitting"].includes(state.phase)
      )
    ) {
      throw new Error("响应窗口与当前阶段不一致");
    }
    const responders = state.reactionWindow.responderOrder;
    if (responders.length === 0) throw new Error("响应窗口必须包含当前响应者");
    if (new Set(responders).size !== responders.length) {
      throw new Error("响应窗口不能重复包含玩家");
    }
    if (responders.some((id) => !state.players[id]?.alive)) {
      throw new Error("响应窗口只能包含存活玩家");
    }
    const expectedOrder = reactionOrderAfterTarget(
      state,
      state.reactionWindow.affectedPlayerId,
    ).filter((playerId) =>
      state.reactionWindow?.kind === "secretOrder" &&
      state.pendingSecretOrder?.stage === "offering"
        ? playerId !== state.reactionWindow.affectedPlayerId
        : true,
    );
    if (
      responders.length !== expectedOrder.length ||
      responders.some((id, index) => id !== expectedOrder[index])
    ) {
      throw new Error("响应顺序必须从目标的下一名存活玩家开始，并让目标最后响应");
    }
    if (
      !Number.isInteger(state.reactionWindow.nextResponderIndex) ||
      state.reactionWindow.nextResponderIndex < 0 ||
      state.reactionWindow.nextResponderIndex >= responders.length
    ) {
      throw new Error("响应窗口的当前响应位置无效");
    }
    if (state.reactionWindow.kind === "burn") {
      const context = state.burnContexts.at(-1);
      if (
        !context ||
        state.reactionWindow.affectedPlayerId !== context.frames.at(-1)?.targetPlayerId
      ) {
        throw new Error("烧毁响应窗口与当前烧毁行动不一致");
      }
    } else if (state.reactionWindow.kind === "secretOrder") {
      if (
        !state.pendingSecretOrder ||
        (state.reactionWindow.affectedPlayerId !== state.activePlayerId &&
          state.reactionWindow.affectedPlayerId !==
            state.secretOrderStack.at(-1)?.targetPlayerId)
      ) {
        throw new Error("秘密下达响应窗口无效");
      }
    } else if (state.reactionWindow.kind === "function") {
      if (
        !state.activeFunctionAction ||
        state.activeFunctionAction.stage !== "reactions" ||
        state.reactionWindow.affectedPlayerId !==
          state.activeFunctionStack.at(-1)?.targetPlayerId
      ) {
        throw new Error("功能牌响应窗口与当前功能牌行动不一致");
      }
    } else if (state.reactionWindow.kind === "transfer") {
      const transferFrame = [...state.interactionStack]
        .reverse()
        .find((frame) => frame.kind === "transfer");
      if (
        !transferFrame ||
        !state.transmission?.pendingTransfer ||
        transferFrame.sourcePlayerId !== state.transmission.intendedRecipientId
      ) {
        throw new Error("转移互动与响应窗口关联不一致");
      }
    } else if (
      state.reactionWindow.affectedPlayerId !==
        state.transmission?.intendedRecipientId &&
      state.reactionWindow.affectedPlayerId !==
        state.interactionStack.at(-1)?.targetPlayerId
    ) {
      throw new Error("情报响应窗口目标与当前卡牌行动不一致");
    }
  }
  const expectedCardNameByAction: Record<CardActionKind, PhysicalCard["name"]> = {
    intercept: "截获",
    transfer: "转移",
    separation: "离间",
    counter: "识破",
    lock: "锁定",
    swap: "掉包",
    lure: "调虎离山",
    decrypt: "破译",
  };
  for (const frame of state.interactionStack) {
    if (
      cardById(frame.sourceCardId).name !== expectedCardNameByAction[frame.kind] ||
      !state.publicDiscard.includes(frame.sourceCardId) ||
      !state.players[frame.sourcePlayerId] ||
      !state.players[frame.targetPlayerId] ||
      !state.players[frame.snapshot.intendedRecipientId] ||
      frame.snapshot.returnedToSender !==
        (frame.snapshot.intendedRecipientId === state.transmission?.senderId)
    ) {
      throw new Error("卡牌互动栈包含无效帧");
    }
    if (
      frame.kind === "counter" &&
      (!frame.targetInteractionId ||
        !state.interactionStack
          .slice(0, state.interactionStack.indexOf(frame))
          .some((candidate) => candidate.id === frame.targetInteractionId))
    ) {
      throw new Error("识破必须指向更早的互动帧");
    }
  }
  for (const context of state.burnContexts) {
    const targetCard = cardById(context.targetIntelligenceCardId);
    if (
      cardById(context.sourceCardId).name !== "烧毁" ||
      !state.publicDiscard.includes(context.sourceCardId) ||
      !state.players[context.sourcePlayerId] ||
      !state.players[context.targetPlayerId] ||
      targetCard.color !== "黑" ||
      targetCard.unburnable ||
      context.frames.length === 0 ||
      context.frames[0].kind !== "burn"
    ) {
      throw new Error("烧毁行动上下文无效");
    }
    for (const [index, frame] of context.frames.entries()) {
      if (
        cardById(frame.sourceCardId).name !==
          (frame.kind === "burn" ? "烧毁" : "识破") ||
        !state.publicDiscard.includes(frame.sourceCardId) ||
        frame.id !== `interaction-${frame.sequence}` ||
        frame.sequence >= state.nextInteractionSequence ||
        !state.players[frame.sourcePlayerId] ||
        !state.players[frame.targetPlayerId] ||
        (frame.kind === "counter" &&
          (!frame.targetInteractionId ||
            !context.frames
              .slice(0, index)
              .some((candidate) => candidate.id === frame.targetInteractionId)))
      ) {
        throw new Error("烧毁互动栈包含无效帧");
      }
    }
  }
  if ((state.reactionWindow?.kind === "burn") !== (state.burnContexts.length > 0)) {
    throw new Error("烧毁响应窗口与烧毁上下文栈不一致");
  }
  if (
    !Number.isInteger(state.nextInteractionSequence) ||
    state.nextInteractionSequence < 1
  ) {
    throw new Error("下一个互动序号无效");
  }
  if (
    !Number.isInteger(state.randomState) ||
    state.randomState < 0 ||
    state.randomState > 0xffff_ffff
  ) {
    throw new Error("游戏随机状态无效");
  }
  if (
    new Set(state.interactionStack.map((frame) => frame.id)).size !==
    state.interactionStack.length
  ) {
    throw new Error("互动栈ID不得重复");
  }
  if (
    new Set(state.interactionStack.map((frame) => frame.sourceCardId)).size !==
    state.interactionStack.length
  ) {
    throw new Error("同一张牌不能产生多个卡牌互动帧");
  }
  for (const frame of state.interactionStack) {
    if (
      !Number.isInteger(frame.sequence) ||
      frame.sequence < 1 ||
      frame.id !== `interaction-${frame.sequence}` ||
      frame.sequence >= state.nextInteractionSequence
    ) {
      throw new Error("卡牌互动ID或序号无效");
    }
  }
  if (!state.transmission && state.interactionStack.length > 0) {
    throw new Error("没有传递时互动栈必须为空");
  }
  if ((state.phase === "preTransmission") !== Boolean(state.pendingSecretOrder)) {
    throw new Error("传递准备阶段与秘密下达窗口不一致");
  }
  if (Boolean(state.activeFunctionAction) !== (state.activeFunctionStack.length > 0)) {
    throw new Error("功能牌行动与功能牌互动栈不一致");
  }
  if (state.activeFunctionAction) {
    const action = state.activeFunctionAction;
    if (
      state.phase !== "initialized" ||
      state.transmission ||
      action.sourcePlayerId !== state.activePlayerId ||
      !state.players[action.sourcePlayerId]?.alive ||
      !state.players[action.targetPlayerId]?.alive ||
      !(
        state.publicDiscard.includes(action.sourceCardId) ||
        state.removedProbes.includes(action.sourceCardId)
      )
    ) {
      throw new Error("待处理功能牌行动无效");
    }
    if (
      action.stage === "reactions" && !hasReactionKind(state, "function")
    ) {
      throw new Error("功能牌响应阶段必须拥有响应窗口");
    }
    if (action.stage !== "reactions" && state.reactionWindow && state.reactionWindow.kind !== "burn") {
      throw new Error("功能牌选择阶段不能保留响应窗口");
    }
  }
  for (const frame of state.activeFunctionStack) {
    if (
      !(
        state.publicDiscard.includes(frame.sourceCardId) ||
        state.removedProbes.includes(frame.sourceCardId)
      ) ||
      !state.players[frame.sourcePlayerId] ||
      !state.players[frame.targetPlayerId] ||
      frame.id !== `interaction-${frame.sequence}` ||
      frame.sequence >= state.nextInteractionSequence
    ) {
      throw new Error("功能牌互动栈包含无效帧");
    }
  }
  if ((state.phase === "gameOver") !== Boolean(state.winner)) {
    throw new Error("游戏结束阶段与胜者状态不一致");
  }
  if (state.transmission) {
    const transmission = state.transmission;
    if (
      !Number.isInteger(transmission.receiptCycle) ||
      transmission.receiptCycle < 1
    ) {
      throw new Error("接收流程序号无效");
    }
    if (transmission.locked && !transmission.lockOfferUsed) {
      throw new Error("锁定生效前必须消耗本次锁定机会");
    }
    if (transmission.locked && transmission.interceptorCommitted) {
      throw new Error("截获承诺接收时不能保留前一接收者的锁定");
    }
    if (
      transmission.receiptStage === "decision" &&
      state.reactionWindow
    ) {
      throw new Error("接收决定阶段不能保留响应窗口");
    }
    if (
      transmission.receiptStage === "lockOffer" &&
      !state.reactionWindow &&
      transmission.lockOfferUsed
    ) {
      throw new Error("未进入锁定响应时，锁定机会状态不一致");
    }
    if (
      !state.players[transmission.senderId]?.alive ||
      !state.players[transmission.intendedRecipientId]?.alive
    ) {
      throw new Error("传递中的发送者和接收者必须存活且存在");
    }
    if (transmission.senderId !== state.activePlayerId) {
      throw new Error("传递发送者必须是当前行动玩家");
    }
    if (
      transmission.returnedToSender &&
      transmission.intendedRecipientId !== transmission.senderId
    ) {
      throw new Error("已返回发送者的情报必须以发送者为当前接收者");
    }
    if (
      transmission.interceptorCommitted &&
      transmission.intendedRecipientId === transmission.senderId
    ) {
      throw new Error("原发送者不能成为承诺接收的截获者");
    }
    if (transmission.pendingTransfer) {
      const pending = transmission.pendingTransfer;
      if (
        !state.players[pending.targetId]?.alive ||
        cardById(pending.sourceCardId).name !== "转移" ||
        !state.publicDiscard.includes(pending.sourceCardId)
      ) {
        throw new Error("待响应的转移状态无效");
      }
    }
    if (
      transmission.pendingSwap &&
      (cardById(transmission.pendingSwap.sourceCardId).name !== "掉包" ||
        !state.publicDiscard.includes(transmission.pendingSwap.sourceCardId))
    ) {
      throw new Error("待响应的掉包状态无效");
    }
    if (
      transmission.pendingLure &&
      (cardById(transmission.pendingLure.sourceCardId).name !== "调虎离山" ||
        !state.publicDiscard.includes(transmission.pendingLure.sourceCardId) ||
        transmission.pendingLure.targetId !== transmission.intendedRecipientId)
    ) {
      throw new Error("待响应的调虎离山状态无效");
    }
    const card = cardById(transmission.cardId);
    const preservesReplacedMethod = card.name === "掉包" && transmission.faceUp;
    if (
      !preservesReplacedMethod &&
      card.transmission !== "任意" &&
      card.transmission !== transmission.method
    ) {
      throw new Error("传递方式与实体牌不一致");
    }
    if (transmission.method === "直达" && transmission.direction) {
      throw new Error("直达情报不应包含方向");
    }
    if (transmission.method !== "直达" && !transmission.direction) {
      throw new Error("密电或文本必须保存固定方向");
    }
  }
}

function cardById(id: PhysicalCardId): PhysicalCard {
  const card = CARD_BY_ID.get(id);
  if (!card) throw new Error(`未知实体牌：${id}`);
  return card;
}

function describePublicTextCard(card: PhysicalCard): string {
  if (card.name !== "公开文本") throw new Error("只能公开描述公开文本牌");
  const marks = [
    card.color,
    card.transmission,
    ...(card.circle ? ["可选方向"] : []),
    ...(card.unburnable ? ["不可烧毁"] : []),
  ];
  let effect: string;
  if (card.color === "红" || card.color === "蓝") {
    const mandatoryFaction = card.color === "红" ? "潜伏" : "军情";
    effect = `${mandatoryFaction}必须弃1张；其他阵营选择摸1张或弃1张`;
  } else if (card.variant?.kind === "publicTextBlack") {
    effect = `${card.variant.mandatoryDrawFaction}摸1张；其他阵营选择摸1张或2张`;
  } else {
    throw new Error("公开文本缺少实体牌效果参数");
  }
  return `公开文本【${marks.join(" · ")}；${effect}】`;
}

function projectedCardById(id: PhysicalCardId): PhysicalCard {
  return structuredClone(cardById(id));
}

function nextLivingPlayer(
  state: GameState,
  fromId: PlayerId,
  direction: Direction,
): PlayerId {
  const start = state.seatOrder.indexOf(fromId);
  if (start < 0) throw new Error("玩家不在座位列表中");
  const step = direction === "clockwise" ? 1 : -1;
  for (let distance = 1; distance < state.seatOrder.length; distance += 1) {
    const index =
      (start + step * distance + state.seatOrder.length) % state.seatOrder.length;
    const candidate = state.seatOrder[index];
    if (state.players[candidate].alive) return candidate;
  }
  throw new Error("没有可接收情报的其他存活玩家");
}

function tryNextLivingPlayer(
  state: GameState,
  fromId: PlayerId,
  direction: Direction,
): PlayerId | undefined {
  try {
    return nextLivingPlayer(state, fromId, direction);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "没有可接收情报的其他存活玩家"
    ) {
      return undefined;
    }
    throw error;
  }
}

function reactionOrderAfterTarget(
  state: GameState,
  targetId: PlayerId,
): PlayerId[] {
  const targetIndex = state.seatOrder.indexOf(targetId);
  if (targetIndex < 0) throw new Error("响应目标不在座位列表中");
  const ordered: PlayerId[] = [];
  for (let distance = 1; distance <= state.seatOrder.length; distance += 1) {
    const id = state.seatOrder[(targetIndex + distance) % state.seatOrder.length];
    if (state.players[id].alive) ordered.push(id);
  }
  return ordered;
}

function cloneReactionWindow(window: ReactionWindow | undefined): ReactionWindow | undefined {
  return window
    ? { ...window, responderOrder: [...window.responderOrder] }
    : undefined;
}

function hasReactionKind(state: GameState, kind: ReactionWindow["kind"]): boolean {
  return (
    state.reactionWindow?.kind === kind ||
    state.burnContexts.some(
      (context) => context.suspendedReactionWindow?.kind === kind,
    )
  );
}

function openIntelligenceReactionWindow(
  state: GameState,
  affectedPlayerId: PlayerId,
): void {
  state.reactionWindow = {
    kind: "intelligence",
    affectedPlayerId,
    responderOrder: reactionOrderAfterTarget(state, affectedPlayerId),
    nextResponderIndex: 0,
  };
}

function captureInteractionSnapshot(
  transmission: TransmissionState,
): ReversibleInteractionSnapshot {
  return {
    intendedRecipientId: transmission.intendedRecipientId,
    returnedToSender: transmission.returnedToSender,
    interceptorCommitted: transmission.interceptorCommitted,
    transferredRecipientCommitted: transmission.transferredRecipientCommitted,
    receiptStage: transmission.receiptStage,
    locked: transmission.locked,
    receiptCycle: transmission.receiptCycle,
    lockOfferUsed: transmission.lockOfferUsed,
    pendingTransfer: transmission.pendingTransfer
      ? { ...transmission.pendingTransfer }
      : undefined,
    pendingSwap: transmission.pendingSwap
      ? { ...transmission.pendingSwap }
      : undefined,
    pendingLure: transmission.pendingLure
      ? { ...transmission.pendingLure }
      : undefined,
    pendingDecrypt: transmission.pendingDecrypt
      ? { ...transmission.pendingDecrypt }
      : undefined,
    decryptedById: transmission.decryptedById,
  };
}

function restoreInteractionSnapshot(
  transmission: TransmissionState,
  snapshot: ReversibleInteractionSnapshot,
): void {
  transmission.intendedRecipientId = snapshot.intendedRecipientId;
  transmission.returnedToSender = snapshot.returnedToSender;
  transmission.interceptorCommitted = snapshot.interceptorCommitted;
  transmission.transferredRecipientCommitted = snapshot.transferredRecipientCommitted;
  transmission.receiptStage = snapshot.receiptStage;
  transmission.locked = snapshot.locked;
  transmission.receiptCycle = snapshot.receiptCycle;
  transmission.lockOfferUsed = snapshot.lockOfferUsed;
  transmission.pendingTransfer = snapshot.pendingTransfer
    ? { ...snapshot.pendingTransfer }
    : undefined;
  transmission.pendingSwap = snapshot.pendingSwap
      ? { ...snapshot.pendingSwap }
      : undefined;
  transmission.pendingLure = snapshot.pendingLure
    ? { ...snapshot.pendingLure }
    : undefined;
  transmission.pendingDecrypt = snapshot.pendingDecrypt
    ? { ...snapshot.pendingDecrypt }
    : undefined;
  transmission.decryptedById = snapshot.decryptedById;
}

function pushCardActionFrame(
  state: GameState,
  frame: Omit<
    CardActionFrame,
    | "id"
    | "sequence"
    | "separationUsed"
    | "previousRecipientId"
    | "previousReturnedToSender"
  >,
): CardActionFrame {
  const action: CardActionFrame = {
    ...frame,
    id: `interaction-${state.nextInteractionSequence}`,
    sequence: state.nextInteractionSequence,
    previousRecipientId: frame.snapshot.intendedRecipientId,
    previousReturnedToSender: frame.snapshot.returnedToSender,
    separationUsed: false,
  };
  state.nextInteractionSequence += 1;
  state.interactionStack.push(action);
  return action;
}

function beginNormalReceiptCycle(
  state: GameState,
  recipientId: PlayerId,
  returnedToSender: boolean,
  skipLockOffer = false,
): void {
  const transmission = state.transmission;
  if (!transmission) throw new Error("当前没有待处理的情报");
  transmission.intendedRecipientId = recipientId;
  transmission.returnedToSender = returnedToSender;
  transmission.interceptorCommitted = false;
  transmission.transferredRecipientCommitted = false;
  transmission.receiptCycle += 1;
  transmission.lockOfferUsed = returnedToSender || skipLockOffer;
  transmission.locked = false;
  transmission.pendingTransfer = undefined;
  transmission.pendingSwap = undefined;
  transmission.pendingLure = undefined;
  transmission.pendingDecrypt = undefined;
  transmission.decryptedById = undefined;
  state.interactionStack = [];
  state.reactionWindow = undefined;

  if (returnedToSender || skipLockOffer) {
    transmission.receiptStage = "reactions";
    openIntelligenceReactionWindow(state, recipientId);
  } else {
    transmission.receiptStage = "lockOffer";
  }
}

function beginReceiptReactionStage(state: GameState): void {
  const transmission = state.transmission;
  if (!transmission) throw new Error("当前没有待处理的情报");
  transmission.receiptStage = "reactions";
  openIntelligenceReactionWindow(state, transmission.intendedRecipientId);
}

function advanceToNextTurn(state: GameState): void {
  const previousActivePlayerId = state.activePlayerId;
  const nextPlayerId = tryNextLivingPlayer(
    state,
    previousActivePlayerId,
    "clockwise",
  );
  if (!nextPlayerId) {
    state.phase = "awaitingTurnEnd";
    state.auditLog.push("没有其他存活玩家，等待结束规则确认");
    return;
  }

  state.activePlayerId = nextPlayerId;
  const drawn = drawCards(state, nextPlayerId, 2);
  state.phase = "initialized";
  state.auditLog.push(`${nextPlayerId}回合开始并摸${drawn.length}张牌`);
}

function clearUnresolvedTurnState(state: GameState, discardTransmission: boolean): void {
  if (discardTransmission && state.transmission) {
    state.publicDiscard.push(state.transmission.cardId);
  }
  state.transmission = undefined;
  state.pendingPublicTextReceipt = undefined;
  state.pendingSecretOrder = undefined;
  state.reactionWindow = undefined;
  state.interactionStack = [];
  state.activeFunctionAction = undefined;
  state.activeFunctionStack = [];
  state.secretOrderStack = [];
  state.burnContexts = [];
}

function survivingFactionWinner(state: GameState): WinnerState | undefined {
  const survivors = state.seatOrder.filter((id) => state.players[id].alive);
  if (survivors.length === 0) return undefined;
  const survivingFactions = new Set(
    survivors.map((id) => state.players[id].faction),
  );
  if (survivingFactions.size !== 1) return undefined;
  const faction = state.players[survivors[0]].faction;
  if (faction === "特工") {
    return survivors.length === 1
      ? { kind: "agent", playerId: survivors[0] }
      : undefined;
  }
  return { kind: "faction", faction };
}

function finishFactionEliminationVictory(
  state: GameState,
  discardTransmission: boolean,
): boolean {
  const winner = survivingFactionWinner(state);
  if (!winner) return false;
  clearUnresolvedTurnState(state, discardTransmission);
  state.winner = winner;
  state.phase = "gameOver";
  state.auditLog.push("其他阵营已全部死亡，游戏立即结束");
  assertGameStateInvariants(state);
  return true;
}

function rebuildReactionPriorityAfterDeath(
  state: GameState,
  deadPlayerId: PlayerId,
): void {
  const window = state.reactionWindow;
  if (!window) return;
  const passed = new Set(window.responderOrder.slice(0, window.nextResponderIndex));
  passed.delete(deadPlayerId);
  const rebuilt = reactionOrderAfterTarget(state, window.affectedPlayerId);
  let nextIndex = 0;
  while (nextIndex < rebuilt.length && passed.has(rebuilt[nextIndex])) {
    nextIndex += 1;
  }
  window.responderOrder = rebuilt;
  window.nextResponderIndex = nextIndex;
  if (nextIndex === rebuilt.length) finishPassedReactionWindow(state, window);
}

function pruneSuspendedBurnPrioritiesAfterDeath(
  state: GameState,
  deadPlayerId: PlayerId,
): void {
  for (const context of state.burnContexts) {
    const window = context.suspendedReactionWindow;
    if (!window) continue;
    const passed = new Set(window.responderOrder.slice(0, window.nextResponderIndex));
    passed.delete(deadPlayerId);
    window.responderOrder = reactionOrderAfterTarget(state, window.affectedPlayerId);
    let nextIndex = 0;
    while (nextIndex < window.responderOrder.length && passed.has(window.responderOrder[nextIndex])) {
      nextIndex += 1;
    }
    context.suspendedReactionCompleted =
      nextIndex === window.responderOrder.length;
    // Keep the snapshot structurally valid while it is suspended. Completed
    // snapshots are settled immediately on restoration and never re-offered.
    window.nextResponderIndex = context.suspendedReactionCompleted ? 0 : nextIndex;
  }
}

function cancelPendingBurnsForDeathCleanup(state: GameState): void {
  if (state.burnContexts.length === 0) return;
  state.burnContexts = [];
  if (state.reactionWindow?.kind === "burn") state.reactionWindow = undefined;
  state.auditLog.push("死亡结算改变当前流程，所有待结算烧毁行动取消（已使用牌不返还）");
}

/**
 * Applies the confirmed host-imposed death policy as one deterministic engine
 * transition. The room layer is responsible for authorizing the host and
 * verifying that the target is disconnected before calling this function.
 */
export function resolveHostImposedDeath(
  state: GameState,
  playerId: PlayerId,
): void {
  if (state.phase === "gameOver") throw new Error("游戏已经结束");
  const player = state.players[playerId];
  if (!player) throw new Error("被判定死亡的玩家不在本局游戏中");
  if (!player.alive) throw new Error("该玩家已经死亡");

  const wasActiveSender = playerId === state.activePlayerId;
  const wasIntendedRecipient = state.transmission?.intendedRecipientId === playerId;
  const wasCommittedRecipient = Boolean(
    wasIntendedRecipient &&
      (state.transmission?.locked ||
        state.transmission?.interceptorCommitted ||
        state.transmission?.transferredRecipientCommitted),
  );
  const wasFunctionTarget = state.activeFunctionAction?.targetPlayerId === playerId;
  const wasSecretOrderSource = state.pendingSecretOrder?.sourcePlayerId === playerId;
  const wasPublicTextChoiceTarget =
    state.pendingPublicTextReceipt?.recipientId === playerId;

  player.alive = false;
  player.factionRevealed = true;
  pruneSuspendedBurnPrioritiesAfterDeath(state, playerId);
  state.auditLog.push(`${playerId}被房主判定死亡，阵营公开为${player.faction}`);

  if (finishFactionEliminationVictory(state, Boolean(state.transmission))) return;

  // Active-sender death has precedence over returned intelligence where the
  // sender is also the current intended recipient.
  if (wasActiveSender) {
    clearUnresolvedTurnState(state, Boolean(state.transmission));
    state.auditLog.push(`${playerId}作为当前行动玩家死亡，其回合中止`);
    advanceToNextTurn(state);
    assertGameStateInvariants(state);
    return;
  }

  if (wasIntendedRecipient && state.transmission) {
    cancelPendingBurnsForDeathCleanup(state);
    if (wasCommittedRecipient) {
      clearUnresolvedTurnState(state, true);
      state.auditLog.push(`${playerId}死亡，必须接收的待传情报被公开弃置`);
      advanceToNextTurn(state);
    } else {
      const transmission = state.transmission;
      const nextRecipientId =
        transmission.method === "直达"
          ? transmission.senderId
          : nextLivingPlayer(
              state,
              playerId,
              transmission.direction ?? "clockwise",
            );
      beginNormalReceiptCycle(
        state,
        nextRecipientId,
        nextRecipientId === transmission.senderId,
      );
      state.auditLog.push(
        `${playerId}死亡并视为拒绝情报，当前接收者：${nextRecipientId}`,
      );
    }
    assertGameStateInvariants(state);
    return;
  }

  if (wasPublicTextChoiceTarget) {
    cancelPendingBurnsForDeathCleanup(state);
    state.pendingPublicTextReceipt = undefined;
    state.auditLog.push(`${playerId}死亡，未完成的公开文本接收效果取消`);
    state.auditLog.push(`${state.activePlayerId}的回合结束`);
    advanceToNextTurn(state);
    assertGameStateInvariants(state);
    return;
  }

  if (wasFunctionTarget) {
    cancelPendingBurnsForDeathCleanup(state);
    state.activeFunctionAction = undefined;
    state.activeFunctionStack = [];
    state.reactionWindow = undefined;
    state.auditLog.push(`${playerId}死亡，未完成的功能牌效果取消`);
    assertGameStateInvariants(state);
    return;
  }

  if (wasSecretOrderSource && state.pendingSecretOrder) {
    cancelPendingBurnsForDeathCleanup(state);
    state.pendingSecretOrder = {
      stage: "selection",
      targetPlayerId: state.activePlayerId,
      countered: true,
      verifiedNoMatch: false,
    };
    state.secretOrderStack = [];
    state.reactionWindow = undefined;
    state.auditLog.push(`${playerId}死亡，未完成的秘密下达效果取消`);
    assertGameStateInvariants(state);
    return;
  }

  rebuildReactionPriorityAfterDeath(state, playerId);
  assertGameStateInvariants(state);
}

export interface StartTransmissionOptions {
  method?: FixedTransmissionMethod;
  direction?: Direction;
  targetId?: PlayerId;
}

export function enterTransmissionPhase(state: GameState, actorId: PlayerId): void {
  if (state.phase !== "initialized" || state.activeFunctionAction || state.reactionWindow) {
    throw new Error("当前不能进入传递阶段");
  }
  if (actorId !== state.activePlayerId || !state.players[actorId]?.alive) {
    throw new Error("只有当前存活玩家可以进入传递阶段");
  }
  if (state.players[actorId].hand.length > 7) {
    state.phase = "discardingForTransmission";
    assertGameStateInvariants(state);
    return;
  }
  beginPreTransmissionPhase(state, actorId);
}

function beginPreTransmissionPhase(state: GameState, actorId: PlayerId): void {
  state.phase = "preTransmission";
  state.pendingSecretOrder = {
    stage: "offering",
    targetPlayerId: actorId,
    countered: false,
    verifiedNoMatch: false,
  };
  state.secretOrderStack = [];
  const responders = reactionOrderAfterTarget(state, actorId).filter(
    (playerId) => playerId !== actorId,
  );
  if (responders.length === 0) {
    state.pendingSecretOrder.stage = "selection";
    state.reactionWindow = undefined;
  } else {
    state.reactionWindow = {
      kind: "secretOrder",
      affectedPlayerId: actorId,
      responderOrder: responders,
      nextResponderIndex: 0,
    };
  }
  state.auditLog.push(`${actorId}结束功能牌阶段，进入秘密下达窗口`);
  assertGameStateInvariants(state);
}

export function playSecretOrder(
  state: GameState,
  actorId: PlayerId,
  cardId: PhysicalCardId,
  word: SecretOrderWord,
): void {
  const pending = state.pendingSecretOrder;
  const window = state.reactionWindow;
  if (
    state.phase !== "preTransmission" ||
    !pending ||
    pending.stage !== "offering" ||
    !window ||
    window.kind !== "secretOrder" ||
    window.responderOrder[window.nextResponderIndex] !== actorId ||
    actorId === state.activePlayerId
  ) throw new Error("当前不能使用秘密下达");
  const actor = state.players[actorId];
  const index = actor?.hand.indexOf(cardId) ?? -1;
  const card = index >= 0 ? cardById(cardId) : undefined;
  if (!actor?.alive || !card || card.variant?.kind !== "secretOrder") {
    throw new Error("必须使用自己手中的秘密下达");
  }
  actor.hand.splice(index, 1);
  state.hiddenSecretOrders.push(cardId);
  state.privateNotices[actorId].push({
    kind: "secretOrderPlayed",
    otherPlayerId: state.activePlayerId,
    cardId,
  });
  state.privateNotices[state.activePlayerId].push({
    kind: "secretOrderReceived",
    otherPlayerId: actorId,
    cardId,
  });
  pending.stage = "reactions";
  pending.sourcePlayerId = actorId;
  pending.sourceCardId = cardId;
  pending.word = word;
  pending.requiredColor = card.variant.mapping[word];
  pending.countered = false;
  const sequence = state.nextInteractionSequence++;
  state.secretOrderStack = [{
    id: `interaction-${sequence}`,
    sequence,
    kind: "secretOrder",
    sourcePlayerId: actorId,
    sourceCardId: cardId,
    targetPlayerId: state.activePlayerId,
    snapshot: { countered: true },
  }];
  state.reactionWindow = {
    kind: "secretOrder",
    affectedPlayerId: state.activePlayerId,
    responderOrder: reactionOrderAfterTarget(state, state.activePlayerId),
    nextResponderIndex: 0,
  };
  state.auditLog.push(`${actorId}使用秘密下达并宣布：${word}`);
  assertGameStateInvariants(state);
}

export function claimNoSecretOrderMatch(state: GameState, actorId: PlayerId): void {
  const pending = state.pendingSecretOrder;
  if (
    state.phase !== "preTransmission" ||
    !pending ||
    pending.stage !== "selection" ||
    pending.countered ||
    !pending.requiredColor ||
    actorId !== state.activePlayerId
  ) throw new Error("当前没有可验证的秘密下达");
  const matching = state.players[actorId].hand.some((id) =>
    cardMatchesSecretOrder(cardById(id), pending.requiredColor!),
  );
  if (matching) throw new Error("手牌中存在符合秘密下达颜色的牌");
  pending.verifiedNoMatch = true;
  state.auditLog.push(`${actorId}声明无匹配牌并通过服务器验证`);
  assertGameStateInvariants(state);
}

function cardMatchesSecretOrder(card: PhysicalCard, color: SingleColor): boolean {
  return card.color === color || (card.color === "红蓝" && color !== "黑");
}

function requireActiveFunctionCard(
  state: GameState,
  actorId: PlayerId,
  cardId: PhysicalCardId,
  expectedName: PhysicalCard["name"],
): { actor: PlayerState; cardIndex: number } {
  if (state.phase !== "initialized" || state.transmission) {
    throw new Error("当前不在功能牌行动阶段");
  }
  if (state.activeFunctionAction || state.reactionWindow) {
    throw new Error("必须先完成当前功能牌行动");
  }
  if (actorId !== state.activePlayerId) throw new Error("只有当前玩家可以使用功能牌");
  const actor = state.players[actorId];
  if (!actor?.alive) throw new Error("死亡玩家不能使用功能牌");
  if (actor.hand.length <= 1) throw new Error("必须至少保留一张手牌用于传递");
  const cardIndex = actor.hand.indexOf(cardId);
  if (cardIndex < 0 || cardById(cardId).name !== expectedName) {
    throw new Error(`必须使用自己手中的${expectedName}`);
  }
  return { actor, cardIndex };
}

function beginActiveFunctionAction(
  state: GameState,
  actorId: PlayerId,
  cardId: PhysicalCardId,
  kind: ActiveFunctionKind,
  targetPlayerId: PlayerId,
): void {
  const actor = state.players[actorId];
  actor.hand.splice(actor.hand.indexOf(cardId), 1);
  state.publicDiscard.push(cardId);
  const sequence = state.nextInteractionSequence;
  state.nextInteractionSequence += 1;
  state.activeFunctionAction = {
    kind,
    sourcePlayerId: actorId,
    sourceCardId: cardId,
    originalTargetPlayerId: targetPlayerId,
    targetPlayerId,
    separationUsed: false,
    countered: false,
    stage: "reactions",
  };
  state.activeFunctionStack = [
    {
      id: `interaction-${sequence}`,
      sequence,
      kind: "function",
      sourcePlayerId: actorId,
      sourceCardId: cardId,
      targetPlayerId,
      snapshot: { targetPlayerId, countered: true },
    },
  ];
  state.reactionWindow = {
    kind: "function",
    affectedPlayerId: targetPlayerId,
    responderOrder: reactionOrderAfterTarget(state, targetPlayerId),
    nextResponderIndex: 0,
  };
}

export function playReinforcement(
  state: GameState,
  actorId: PlayerId,
  cardId: PhysicalCardId,
): void {
  requireActiveFunctionCard(state, actorId, cardId, "增援");
  beginActiveFunctionAction(state, actorId, cardId, "reinforcement", actorId);
  state.auditLog.push(`${actorId}使用增援，等待响应`);
  assertGameStateInvariants(state);
}

export function playConfidentialFile(
  state: GameState,
  actorId: PlayerId,
  cardId: PhysicalCardId,
): void {
  requireActiveFunctionCard(state, actorId, cardId, "机密文件");
  if (countTrueIntelligenceOnField(state) < 4) {
    throw new Error("场上至少需要4张真情报才能使用机密文件");
  }
  beginActiveFunctionAction(state, actorId, cardId, "confidentialFile", actorId);
  state.auditLog.push(`${actorId}使用机密文件，等待响应`);
  assertGameStateInvariants(state);
}

function requireNonemptyFunctionTarget(
  state: GameState,
  actorId: PlayerId,
  targetId: PlayerId,
): void {
  if (targetId === actorId || !state.players[targetId]?.alive) {
    throw new Error("必须选择另一名存活玩家");
  }
  if (state.players[targetId].hand.length === 0) {
    throw new Error("目标玩家必须至少有一张手牌");
  }
}

export function playPublicText(
  state: GameState,
  actorId: PlayerId,
  cardId: PhysicalCardId,
  targetId: PlayerId,
): void {
  requireActiveFunctionCard(state, actorId, cardId, "公开文本");
  requireNonemptyFunctionTarget(state, actorId, targetId);
  beginActiveFunctionAction(state, actorId, cardId, "publicText", targetId);
  state.auditLog.push(`${actorId}对${targetId}使用公开文本，等待响应`);
  assertGameStateInvariants(state);
}

export function playDangerousIntelligence(
  state: GameState,
  actorId: PlayerId,
  cardId: PhysicalCardId,
  targetId: PlayerId,
): void {
  requireActiveFunctionCard(state, actorId, cardId, "危险情报");
  requireNonemptyFunctionTarget(state, actorId, targetId);
  beginActiveFunctionAction(
    state,
    actorId,
    cardId,
    "dangerousIntelligence",
    targetId,
  );
  state.auditLog.push(`${actorId}对${targetId}使用危险情报，等待响应`);
  assertGameStateInvariants(state);
}

export function playProbe(
  state: GameState,
  actorId: PlayerId,
  cardId: PhysicalCardId,
  targetId: PlayerId,
): void {
  requireActiveFunctionCard(state, actorId, cardId, "试探");
  if (targetId === actorId || !state.players[targetId]?.alive) {
    throw new Error("试探必须选择另一名存活玩家");
  }
  const card = cardById(cardId);
  const kind =
    card.variant?.kind === "probeIdentity"
      ? "probeIdentity"
      : card.variant?.kind === "probeDrawDiscard"
        ? "probeDrawDiscard"
        : undefined;
  if (!kind) throw new Error("试探缺少具体版本");
  beginActiveFunctionAction(state, actorId, cardId, kind, targetId);
  state.publicDiscard.splice(state.publicDiscard.indexOf(cardId), 1);
  state.removedProbes.push(cardId);
  state.privateNotices[actorId].push({
    kind: "probePlayed",
    otherPlayerId: targetId,
    cardId,
  });
  state.auditLog.push(`${actorId}对${targetId}使用试探，等待响应`);
  assertGameStateInvariants(state);
}

export function playSeparationOnFunction(
  state: GameState,
  actorId: PlayerId,
  cardId: PhysicalCardId,
  targetId: PlayerId,
): void {
  const action = state.activeFunctionAction;
  const window = state.reactionWindow;
  if (!action || !window || window.kind !== "function" || action.stage !== "reactions") {
    throw new Error("当前没有可被离间改换目标的功能牌行动");
  }
  if (
    action.kind !== "publicText" &&
    action.kind !== "dangerousIntelligence" &&
    action.kind !== "probeIdentity" &&
    action.kind !== "probeDrawDiscard"
  ) {
    throw new Error("该功能牌行动不能被离间改换目标");
  }
  if (window.responderOrder[window.nextResponderIndex] !== actorId) {
    throw new Error("尚未轮到该玩家响应");
  }
  if (action.separationUsed) throw new Error("同一原始卡牌行动最多使用一次离间");
  const actor = state.players[actorId];
  const cardIndex = actor?.hand.indexOf(cardId) ?? -1;
  if (!actor?.alive || cardIndex < 0 || cardById(cardId).name !== "离间") {
    throw new Error("必须使用自己手中的离间牌");
  }
  if (actorId === state.activePlayerId && actor.hand.length <= 1) {
    throw new Error("当前玩家必须至少保留一张手牌用于传递");
  }
  if (
    targetId === action.targetPlayerId ||
    targetId === action.originalTargetPlayerId ||
    targetId === action.sourcePlayerId ||
    !state.players[targetId]?.alive ||
    ((action.kind === "publicText" || action.kind === "dangerousIntelligence") &&
      state.players[targetId].hand.length === 0)
  ) {
    throw new Error("离间必须选择另一名拥有手牌的合法存活目标");
  }

  const sequence = state.nextInteractionSequence;
  state.nextInteractionSequence += 1;
  actor.hand.splice(cardIndex, 1);
  state.publicDiscard.push(cardId);
  action.separationUsed = true;
  state.activeFunctionStack.push({
    id: `interaction-${sequence}`,
    sequence,
    kind: "separation",
    sourcePlayerId: actorId,
    sourceCardId: cardId,
    targetPlayerId: targetId,
    snapshot: {
      targetPlayerId: action.targetPlayerId,
      countered: action.countered,
    },
  });
  action.targetPlayerId = targetId;
  state.reactionWindow = {
    kind: "function",
    affectedPlayerId: targetId,
    responderOrder: reactionOrderAfterTarget(state, targetId),
    nextResponderIndex: 0,
  };
  state.auditLog.push(`${actorId}使用离间，将功能牌目标改为${targetId}`);
  assertGameStateInvariants(state);
}

function finishActiveFunctionAction(state: GameState): void {
  const action = state.activeFunctionAction;
  if (!action) throw new Error("当前没有待结算的功能牌行动");
  state.reactionWindow = undefined;
  if (action.countered) {
    state.auditLog.push(`${cardById(action.sourceCardId).name}被识破，效果取消`);
    state.activeFunctionAction = undefined;
    state.activeFunctionStack = [];
    assertGameStateInvariants(state);
    return;
  }

  const source = state.players[action.sourcePlayerId];
  const target = state.players[action.targetPlayerId];
  if (action.kind === "reinforcement") {
    const count = 1 + countColor(source, "黑");
    const drawn = drawCards(state, source.id, count);
    state.auditLog.push(`${source.id}的增援结算，摸${drawn.length}张牌`);
  } else if (action.kind === "confidentialFile") {
    const trueIntelligenceCount = countTrueIntelligenceOnField(state);
    const requested = trueIntelligenceCount >= 7 ? 3 : trueIntelligenceCount >= 4 ? 2 : 0;
    const drawn = drawCards(state, source.id, requested);
    state.auditLog.push(
      `${source.id}的机密文件结算：场上${trueIntelligenceCount}张真情报，摸${drawn.length}张牌`,
    );
  } else if (action.kind === "publicText") {
    const poolSize = target.hand.length;
    const publicText = cardById(action.sourceCardId);
    const stagedIndex = state.publicDiscard.indexOf(action.sourceCardId);
    if (stagedIndex < 0) throw new Error("公开文本结算状态无效");
    state.publicDiscard.splice(stagedIndex, 1);
    target.hand.push(action.sourceCardId);
    state.auditLog.push(
      `${source.id}交给${target.id}${describePublicTextCard(publicText)}`,
    );
    if (poolSize === 0) {
      state.auditLog.push(`${target.id}已无原有手牌可供${source.id}取得`);
    } else {
      const chosenIndex = Math.floor(nextStateRandom(state) * poolSize);
      const [obtainedCardId] = target.hand.splice(chosenIndex, 1);
      if (!obtainedCardId) throw new Error("公开文本随机选牌失败");
      state.privateNotices[source.id].push({
        kind: "publicTextGained",
        otherPlayerId: target.id,
        cardId: obtainedCardId,
      });
      state.privateNotices[target.id].push({
        kind: "publicTextLost",
        otherPlayerId: source.id,
        cardId: obtainedCardId,
      });
      if (cardById(obtainedCardId).name === "公开文本") {
        state.publicDiscard.push(obtainedCardId);
        state.auditLog.push(`${source.id}随机取得公开文本并将其公开弃置`);
      } else {
        source.hand.push(obtainedCardId);
        state.auditLog.push(`${source.id}完成与${target.id}的公开文本交换`);
      }
    }
  } else if (action.kind === "dangerousIntelligence") {
    if (target.hand.length === 0) {
      state.auditLog.push(`${source.id}的危险情报结算；目标已无手牌可弃置`);
      state.activeFunctionAction = undefined;
      state.activeFunctionStack = [];
      assertGameStateInvariants(state);
      return;
    }
    if (target.hand.length === 1) {
      const [discarded] = target.hand.splice(0, 1);
      if (!discarded) throw new Error("危险情报自动弃牌失败");
      state.publicDiscard.push(discarded);
      state.privateNotices[source.id].push({
        kind: "dangerousDiscardMade",
        otherPlayerId: target.id,
        cardId: discarded,
      });
      state.privateNotices[target.id].push({
        kind: "dangerousDiscardLost",
        otherPlayerId: source.id,
        cardId: discarded,
      });
      state.auditLog.push(
        `${source.id}通过危险情报自动弃置${target.id}唯一的手牌：${describeCardBrief(discarded)}`,
      );
    } else {
      action.stage = "awaitingDiscard";
      state.auditLog.push(`${source.id}私下查看${target.id}的手牌`);
      assertGameStateInvariants(state);
      return;
    }
  } else {
    const probe = cardById(action.sourceCardId);
    if (probe.variant?.kind === "probeIdentity") {
      action.stage = "awaitingProbeChoice";
      state.auditLog.push(`${target.id}须回应试探`);
      assertGameStateInvariants(state);
      return;
    }
    if (probe.variant?.kind !== "probeDrawDiscard") {
      throw new Error("试探缺少具体版本");
    }
    if (target.faction === probe.variant.drawFaction) {
      const drawn = drawCards(state, target.id, 1);
      state.auditLog.push(`${target.id}因试探摸${drawn.length}张牌`);
    } else if (target.hand.length === 0) {
      state.auditLog.push(`${target.id}因试探须弃牌，但其没有手牌`);
    } else if (target.hand.length === 1) {
      const [discarded] = target.hand.splice(0, 1);
      if (!discarded) throw new Error("试探自动弃牌失败");
      state.publicDiscard.push(discarded);
      state.auditLog.push(`${target.id}因试探自动弃置唯一的手牌`);
    } else {
      action.stage = "awaitingProbeDiscard";
      state.auditLog.push(`${target.id}须因试探弃置一张手牌`);
      assertGameStateInvariants(state);
      return;
    }
  }
  state.activeFunctionAction = undefined;
  state.activeFunctionStack = [];
  assertGameStateInvariants(state);
}

export function chooseProbeIdentityResponse(
  state: GameState,
  actorId: PlayerId,
  choice: "announce" | "giveRandom",
): void {
  const action = state.activeFunctionAction;
  if (
    !action ||
    action.kind !== "probeIdentity" ||
    action.stage !== "awaitingProbeChoice" ||
    action.targetPlayerId !== actorId
  ) {
    throw new Error("当前没有可由该玩家回应的身份试探");
  }
  const target = state.players[actorId];
  const source = state.players[action.sourcePlayerId];
  const probe = cardById(action.sourceCardId);
  if (probe.variant?.kind !== "probeIdentity") throw new Error("身份试探映射无效");
  if (choice === "giveRandom") {
    if (target.hand.length === 0) throw new Error("没有手牌时必须公开身份代码");
    const index = Math.floor(nextStateRandom(state) * target.hand.length);
    const [given] = target.hand.splice(index, 1);
    if (!given) throw new Error("试探随机取牌失败");
    source.hand.push(given);
    state.auditLog.push(`${actorId}选择因试探随机交出一张手牌`);
  } else {
    const code: ProbeCode = probe.variant.mapping[target.faction];
    state.auditLog.push(`${actorId}因试探公开身份代码：${code}`);
  }
  state.activeFunctionAction = undefined;
  state.activeFunctionStack = [];
  assertGameStateInvariants(state);
}

export function chooseProbeDiscard(
  state: GameState,
  actorId: PlayerId,
  cardId: PhysicalCardId,
): void {
  const action = state.activeFunctionAction;
  if (
    !action ||
    action.kind !== "probeDrawDiscard" ||
    action.stage !== "awaitingProbeDiscard" ||
    action.targetPlayerId !== actorId
  ) throw new Error("当前没有可由该玩家执行的试探弃牌");
  const target = state.players[actorId];
  const index = target.hand.indexOf(cardId);
  if (index < 0) throw new Error("只能弃置自己的手牌");
  target.hand.splice(index, 1);
  state.publicDiscard.push(cardId);
  state.auditLog.push(`${actorId}因试探弃置一张手牌`);
  state.activeFunctionAction = undefined;
  state.activeFunctionStack = [];
  assertGameStateInvariants(state);
}

export function chooseDangerousIntelligenceDiscard(
  state: GameState,
  actorId: PlayerId,
  cardId: PhysicalCardId,
): void {
  const action = state.activeFunctionAction;
  if (
    !action ||
    action.kind !== "dangerousIntelligence" ||
    action.stage !== "awaitingDiscard" ||
    action.sourcePlayerId !== actorId
  ) {
    throw new Error("当前没有可由该玩家选择的危险情报弃牌");
  }
  const target = state.players[action.targetPlayerId];
  const cardIndex = target.hand.indexOf(cardId);
  if (cardIndex < 0) throw new Error("只能选择目标当前手中的牌");
  target.hand.splice(cardIndex, 1);
  state.publicDiscard.push(cardId);
  state.privateNotices[actorId].push({
    kind: "dangerousDiscardMade",
    otherPlayerId: target.id,
    cardId,
  });
  state.privateNotices[target.id].push({
    kind: "dangerousDiscardLost",
    otherPlayerId: actorId,
    cardId,
  });
  state.auditLog.push(
    `${actorId}通过危险情报弃置${target.id}的一张牌：${describeCardBrief(cardId)}`,
  );
  state.activeFunctionAction = undefined;
  state.activeFunctionStack = [];
  assertGameStateInvariants(state);
}

function describeCardBrief(cardId: PhysicalCardId): string {
  const card = cardById(cardId);
  return `「${card.name}（${card.color} · ${card.transmission}）」`;
}

export function discardForHandLimit(
  state: GameState,
  actorId: PlayerId,
  cardId: PhysicalCardId,
): void {
  if (state.phase !== "discardingForTransmission" || state.activeFunctionAction) {
    throw new Error("当前不能执行传递前弃牌");
  }
  if (actorId !== state.activePlayerId) throw new Error("只有当前玩家需要执行手牌上限弃牌");
  const player = state.players[actorId];
  if (!player?.alive) throw new Error("死亡玩家不能执行手牌上限弃牌");
  if (player.hand.length <= 7) throw new Error("手牌未超过7张，无需弃牌");
  const cardIndex = player.hand.indexOf(cardId);
  if (cardIndex < 0) throw new Error("只能弃置自己手中的牌");

  player.hand.splice(cardIndex, 1);
  state.publicDiscard.push(cardId);
  state.auditLog.push(`${actorId}因手牌上限弃置一张牌：${cardById(cardId).name}`);
  if (player.hand.length <= 7) {
    beginPreTransmissionPhase(state, actorId);
  } else {
    assertGameStateInvariants(state);
  }
}

export function startTransmission(
  state: GameState,
  actorId: PlayerId,
  cardId: PhysicalCardId,
  options: StartTransmissionOptions = {},
): void {
  if (
    (state.phase !== "initialized" && state.phase !== "preTransmission") ||
    state.activeFunctionAction ||
    state.reactionWindow
  ) {
    throw new Error("当前不能开始传递情报");
  }
  if (actorId !== state.activePlayerId) throw new Error("只有当前玩家可以传递情报");
  const actor = state.players[actorId];
  if (!actor?.alive) throw new Error("死亡玩家不能传递情报");
  if (actor.hand.length > 7) throw new Error("开始传递前必须将手牌弃至7张");
  if (!actor.hand.includes(cardId)) throw new Error("该牌不在当前玩家手中");
  const card = cardById(cardId);
  const order = state.pendingSecretOrder;
  if (state.phase === "preTransmission") {
    if (!order || order.stage !== "selection") {
      throw new Error("秘密下达窗口尚未结束");
    }
    if (
      order.sourceCardId &&
      !order.countered &&
      order.requiredColor &&
      !order.verifiedNoMatch &&
      !cardMatchesSecretOrder(card, order.requiredColor)
    ) {
      throw new Error("必须传递符合秘密下达颜色的牌，或先声明无匹配牌");
    }
  }

  if (
    options.method !== undefined &&
    !(["密电", "文本", "直达"] as const).includes(options.method)
  ) {
    throw new Error("传递方式无效");
  }
  if (
    options.direction !== undefined &&
    !(["clockwise", "counterclockwise"] as const).includes(options.direction)
  ) {
    throw new Error("传递方向无效");
  }

  const method = card.transmission === "任意" ? options.method : card.transmission;
  if (!method) throw new Error("必须选择一种传递方式");
  if (card.transmission !== "任意" && options.method && options.method !== method) {
    throw new Error("不能改变该牌的印刷传递方式");
  }

  let direction: Direction | undefined;
  let intendedRecipientId: PlayerId;
  if (method === "直达") {
    if (!options.targetId || options.targetId === actorId) {
      throw new Error("直达必须选择另一名存活玩家");
    }
    if (!state.players[options.targetId]?.alive) {
      throw new Error("直达目标必须是存活玩家");
    }
    intendedRecipientId = options.targetId;
  } else {
    if (card.circle) {
      if (state.mode === "duel") {
        direction = "clockwise";
      } else {
        if (!options.direction) throw new Error("带圈情报必须选择传递方向");
        direction = options.direction;
      }
    } else {
      if (options.direction === "counterclockwise") {
        throw new Error("不带圈情报不能选择逆时针");
      }
      direction = "clockwise";
    }
    intendedRecipientId = nextLivingPlayer(state, actorId, direction);
  }

  actor.hand.splice(actor.hand.indexOf(cardId), 1);
  state.transmission = {
    cardId,
    senderId: actorId,
    method,
    direction,
    intendedRecipientId,
    returnedToSender: false,
    interceptorCommitted: false,
    transferredRecipientCommitted: false,
    receiptCycle: 0,
    receiptStage: "lockOffer",
    lockOfferUsed: false,
    locked: false,
    faceUp: method === "文本",
  };
  state.phase = "transmitting";
  state.pendingSecretOrder = undefined;
  state.secretOrderStack = [];
  beginNormalReceiptCycle(state, intendedRecipientId, false);
  state.auditLog.push(
    `${actorId}开始以${method}传递情报，当前接收者：${intendedRecipientId}`,
  );
  assertGameStateInvariants(state);
}

export function passLockOpportunity(state: GameState, actorId: PlayerId): void {
  const transmission = state.transmission;
  if (
    state.phase !== "transmitting" ||
    !transmission ||
    transmission.receiptStage !== "lockOffer"
  ) {
    throw new Error("当前没有锁定机会");
  }
  if (actorId !== transmission.senderId || actorId !== state.activePlayerId) {
    throw new Error("只有当前发送者可以放弃锁定");
  }
  if (transmission.lockOfferUsed) throw new Error("本次接收流程的锁定机会已使用");

  transmission.lockOfferUsed = true;
  beginReceiptReactionStage(state);
  state.auditLog.push(`${actorId}放弃对当前接收者使用锁定`);
  assertGameStateInvariants(state);
}

export function playLock(
  state: GameState,
  actorId: PlayerId,
  cardId: PhysicalCardId,
): void {
  const transmission = state.transmission;
  if (
    state.phase !== "transmitting" ||
    !transmission ||
    transmission.receiptStage !== "lockOffer"
  ) {
    throw new Error("当前不能使用锁定");
  }
  if (actorId !== transmission.senderId || actorId !== state.activePlayerId) {
    throw new Error("只有当前发送者可以使用锁定");
  }
  if (transmission.lockOfferUsed) throw new Error("本次接收流程的锁定机会已使用");
  const actor = state.players[actorId];
  const cardIndex = actor?.hand.indexOf(cardId) ?? -1;
  if (!actor?.alive || cardIndex < 0 || cardById(cardId).name !== "锁定") {
    throw new Error("必须使用当前发送者手中的锁定牌");
  }

  actor.hand.splice(cardIndex, 1);
  state.publicDiscard.push(cardId);
  pushCardActionFrame(state, {
    kind: "lock",
    sourcePlayerId: actorId,
    sourceCardId: cardId,
    targetPlayerId: transmission.intendedRecipientId,
    snapshot: captureInteractionSnapshot(transmission),
  });
  transmission.lockOfferUsed = true;
  transmission.locked = true;
  transmission.receiptStage = "reactions";
  state.reactionWindow = {
    kind: "lock",
    affectedPlayerId: transmission.intendedRecipientId,
    responderOrder: reactionOrderAfterTarget(
      state,
      transmission.intendedRecipientId,
    ),
    nextResponderIndex: 0,
  };
  state.auditLog.push(
    `${actorId}对${transmission.intendedRecipientId}使用锁定`,
  );
  assertGameStateInvariants(state);
}

export function playSwap(
  state: GameState,
  actorId: PlayerId,
  cardId: PhysicalCardId,
): void {
  const transmission = state.transmission;
  const window = state.reactionWindow;
  if (
    state.phase !== "transmitting" ||
    !transmission ||
    !window ||
    (window.kind !== "intelligence" && window.kind !== "lock")
  ) {
    throw new Error("当前不能使用掉包");
  }
  if (window.responderOrder[window.nextResponderIndex] !== actorId) {
    throw new Error("尚未轮到该玩家响应");
  }
  if (transmission.pendingSwap) throw new Error("已有掉包正在等待响应");
  const actor = state.players[actorId];
  const cardIndex = actor?.hand.indexOf(cardId) ?? -1;
  if (!actor?.alive || cardIndex < 0 || cardById(cardId).name !== "掉包") {
    throw new Error("必须使用自己手中的掉包牌");
  }

  actor.hand.splice(cardIndex, 1);
  state.publicDiscard.push(cardId);
  pushCardActionFrame(state, {
    kind: "swap",
    sourcePlayerId: actorId,
    sourceCardId: cardId,
    targetPlayerId: transmission.intendedRecipientId,
    snapshot: captureInteractionSnapshot(transmission),
  });
  transmission.pendingSwap = { sourceCardId: cardId };
  transmission.receiptStage = "reactions";
  state.reactionWindow = {
    kind: "swap",
    affectedPlayerId: transmission.intendedRecipientId,
    responderOrder: reactionOrderAfterTarget(
      state,
      transmission.intendedRecipientId,
    ),
    nextResponderIndex: 0,
  };
  state.auditLog.push(`${actorId}使用掉包，等待响应`);
  assertGameStateInvariants(state);
}

function resolveSwap(state: GameState): void {
  const transmission = state.transmission;
  const pending = transmission?.pendingSwap;
  if (!transmission || !pending) throw new Error("当前没有待结算的掉包");
  const stagedIndex = state.publicDiscard.indexOf(pending.sourceCardId);
  if (stagedIndex < 0) throw new Error("待结算掉包不在公开暂存区");

  const replacedCardId = transmission.cardId;
  state.publicDiscard.splice(stagedIndex, 1);
  state.publicDiscard.push(replacedCardId);
  transmission.cardId = pending.sourceCardId;
  transmission.pendingSwap = undefined;
  transmission.faceUp = true;
  state.interactionStack = [];
  beginReceiptReactionStage(state);
  state.auditLog.push(
    `掉包结算：原情报${describeCardBrief(replacedCardId)}公开弃置；替换牌${describeCardBrief(pending.sourceCardId)}正面朝上`,
  );
  assertGameStateInvariants(state);
}

export function playLure(
  state: GameState,
  actorId: PlayerId,
  cardId: PhysicalCardId,
): void {
  const transmission = state.transmission;
  const window = state.reactionWindow;
  if (
    state.phase !== "transmitting" ||
    !transmission ||
    !window ||
    window.kind !== "intelligence" ||
    transmission.locked ||
    transmission.interceptorCommitted ||
    transmission.transferredRecipientCommitted ||
    transmission.intendedRecipientId === transmission.senderId
  ) {
    throw new Error("当前接收状态不能使用调虎离山");
  }
  if (window.responderOrder[window.nextResponderIndex] !== actorId) {
    throw new Error("尚未轮到该玩家响应");
  }
  if (actorId === transmission.intendedRecipientId) {
    throw new Error("不能对自己使用调虎离山");
  }
  const actor = state.players[actorId];
  const cardIndex = actor?.hand.indexOf(cardId) ?? -1;
  if (!actor?.alive || cardIndex < 0 || cardById(cardId).name !== "调虎离山") {
    throw new Error("必须使用自己手中的调虎离山");
  }

  actor.hand.splice(cardIndex, 1);
  state.publicDiscard.push(cardId);
  pushCardActionFrame(state, {
    kind: "lure",
    sourcePlayerId: actorId,
    sourceCardId: cardId,
    targetPlayerId: transmission.intendedRecipientId,
    snapshot: captureInteractionSnapshot(transmission),
  });
  transmission.pendingLure = {
    sourceCardId: cardId,
    targetId: transmission.intendedRecipientId,
  };
  state.reactionWindow = {
    kind: "lure",
    affectedPlayerId: transmission.intendedRecipientId,
    responderOrder: reactionOrderAfterTarget(
      state,
      transmission.intendedRecipientId,
    ),
    nextResponderIndex: 0,
  };
  state.auditLog.push(
    `${actorId}对${transmission.intendedRecipientId}使用调虎离山`,
  );
  assertGameStateInvariants(state);
}

function resolveLure(state: GameState): void {
  const transmission = state.transmission;
  const pending = transmission?.pendingLure;
  if (!transmission || !pending) throw new Error("当前没有待结算的调虎离山");
  const skippedId = pending.targetId;
  const nextRecipientId =
    transmission.method === "直达"
      ? transmission.senderId
      : nextLivingPlayer(
          state,
          skippedId,
          transmission.direction ?? "clockwise",
        );
  beginNormalReceiptCycle(
    state,
    nextRecipientId,
    nextRecipientId === transmission.senderId,
  );
  state.auditLog.push(
    `调虎离山结算：${skippedId}被迫拒绝，当前接收者：${nextRecipientId}`,
  );
  assertGameStateInvariants(state);
}

function countColor(player: PlayerState, color: "红" | "蓝" | "黑"): number {
  return player.intelligence.filter((id) => {
    const cardColor = cardById(id).color;
    return cardColor === color || (cardColor === "红蓝" && color !== "黑");
  }).length;
}

function countTrueIntelligenceOnField(state: GameState): number {
  return Object.values(state.players).reduce(
    (total, player) =>
      total + player.intelligence.filter((id) => cardById(id).color !== "黑").length,
    0,
  );
}

function resolveWinner(player: PlayerState): WinnerState | undefined {
  if (!player.alive) return undefined;
  if (player.faction === "军情" && countColor(player, "蓝") >= 3) {
    return { kind: "faction", faction: "军情" };
  }
  if (player.faction === "潜伏" && countColor(player, "红") >= 3) {
    return { kind: "faction", faction: "潜伏" };
  }
  if (player.faction === "特工" && player.intelligence.length >= 6) {
    return { kind: "agent", playerId: player.id };
  }
  return undefined;
}

function finishAcceptedIntelligence(
  state: GameState,
  receiver: PlayerState,
): void {
  state.pendingPublicTextReceipt = undefined;
  state.auditLog.push(`${state.activePlayerId}的回合结束`);

  const winner = resolveWinner(receiver);
  if (winner) {
    state.winner = winner;
    state.phase = "gameOver";
    state.auditLog.push("胜利条件达成，游戏立即结束");
  } else {
    advanceToNextTurn(state);
  }
  assertGameStateInvariants(state);
}

function beginPublicTextReceiptEffect(
  state: GameState,
  receiver: PlayerState,
  card: PhysicalCard,
): void {
  const finishDraw = (count: 1 | 2): void => {
    const drawn = drawCards(state, receiver.id, count);
    state.auditLog.push(`${receiver.id}因公开文本摸${drawn.length}张牌`);
    finishAcceptedIntelligence(state, receiver);
  };
  const beginDiscard = (): void => {
    if (receiver.hand.length === 0) {
      state.auditLog.push(`${receiver.id}因公开文本须弃牌，但其没有手牌`);
      finishAcceptedIntelligence(state, receiver);
      return;
    }
    if (receiver.hand.length === 1) {
      const [discarded] = receiver.hand.splice(0, 1);
      if (!discarded) throw new Error("公开文本自动弃牌失败");
      state.publicDiscard.push(discarded);
      state.auditLog.push(`${receiver.id}因公开文本自动弃置唯一的手牌`);
      finishAcceptedIntelligence(state, receiver);
      return;
    }
    state.pendingPublicTextReceipt = {
      recipientId: receiver.id,
      cardId: card.id as PhysicalCardId,
      stage: "discard",
      choices: ["discardOne"],
    };
    state.auditLog.push(`${receiver.id}须为公开文本选择一张手牌弃置`);
    assertGameStateInvariants(state);
  };

  if (card.color === "红" || card.color === "蓝") {
    const mandatoryDiscardFaction = card.color === "红" ? "潜伏" : "军情";
    if (receiver.faction === mandatoryDiscardFaction) {
      beginDiscard();
      return;
    }
    state.pendingPublicTextReceipt = {
      recipientId: receiver.id,
      cardId: card.id as PhysicalCardId,
      stage: "choice",
      choices:
        receiver.hand.length > 0
          ? ["drawOne", "discardOne"]
          : ["drawOne"],
    };
    state.auditLog.push(`${receiver.id}须选择公开文本的摸牌或弃牌效果`);
    assertGameStateInvariants(state);
    return;
  }

  if (
    card.variant?.kind !== "publicTextBlack" ||
    card.variant.mandatoryDrawFaction === undefined
  ) {
    throw new Error("黑色公开文本缺少阵营效果映射");
  }
  if (receiver.faction === card.variant.mandatoryDrawFaction) {
    finishDraw(1);
    return;
  }
  state.pendingPublicTextReceipt = {
    recipientId: receiver.id,
    cardId: card.id as PhysicalCardId,
    stage: "choice",
    choices: ["drawOne", "drawTwo"],
  };
  state.auditLog.push(`${receiver.id}须选择因公开文本摸一张或两张牌`);
  assertGameStateInvariants(state);
}

export function acceptIntelligence(state: GameState, actorId: PlayerId): void {
  const transmission = state.transmission;
  if (state.phase !== "transmitting" || !transmission) {
    throw new Error("当前没有待接收的情报");
  }
  if (transmission.intendedRecipientId !== actorId) {
    throw new Error("只有当前接收者可以接收情报");
  }
  if (transmission.receiptStage !== "decision") {
    throw new Error("尚未进入接收决定阶段");
  }
  const receiver = state.players[actorId];
  if (!receiver?.alive) throw new Error("死亡玩家不能接收情报");
  if (state.reactionWindow) throw new Error("情报响应窗口尚未结束");
  const acceptedCard = cardById(transmission.cardId);
  receiver.intelligence.push(transmission.cardId);
  state.transmission = undefined;
  state.phase = "resolvingReceipt";
  state.interactionStack = [];
  if (countColor(receiver, "黑") >= 3) {
    receiver.alive = false;
    receiver.factionRevealed = true;
    state.auditLog.push(
      `${actorId}接收情报${describeCardBrief(transmission.cardId)}后死亡，阵营公开为${receiver.faction}`,
    );
    if (finishFactionEliminationVictory(state, false)) return;
  } else {
    state.auditLog.push(`${actorId}接收情报：${describeCardBrief(transmission.cardId)}`);
  }

  if (receiver.alive && acceptedCard.name === "公开文本") {
    beginPublicTextReceiptEffect(state, receiver, acceptedCard);
    return;
  }
  finishAcceptedIntelligence(state, receiver);
}

export function choosePublicTextReceiptEffect(
  state: GameState,
  actorId: PlayerId,
  choice: PublicTextReceiptChoice,
): void {
  const pending = state.pendingPublicTextReceipt;
  if (
    state.phase !== "resolvingReceipt" ||
    !pending ||
    pending.stage !== "choice" ||
    pending.recipientId !== actorId
  ) {
    throw new Error("当前没有可由该玩家选择的公开文本接收效果");
  }
  if (!pending.choices.includes(choice)) {
    throw new Error("该公开文本接收效果选项不可用");
  }
  const receiver = state.players[actorId];
  if (!receiver?.alive) throw new Error("死亡玩家不能处理公开文本接收效果");

  if (choice === "discardOne") {
    if (receiver.hand.length === 0) {
      state.auditLog.push(`${actorId}选择为公开文本弃牌，但其没有手牌`);
      finishAcceptedIntelligence(state, receiver);
      return;
    }
    if (receiver.hand.length === 1) {
      const [discarded] = receiver.hand.splice(0, 1);
      if (!discarded) throw new Error("公开文本自动弃牌失败");
      state.publicDiscard.push(discarded);
      state.auditLog.push(`${actorId}因公开文本自动弃置唯一的手牌`);
      finishAcceptedIntelligence(state, receiver);
      return;
    }
    pending.stage = "discard";
    pending.choices = ["discardOne"];
    state.auditLog.push(`${actorId}选择为公开文本弃置一张手牌`);
    assertGameStateInvariants(state);
    return;
  }

  const requested = choice === "drawTwo" ? 2 : 1;
  const drawn = drawCards(state, actorId, requested);
  state.auditLog.push(`${actorId}因公开文本摸${drawn.length}张牌`);
  finishAcceptedIntelligence(state, receiver);
}

export function choosePublicTextReceiptDiscard(
  state: GameState,
  actorId: PlayerId,
  cardId: PhysicalCardId,
): void {
  const pending = state.pendingPublicTextReceipt;
  if (
    state.phase !== "resolvingReceipt" ||
    !pending ||
    pending.stage !== "discard" ||
    pending.recipientId !== actorId
  ) {
    throw new Error("当前没有可由该玩家选择的公开文本弃牌");
  }
  const receiver = state.players[actorId];
  if (!receiver?.alive) throw new Error("死亡玩家不能处理公开文本接收效果");
  const cardIndex = receiver.hand.indexOf(cardId);
  if (cardIndex < 0) throw new Error("只能弃置自己的手牌");

  receiver.hand.splice(cardIndex, 1);
  state.publicDiscard.push(cardId);
  state.auditLog.push(`${actorId}因公开文本弃置一张手牌`);
  finishAcceptedIntelligence(state, receiver);
}

export function declineIntelligence(state: GameState, actorId: PlayerId): void {
  const transmission = state.transmission;
  if (state.phase !== "transmitting" || !transmission) {
    throw new Error("当前没有待回应的情报");
  }
  if (transmission.intendedRecipientId !== actorId) {
    throw new Error("只有当前接收者可以拒绝情报");
  }
  if (transmission.receiptStage !== "decision") {
    throw new Error("尚未进入接收决定阶段");
  }
  if (!state.players[actorId]?.alive) throw new Error("死亡玩家不能回应情报");
  if (state.reactionWindow) throw new Error("情报响应窗口尚未结束");
  if (actorId === transmission.senderId && transmission.returnedToSender) {
    throw new Error("返回发送者的情报必须接收或转移，不能再次拒绝");
  }
  if (transmission.interceptorCommitted) {
    throw new Error("截获者必须接收情报，不能拒绝");
  }
  if (transmission.transferredRecipientCommitted) {
    throw new Error("转移后的接收者必须接收情报，不能拒绝");
  }
  if (transmission.locked) {
    throw new Error("锁定要求当前接收者接收情报");
  }

  const nextRecipientId =
    transmission.method === "直达"
      ? transmission.senderId
      : nextLivingPlayer(state, actorId, transmission.direction ?? "clockwise");
  beginNormalReceiptCycle(
    state,
    nextRecipientId,
    nextRecipientId === transmission.senderId,
  );
  state.auditLog.push(
    `${actorId}拒绝情报，当前接收者：${nextRecipientId}`,
  );
  assertGameStateInvariants(state);
}

export function playTransfer(
  state: GameState,
  actorId: PlayerId,
  cardId: PhysicalCardId,
  targetId: PlayerId,
): void {
  const transmission = state.transmission;
  if (state.phase !== "transmitting" || !transmission) {
    throw new Error("当前没有可转移的情报");
  }
  if (actorId !== transmission.intendedRecipientId || transmission.locked) {
    throw new Error("只有未被锁定情报的当前接收者可以使用转移");
  }
  if (transmission.interceptorCommitted) {
    throw new Error("截获者已承诺接收情报，不能使用转移");
  }
  if (
    state.reactionWindow?.kind !== "intelligence" ||
    state.reactionWindow.responderOrder[
      state.reactionWindow.nextResponderIndex
    ] !== actorId
  ) {
    throw new Error("必须在自己的情报响应优先级中使用转移");
  }
  if (transmission.pendingTransfer) throw new Error("已有转移正在等待响应");
  const actor = state.players[actorId];
  if (!actor?.alive) throw new Error("死亡玩家不能使用转移");
  const cardIndex = actor.hand.indexOf(cardId);
  if (cardIndex < 0 || cardById(cardId).name !== "转移") {
    throw new Error("必须使用自己手中的转移牌");
  }
  if (targetId === actorId || !state.players[targetId]?.alive) {
    throw new Error("转移必须选择另一名存活玩家");
  }

  actor.hand.splice(cardIndex, 1);
  state.publicDiscard.push(cardId);
  pushCardActionFrame(state, {
    kind: "transfer",
    sourcePlayerId: actorId,
    sourceCardId: cardId,
    targetPlayerId: targetId,
    snapshot: captureInteractionSnapshot(transmission),
  });
  transmission.pendingTransfer = { sourceCardId: cardId, targetId };
  state.reactionWindow = {
    kind: "transfer",
    affectedPlayerId: targetId,
    responderOrder: reactionOrderAfterTarget(state, targetId),
    nextResponderIndex: 0,
  };
  state.auditLog.push(`${actorId}使用转移，声明新的接收者：${targetId}`);
  assertGameStateInvariants(state);
}

function resolveTransfer(state: GameState): void {
  const transmission = state.transmission;
  const pending = transmission?.pendingTransfer;
  if (state.phase !== "transmitting" || !transmission || !pending) {
    throw new Error("当前没有待结算的转移");
  }
  const targetId = pending.targetId;
  beginNormalReceiptCycle(state, targetId, false, true);
  transmission.transferredRecipientCommitted = true;
  state.auditLog.push(`转移结算，当前接收者：${targetId}`);
  assertGameStateInvariants(state);
}

export function passReaction(state: GameState, actorId: PlayerId): void {
  const window = state.reactionWindow;
  if (!window) throw new Error("当前没有响应窗口");
  if (window.responderOrder[window.nextResponderIndex] !== actorId) {
    throw new Error("尚未轮到该玩家响应");
  }
  if (!state.players[actorId]?.alive) throw new Error("死亡玩家不能响应");

  window.nextResponderIndex += 1;
  if (window.nextResponderIndex === window.responderOrder.length) {
    finishPassedReactionWindow(state, window);
  } else {
    assertGameStateInvariants(state);
  }
}

function finishPassedReactionWindow(state: GameState, window: ReactionWindow): void {
    if (window.kind === "burn") {
      resolveBurnContext(state);
    } else if (window.kind === "secretOrder") {
      const pending = state.pendingSecretOrder;
      if (!pending) throw new Error("秘密下达窗口状态无效");
      pending.stage = "selection";
      state.reactionWindow = undefined;
      state.secretOrderStack = [];
      if (pending.sourceCardId && pending.countered) {
        state.auditLog.push("秘密下达被识破，颜色限制取消");
      }
      assertGameStateInvariants(state);
    } else if (window.kind === "function") {
      finishActiveFunctionAction(state);
    } else if (window.kind === "decrypt") {
      const transmission = state.transmission;
      if (!transmission) throw new Error("破译响应缺少待传情报");
      if (transmission.pendingDecrypt) {
        transmission.decryptedById = transmission.pendingDecrypt.playerId;
        transmission.pendingDecrypt = undefined;
        state.auditLog.push(`${transmission.decryptedById}完成破译`);
      }
      state.reactionWindow = undefined;
      state.interactionStack = [];
      transmission.receiptStage = "decision";
      assertGameStateInvariants(state);
    } else if (window.kind === "transfer") {
      if (state.transmission?.pendingTransfer) {
        resolveTransfer(state);
      } else {
        state.reactionWindow = undefined;
        state.interactionStack = [];
        if (state.transmission) state.transmission.receiptStage = "decision";
        assertGameStateInvariants(state);
      }
    } else if (window.kind === "swap") {
      if (state.transmission?.pendingSwap) {
        resolveSwap(state);
      } else {
        state.reactionWindow = undefined;
        state.interactionStack = [];
        beginReceiptReactionStage(state);
        assertGameStateInvariants(state);
      }
    } else if (window.kind === "lure") {
      if (state.transmission?.pendingLure) {
        resolveLure(state);
      } else {
        state.reactionWindow = undefined;
        state.interactionStack = [];
        if (state.transmission) state.transmission.receiptStage = "decision";
        assertGameStateInvariants(state);
      }
    } else if (window.kind === "lock") {
      state.reactionWindow = undefined;
      state.interactionStack = [];
      if (state.transmission?.interceptorCommitted) {
        state.transmission.receiptStage = "decision";
        acceptIntelligence(state, state.transmission.intendedRecipientId);
      } else {
        beginReceiptReactionStage(state);
        assertGameStateInvariants(state);
      }
    } else {
      state.reactionWindow = undefined;
      state.interactionStack = [];
      if (state.transmission) state.transmission.receiptStage = "decision";
      if (state.transmission?.interceptorCommitted) {
        acceptIntelligence(state, state.transmission.intendedRecipientId);
      } else {
        assertGameStateInvariants(state);
      }
    }
}

function isOpenBurnWindow(state: GameState, actorId: PlayerId): boolean {
  const currentResponder =
    state.reactionWindow?.responderOrder[state.reactionWindow.nextResponderIndex];
  if (state.reactionWindow) return currentResponder === actorId;
  return (
    state.phase === "initialized" &&
    state.activePlayerId === actorId &&
    !state.activeFunctionAction &&
    !state.pendingPublicTextReceipt &&
    !state.transmission
  );
}

/** Plays 烧毁 into the current open action/reaction window. */
export function playBurn(
  state: GameState,
  actorId: PlayerId,
  cardId: PhysicalCardId,
  targetPlayerId: PlayerId,
  targetIntelligenceCardId: PhysicalCardId,
): void {
  if (!isOpenBurnWindow(state, actorId)) {
    throw new Error("当前没有可使用烧毁的行动或响应窗口");
  }
  const actor = state.players[actorId];
  const cardIndex = actor?.hand.indexOf(cardId) ?? -1;
  if (!actor?.alive || cardIndex < 0 || cardById(cardId).name !== "烧毁") {
    throw new Error("必须使用自己手中的烧毁牌");
  }
  if (actorId === state.activePlayerId && actor.hand.length <= 1) {
    throw new Error("当前玩家必须至少保留一张手牌用于传递");
  }
  const target = state.players[targetPlayerId];
  if (!target?.alive) throw new Error("烧毁只能以存活玩家的情报为目标");
  if (!target.intelligence.includes(targetIntelligenceCardId)) {
    throw new Error("烧毁目标必须是该玩家已接收的情报");
  }
  const intelligence = cardById(targetIntelligenceCardId);
  if (intelligence.color !== "黑") {
    throw new Error("烧毁只能以黑色情报为目标");
  }
  if (intelligence.unburnable) throw new Error("该实体牌具有不可烧毁标记");

  actor.hand.splice(cardIndex, 1);
  state.publicDiscard.push(cardId);
  const sequence = state.nextInteractionSequence++;
  const frame: BurnFrame = {
    id: `interaction-${sequence}`,
    sequence,
    kind: "burn",
    sourcePlayerId: actorId,
    sourceCardId: cardId,
    targetPlayerId,
    snapshot: { countered: true },
  };
  state.burnContexts.push({
    sourcePlayerId: actorId,
    sourceCardId: cardId,
    targetPlayerId,
    targetIntelligenceCardId,
    countered: false,
    suspendedReactionWindow: cloneReactionWindow(state.reactionWindow),
    suspendedReactionCompleted: false,
    frames: [frame],
  });
  state.reactionWindow = {
    kind: "burn",
    affectedPlayerId: targetPlayerId,
    responderOrder: reactionOrderAfterTarget(state, targetPlayerId),
    nextResponderIndex: 0,
  };
  state.auditLog.push(`${actorId}使用烧毁，目标为${targetPlayerId}的情报`);
  assertGameStateInvariants(state);
}

function resolveBurnContext(state: GameState): void {
  const context = state.burnContexts.pop();
  if (!context) throw new Error("烧毁响应窗口缺少待结算行动");
  if (!context.countered && state.players[context.targetPlayerId]?.alive) {
    const target = state.players[context.targetPlayerId];
    const index = target?.intelligence.indexOf(context.targetIntelligenceCardId) ?? -1;
    // A nested burn may already have removed the same accepted intelligence.
    if (index >= 0) {
      target!.intelligence.splice(index, 1);
      state.publicDiscard.push(context.targetIntelligenceCardId);
      state.auditLog.push(`${context.targetPlayerId}的一张黑色情报被烧毁`);
    } else {
      state.auditLog.push("烧毁结算时目标情报已离场");
    }
  } else if (context.countered) {
    state.auditLog.push("烧毁被识破，目标情报保持不变");
  } else {
    state.auditLog.push("烧毁结算前目标玩家已经死亡，烧毁不再生效");
  }
  state.reactionWindow = cloneReactionWindow(context.suspendedReactionWindow);
  if (context.suspendedReactionCompleted && state.reactionWindow) {
    finishPassedReactionWindow(state, state.reactionWindow);
  } else {
    assertGameStateInvariants(state);
  }
}

function playCounterOnBurn(
  state: GameState,
  actorId: PlayerId,
  cardId: PhysicalCardId,
  targetInteractionId: string,
): void {
  const context = state.burnContexts.at(-1);
  const window = state.reactionWindow;
  const target = context?.frames.at(-1);
  if (!context || !window || window.kind !== "burn" || !target) {
    throw new Error("当前没有可被识破的烧毁行动");
  }
  if (window.responderOrder[window.nextResponderIndex] !== actorId) {
    throw new Error("尚未轮到该玩家响应");
  }
  if (target.id !== targetInteractionId) {
    throw new Error("识破必须指向烧毁互动栈顶的卡牌行动");
  }
  const actor = state.players[actorId];
  const cardIndex = actor?.hand.indexOf(cardId) ?? -1;
  if (!actor?.alive || cardIndex < 0 || cardById(cardId).name !== "识破") {
    throw new Error("必须使用自己手中的识破牌");
  }
  if (actorId === state.activePlayerId && actor.hand.length <= 1) {
    throw new Error("当前玩家必须至少保留一张手牌用于传递");
  }
  if (target.sourcePlayerId === actorId) throw new Error("不能识破自己的卡牌行动");

  const before = { countered: context.countered };
  actor.hand.splice(cardIndex, 1);
  state.publicDiscard.push(cardId);
  context.countered = target.snapshot.countered;
  const sequence = state.nextInteractionSequence++;
  context.frames.push({
    id: `interaction-${sequence}`,
    sequence,
    kind: "counter",
    sourcePlayerId: actorId,
    sourceCardId: cardId,
    targetPlayerId: target.sourcePlayerId,
    targetInteractionId: target.id,
    snapshot: before,
  });
  state.reactionWindow = {
    kind: "burn",
    affectedPlayerId: target.sourcePlayerId,
    responderOrder: reactionOrderAfterTarget(state, target.sourcePlayerId),
    nextResponderIndex: 0,
  };
  state.auditLog.push(
    `${actorId}使用识破，反制${target.sourcePlayerId}的${cardById(target.sourceCardId).name}`,
  );
  assertGameStateInvariants(state);
}

export function playDecrypt(
  state: GameState,
  actorId: PlayerId,
  cardId: PhysicalCardId,
): void {
  const transmission = state.transmission;
  const window = state.reactionWindow;
  if (
    state.phase !== "transmitting" ||
    !transmission ||
    !window ||
    window.kind !== "intelligence" ||
    window.responderOrder[window.nextResponderIndex] !== actorId ||
    transmission.intendedRecipientId !== actorId ||
    transmission.locked ||
    transmission.interceptorCommitted ||
    transmission.method === "文本"
  ) throw new Error("当前接收者没有可用的破译机会");
  const actor = state.players[actorId];
  const index = actor?.hand.indexOf(cardId) ?? -1;
  if (!actor?.alive || index < 0 || cardById(cardId).name !== "破译") {
    throw new Error("必须使用自己手中的破译牌");
  }
  actor.hand.splice(index, 1);
  state.publicDiscard.push(cardId);
  pushCardActionFrame(state, {
    kind: "decrypt",
    sourcePlayerId: actorId,
    sourceCardId: cardId,
    targetPlayerId: actorId,
    snapshot: captureInteractionSnapshot(transmission),
  });
  transmission.pendingDecrypt = { sourceCardId: cardId, playerId: actorId };
  state.reactionWindow = {
    kind: "decrypt",
    affectedPlayerId: actorId,
    responderOrder: reactionOrderAfterTarget(state, actorId),
    nextResponderIndex: 0,
  };
  state.auditLog.push(`${actorId}使用破译，等待响应`);
  assertGameStateInvariants(state);
}

export function playIntercept(
  state: GameState,
  actorId: PlayerId,
  cardId: PhysicalCardId,
): void {
  const transmission = state.transmission;
  const window = state.reactionWindow;
  if (
    state.phase !== "transmitting" ||
    !transmission ||
    !window ||
    (window.kind !== "intelligence" && window.kind !== "lock")
  ) {
    throw new Error("当前没有可截获的待传情报");
  }
  if (window.responderOrder[window.nextResponderIndex] !== actorId) {
    throw new Error("尚未轮到该玩家响应");
  }
  if (actorId === state.activePlayerId) {
    throw new Error("当前行动玩家不能在自己的回合使用截获");
  }
  if (actorId === transmission.intendedRecipientId) {
    throw new Error("当前接收者不能截获给自己的情报");
  }
  const actor = state.players[actorId];
  if (!actor?.alive) throw new Error("死亡玩家不能使用截获");
  const cardIndex = actor.hand.indexOf(cardId);
  if (cardIndex < 0 || cardById(cardId).name !== "截获") {
    throw new Error("必须使用自己手中的截获牌");
  }
  actor.hand.splice(cardIndex, 1);
  state.publicDiscard.push(cardId);
  pushCardActionFrame(state, {
    kind: "intercept",
    sourcePlayerId: actorId,
    sourceCardId: cardId,
    targetPlayerId: actorId,
    snapshot: captureInteractionSnapshot(transmission),
  });
  transmission.intendedRecipientId = actorId;
  transmission.returnedToSender = false;
  transmission.interceptorCommitted = true;
  transmission.transferredRecipientCommitted = false;
  transmission.receiptStage = "reactions";
  transmission.locked = false;
  openIntelligenceReactionWindow(state, actorId);
  state.auditLog.push(`${actorId}使用截获，成为当前接收者`);
  assertGameStateInvariants(state);
}

export function playCounter(
  state: GameState,
  actorId: PlayerId,
  cardId: PhysicalCardId,
  targetInteractionId: string,
): void {
  if (state.reactionWindow?.kind === "burn") {
    playCounterOnBurn(state, actorId, cardId, targetInteractionId);
    return;
  }
  if (state.reactionWindow?.kind === "secretOrder") {
    playCounterOnSecretOrder(state, actorId, cardId, targetInteractionId);
    return;
  }
  if (state.reactionWindow?.kind === "function") {
    playCounterOnFunction(state, actorId, cardId, targetInteractionId);
    return;
  }
  const transmission = state.transmission;
  const window = state.reactionWindow;
  const target = state.interactionStack.at(-1);
  if (
    state.phase !== "transmitting" ||
    !transmission ||
    !window ||
    !target
  ) {
    throw new Error("当前没有可被识破的卡牌行动");
  }
  if (window.responderOrder[window.nextResponderIndex] !== actorId) {
    throw new Error("尚未轮到该玩家响应");
  }
  if (target.id !== targetInteractionId) {
    throw new Error("识破必须指向互动栈顶的卡牌行动");
  }
  const actor = state.players[actorId];
  if (!actor?.alive) throw new Error("死亡玩家不能使用识破");
  const cardIndex = actor.hand.indexOf(cardId);
  if (cardIndex < 0 || cardById(cardId).name !== "识破") {
    throw new Error("必须使用自己手中的识破牌");
  }
  if (target.sourcePlayerId === actorId) {
    throw new Error("不能使用识破反制自己的卡牌行动");
  }

  const beforeCounter = captureInteractionSnapshot(transmission);
  actor.hand.splice(cardIndex, 1);
  state.publicDiscard.push(cardId);
  restoreInteractionSnapshot(transmission, target.snapshot);
  pushCardActionFrame(state, {
    kind: "counter",
    sourcePlayerId: actorId,
    sourceCardId: cardId,
    targetPlayerId: target.sourcePlayerId,
    targetInteractionId: target.id,
    snapshot: beforeCounter,
  });
  state.reactionWindow = {
    kind: window.kind,
    affectedPlayerId: target.sourcePlayerId,
    responderOrder: reactionOrderAfterTarget(state, target.sourcePlayerId),
    nextResponderIndex: 0,
  };
  state.auditLog.push(
    `${actorId}使用识破，反制${target.sourcePlayerId}的${cardById(target.sourceCardId).name}`,
  );
  assertGameStateInvariants(state);
}

function playCounterOnSecretOrder(
  state: GameState,
  actorId: PlayerId,
  cardId: PhysicalCardId,
  targetInteractionId: string,
): void {
  const pending = state.pendingSecretOrder;
  const window = state.reactionWindow;
  const target = state.secretOrderStack.at(-1);
  if (
    state.phase !== "preTransmission" ||
    !pending ||
    pending.stage !== "reactions" ||
    !window ||
    !target ||
    window.responderOrder[window.nextResponderIndex] !== actorId ||
    target.id !== targetInteractionId
  ) throw new Error("当前没有可被识破的秘密下达行动");
  const actor = state.players[actorId];
  const index = actor?.hand.indexOf(cardId) ?? -1;
  if (!actor?.alive || index < 0 || cardById(cardId).name !== "识破") {
    throw new Error("必须使用自己手中的识破牌");
  }
  if (target.sourcePlayerId === actorId) throw new Error("不能识破自己的卡牌行动");
  if (actorId === state.activePlayerId && actor.hand.length <= 1) {
    throw new Error("当前玩家必须至少保留一张手牌用于传递");
  }
  const before = { countered: pending.countered };
  actor.hand.splice(index, 1);
  state.publicDiscard.push(cardId);
  pending.countered = target.snapshot.countered;
  const sequence = state.nextInteractionSequence++;
  state.secretOrderStack.push({
    id: `interaction-${sequence}`,
    sequence,
    kind: "counter",
    sourcePlayerId: actorId,
    sourceCardId: cardId,
    targetPlayerId: target.sourcePlayerId,
    targetInteractionId: target.id,
    snapshot: before,
  });
  state.reactionWindow = {
    kind: "secretOrder",
    affectedPlayerId: target.sourcePlayerId,
    responderOrder: reactionOrderAfterTarget(state, target.sourcePlayerId),
    nextResponderIndex: 0,
  };
  state.auditLog.push(
    `${actorId}使用识破，反制${target.sourcePlayerId}的${cardById(target.sourceCardId).name}`,
  );
  assertGameStateInvariants(state);
}

function playCounterOnFunction(
  state: GameState,
  actorId: PlayerId,
  cardId: PhysicalCardId,
  targetInteractionId: string,
): void {
  const action = state.activeFunctionAction;
  const window = state.reactionWindow;
  const target = state.activeFunctionStack.at(-1);
  if (!action || !window || window.kind !== "function" || !target) {
    throw new Error("当前没有可被识破的功能牌行动");
  }
  if (window.responderOrder[window.nextResponderIndex] !== actorId) {
    throw new Error("尚未轮到该玩家响应");
  }
  if (target.id !== targetInteractionId) {
    throw new Error("识破必须指向互动栈顶的卡牌行动");
  }
  const actor = state.players[actorId];
  const cardIndex = actor?.hand.indexOf(cardId) ?? -1;
  if (!actor?.alive || cardIndex < 0 || cardById(cardId).name !== "识破") {
    throw new Error("必须使用自己手中的识破牌");
  }
  if (actorId === state.activePlayerId && actor.hand.length <= 1) {
    throw new Error("当前玩家必须至少保留一张手牌用于传递");
  }
  if (target.sourcePlayerId === actorId) {
    throw new Error("不能使用识破反制自己的卡牌行动");
  }

  const beforeCounter: ActiveFunctionSnapshot = {
    targetPlayerId: action.targetPlayerId,
    countered: action.countered,
  };
  actor.hand.splice(cardIndex, 1);
  state.publicDiscard.push(cardId);
  action.targetPlayerId = target.snapshot.targetPlayerId;
  action.countered = target.snapshot.countered;
  const sequence = state.nextInteractionSequence;
  state.nextInteractionSequence += 1;
  state.activeFunctionStack.push({
    id: `interaction-${sequence}`,
    sequence,
    kind: "counter",
    sourcePlayerId: actorId,
    sourceCardId: cardId,
    targetPlayerId: target.sourcePlayerId,
    targetInteractionId: target.id,
    snapshot: beforeCounter,
  });
  state.reactionWindow = {
    kind: "function",
    affectedPlayerId: target.sourcePlayerId,
    responderOrder: reactionOrderAfterTarget(state, target.sourcePlayerId),
    nextResponderIndex: 0,
  };
  state.auditLog.push(
    `${actorId}使用识破，反制${target.sourcePlayerId}的${cardById(target.sourceCardId).name}`,
  );
  assertGameStateInvariants(state);
}

export const playCounterIntercept = playCounter;

export function playSeparationOnTransfer(
  state: GameState,
  actorId: PlayerId,
  cardId: PhysicalCardId,
  targetId: PlayerId,
): void {
  const window = state.reactionWindow;
  const transmission = state.transmission;
  const pending = transmission?.pendingTransfer;
  const transferFrame = [...state.interactionStack]
    .reverse()
    .find((frame) => frame.kind === "transfer");
  if (
    !window ||
    !transmission ||
    !pending ||
    !transferFrame ||
    window.kind !== "transfer"
  ) {
    throw new Error("当前没有可被离间改换目标的转移");
  }
  if (window.responderOrder[window.nextResponderIndex] !== actorId) {
    throw new Error("尚未轮到该玩家响应");
  }
  const actor = state.players[actorId];
  if (!actor?.alive) throw new Error("死亡玩家不能使用离间");
  const cardIndex = actor.hand.indexOf(cardId);
  if (cardIndex < 0 || cardById(cardId).name !== "离间") {
    throw new Error("必须使用自己手中的离间牌");
  }
  if (transferFrame.separationUsed) {
    throw new Error("同一个原始卡牌行动最多只能使用一次离间");
  }
  if (
    targetId === pending.targetId ||
    targetId === transferFrame.targetPlayerId ||
    !state.players[targetId]?.alive
  ) {
    throw new Error("离间必须为转移选择另一个合法存活目标");
  }

  actor.hand.splice(cardIndex, 1);
  state.publicDiscard.push(cardId);
  transferFrame.separationUsed = true;
  pushCardActionFrame(state, {
    kind: "separation",
    sourcePlayerId: actorId,
    sourceCardId: cardId,
    targetPlayerId: targetId,
    snapshot: captureInteractionSnapshot(transmission),
  });
  pending.targetId = targetId;
  state.reactionWindow = {
    kind: "transfer",
    affectedPlayerId: targetId,
    responderOrder: reactionOrderAfterTarget(state, targetId),
    nextResponderIndex: 0,
  };
  state.auditLog.push(`${actorId}使用离间，将转移目标改为：${targetId}`);
  assertGameStateInvariants(state);
}

export function projectGameForPlayer(
  state: GameState,
  viewerId: PlayerId,
): PlayerProjection {
  assertGameStateInvariants(state);
  const viewer = state.players[viewerId];
  if (!viewer) throw new Error("玩家不在本局游戏中");

  const transmission = state.transmission;
  const canSeePendingCard =
    transmission &&
    (transmission.faceUp ||
      transmission.senderId === viewerId ||
      transmission.decryptedById === viewerId);
  const isCurrentRecipient = transmission?.intendedRecipientId === viewerId;
  const isReturnedForViewer =
    transmission?.returnedToSender === true &&
    transmission.senderId === viewerId;
  const canAccept = Boolean(transmission);
  const mustDiscardForHandLimit =
    state.phase === "discardingForTransmission" &&
    state.activePlayerId === viewerId &&
    viewer.hand.length > 7;
  const isLockOfferForViewer =
    transmission?.receiptStage === "lockOffer" &&
    transmission.senderId === viewerId &&
    state.activePlayerId === viewerId;
  const lockActions = isLockOfferForViewer
    ? viewer.hand
        .filter((cardId) => cardById(cardId).name === "锁定")
        .map((cardId) => ({ type: "PLAY_LOCK" as const, cardId }))
    : [];
  const currentReactionResponderId =
    state.reactionWindow?.responderOrder[state.reactionWindow.nextResponderIndex];
  const transferActions =
    transmission &&
    !transmission.pendingTransfer &&
    transmission.intendedRecipientId === viewerId &&
    !transmission.locked &&
    !transmission.interceptorCommitted &&
    state.reactionWindow?.kind === "intelligence" &&
    currentReactionResponderId === viewerId
      ? viewer.hand
          .filter((cardId) => cardById(cardId).name === "转移")
          .flatMap((cardId) =>
            state.seatOrder
              .filter((targetId) => targetId !== viewerId && state.players[targetId].alive)
              .map((targetId) => ({
                type: "PLAY_TRANSFER" as const,
                cardId,
                targetId,
              })),
          )
      : [];
  const activeFunctionAction = state.activeFunctionAction;
  const responseFrames = state.reactionWindow?.kind === "burn"
    ? state.burnContexts.at(-1)?.frames ?? []
    : state.reactionWindow?.kind === "function"
      ? state.activeFunctionStack
      : state.reactionWindow?.kind === "secretOrder"
        ? state.secretOrderStack
        : state.interactionStack;
  const responseStack: PlayerProjection["responseStack"] = responseFrames.map(
    (frame) => ({
      id: frame.id,
      kind: frame.kind === "counter" ? "counter" : "card",
      sourcePlayerId: frame.sourcePlayerId,
      targetPlayerId: frame.targetPlayerId,
      cardName: cardById(frame.sourceCardId).name,
      targetInteractionId: frame.targetInteractionId,
    }),
  );
  if (state.reactionWindow && responseStack.length === 0) {
    responseStack.push(
      state.reactionWindow.kind === "secretOrder"
        ? {
            id: "secret-order-window",
            kind: "secretOrderWindow",
            targetPlayerId: state.activePlayerId,
          }
        : {
            id: `intelligence-${transmission?.receiptCycle ?? 0}`,
            kind: "intelligence",
            sourcePlayerId: transmission?.senderId,
            targetPlayerId:
              transmission?.intendedRecipientId ?? state.reactionWindow.affectedPlayerId,
          },
    );
  }
  const canViewerBurn =
    viewer.alive &&
    ((currentReactionResponderId === viewerId && Boolean(state.reactionWindow)) ||
      (state.phase === "initialized" &&
        state.activePlayerId === viewerId &&
        !state.reactionWindow &&
        !activeFunctionAction)) &&
    !(viewerId === state.activePlayerId && viewer.hand.length <= 1);
  const burnActions: PlayerProjection["legalActions"] = canViewerBurn
    ? viewer.hand
        .filter((cardId) => cardById(cardId).name === "烧毁")
        .flatMap((cardId) =>
          state.seatOrder.flatMap((targetPlayerId) => {
            const target = state.players[targetPlayerId];
            return !target.alive
              ? []
              : target.intelligence.flatMap((targetIntelligenceCardId) => {
                  const intelligence = cardById(targetIntelligenceCardId);
                  return intelligence.color === "黑" && !intelligence.unburnable
                    ? [{
                        type: "PLAY_BURN" as const,
                        cardId,
                        targetPlayerId,
                        targetIntelligenceCardId,
                      }]
                    : [];
                });
          }),
        )
    : [];
  const separationActions =
    currentReactionResponderId === viewerId &&
    state.reactionWindow?.kind === "transfer" &&
    transmission?.pendingTransfer
      ? viewer.hand
          .filter((cardId) => cardById(cardId).name === "离间")
          .flatMap((cardId) =>
            state.seatOrder
              .filter(
                (targetId) =>
                  state.players[targetId].alive &&
                  targetId !== transmission.senderId &&
                  targetId !== transmission.pendingTransfer?.targetId,
              )
              .map((targetId) => ({
                type: "PLAY_SEPARATION" as const,
                cardId,
                targetId,
              })),
          )
      : [];
  const interceptActions =
    currentReactionResponderId === viewerId &&
    (state.reactionWindow?.kind === "intelligence" ||
      state.reactionWindow?.kind === "lock") &&
    viewerId !== state.activePlayerId &&
    viewerId !== transmission?.intendedRecipientId &&
    transmission
      ? viewer.hand
          .filter((cardId) => cardById(cardId).name === "截获")
          .map((cardId) => ({ type: "PLAY_INTERCEPT" as const, cardId }))
      : [];
  const swapActions =
    currentReactionResponderId === viewerId &&
    (state.reactionWindow?.kind === "intelligence" ||
      state.reactionWindow?.kind === "lock") &&
    transmission
      ? viewer.hand
          .filter((cardId) => cardById(cardId).name === "掉包")
          .map((cardId) => ({ type: "PLAY_SWAP" as const, cardId }))
      : [];
  const lureActions =
    currentReactionResponderId === viewerId &&
    state.reactionWindow?.kind === "intelligence" &&
    transmission &&
    viewerId !== transmission.intendedRecipientId &&
    transmission.intendedRecipientId !== transmission.senderId &&
    !transmission.locked &&
    !transmission.interceptorCommitted &&
    !transmission.transferredRecipientCommitted
      ? viewer.hand
          .filter((cardId) => cardById(cardId).name === "调虎离山")
          .map((cardId) => ({ type: "PLAY_LURE" as const, cardId }))
      : [];
  const decryptActions =
    currentReactionResponderId === viewerId &&
    state.reactionWindow?.kind === "intelligence" &&
    transmission?.intendedRecipientId === viewerId &&
    transmission.method !== "文本" &&
    !transmission.locked &&
    !transmission.interceptorCommitted
      ? viewer.hand
          .filter((cardId) => cardById(cardId).name === "破译")
          .map((cardId) => ({ type: "PLAY_DECRYPT" as const, cardId }))
      : [];
  const recipientMustAccept =
    transmission?.interceptorCommitted === true ||
    transmission?.transferredRecipientCommitted === true;
  const topInteraction =
    state.reactionWindow?.kind === "burn"
      ? state.burnContexts.at(-1)?.frames.at(-1)
      : state.reactionWindow?.kind === "function"
      ? state.activeFunctionStack.at(-1)
      : state.reactionWindow?.kind === "secretOrder"
        ? state.secretOrderStack.at(-1)
      : state.interactionStack.at(-1);
  const counterActions =
    currentReactionResponderId === viewerId &&
    topInteraction &&
    topInteraction.sourcePlayerId !== viewerId
      ? viewer.hand
          .filter((cardId) => cardById(cardId).name === "识破")
          .map((cardId) => ({
            type: "PLAY_COUNTER" as const,
            cardId,
            targetInteractionId: topInteraction.id,
          }))
      : [];
  const functionSeparationActions =
    currentReactionResponderId === viewerId &&
    state.reactionWindow?.kind === "function" &&
    activeFunctionAction &&
    !activeFunctionAction.separationUsed &&
    (activeFunctionAction.kind === "publicText" ||
      activeFunctionAction.kind === "dangerousIntelligence")
      ? viewer.hand
          .filter((cardId) => cardById(cardId).name === "离间")
          .flatMap((cardId) =>
            state.seatOrder
              .filter(
                (targetId) =>
                  state.players[targetId].alive &&
                  state.players[targetId].hand.length > 0 &&
                  targetId !== activeFunctionAction.sourcePlayerId &&
                  targetId !== activeFunctionAction.originalTargetPlayerId &&
                  targetId !== activeFunctionAction.targetPlayerId,
              )
              .map((targetId) => ({
                type: "PLAY_FUNCTION_SEPARATION" as const,
                cardId,
                targetId,
              })),
          )
      : [];
  const activeFunctionActions: PlayerProjection["legalActions"] = [];
  const secretOrderActions: PlayerProjection["legalActions"] =
    currentReactionResponderId === viewerId &&
    state.reactionWindow?.kind === "secretOrder" &&
    state.pendingSecretOrder?.stage === "offering" &&
    viewerId !== state.activePlayerId
      ? viewer.hand.flatMap((cardId) => {
          const card = cardById(cardId);
          return card.variant?.kind === "secretOrder"
            ? (["听风", "看雨", "日落"] as const).map((word) => ({
                type: "PLAY_SECRET_ORDER" as const,
                cardId,
                word,
              }))
            : [];
        })
      : [];
  if (
    state.phase === "initialized" &&
    state.activePlayerId === viewerId &&
    !activeFunctionAction &&
    viewer.hand.length > 1
  ) {
    for (const cardId of viewer.hand) {
      const name = cardById(cardId).name;
      if (name === "增援") {
        activeFunctionActions.push({ type: "PLAY_REINFORCEMENT", cardId });
      } else if (name === "机密文件" && countTrueIntelligenceOnField(state) >= 4) {
        activeFunctionActions.push({ type: "PLAY_CONFIDENTIAL_FILE", cardId });
      } else if (name === "公开文本" || name === "危险情报") {
        for (const targetId of state.seatOrder) {
          if (
            targetId === viewerId ||
            !state.players[targetId].alive ||
            state.players[targetId].hand.length === 0
          ) {
            continue;
          }
          activeFunctionActions.push(
            name === "公开文本"
              ? { type: "PLAY_PUBLIC_TEXT", cardId, targetId }
              : { type: "PLAY_DANGEROUS_INTELLIGENCE", cardId, targetId },
          );
        }
      } else if (name === "试探") {
        for (const targetId of state.seatOrder) {
          if (targetId !== viewerId && state.players[targetId].alive) {
            activeFunctionActions.push({ type: "PLAY_PROBE", cardId, targetId });
          }
        }
      }
    }
  }

  return {
    mode: state.mode,
    phase: state.phase,
    activePlayerId: state.activePlayerId,
    seatOrder: [...state.seatOrder],
    drawPileCount: state.drawPile.length,
    publicDiscard: state.publicDiscard.map(projectedCardById),
    players: state.seatOrder.map((id) => {
      const player = state.players[id];
      return {
        id,
        alive: player.alive,
        ...(player.factionRevealed || state.phase === "gameOver"
          ? { faction: player.faction }
          : {}),
        handCount: player.hand.length,
        ...(state.phase === "gameOver"
          ? { hand: player.hand.map(projectedCardById) }
          : {}),
        intelligence: player.intelligence.map(projectedCardById),
      };
    }),
    own: {
      id: viewer.id,
      faction: viewer.faction,
      hand: viewer.hand.map(projectedCardById),
    },
    auditLog: [...state.auditLog],
    privateNotices: state.privateNotices[viewerId].map((notice) => ({
      kind: notice.kind,
      otherPlayerId: notice.otherPlayerId,
      card: projectedCardById(notice.cardId),
    })),
    transmission: transmission
      ? {
          senderId: transmission.senderId,
          method: transmission.method,
          direction: transmission.direction,
          intendedRecipientId: transmission.intendedRecipientId,
          returnedToSender: transmission.returnedToSender,
          transferredRecipientCommitted: transmission.transferredRecipientCommitted,
          receiptStage: transmission.receiptStage,
          locked: transmission.locked,
          faceUp: transmission.faceUp,
          decrypted: transmission.decryptedById === viewerId,
          card: canSeePendingCard
            ? projectedCardById(transmission.cardId)
            : undefined,
          pendingTransfer: transmission.pendingTransfer
            ? {
                sourceCard: projectedCardById(
                  transmission.pendingTransfer.sourceCardId,
                ),
                targetId: transmission.pendingTransfer.targetId,
              }
            : undefined,
        }
      : undefined,
    winner: state.winner ? { ...state.winner } : undefined,
    reactionWindow: state.reactionWindow
      ? {
          kind: state.reactionWindow.kind,
          currentResponderId:
            state.reactionWindow.responderOrder[
              state.reactionWindow.nextResponderIndex
            ],
        }
      : undefined,
    responseStack,
    activeFunctionAction: activeFunctionAction
      ? {
          kind: activeFunctionAction.kind,
          sourcePlayerId: activeFunctionAction.sourcePlayerId,
          targetPlayerId: activeFunctionAction.targetPlayerId,
          stage: activeFunctionAction.stage,
          inspectedHand:
            activeFunctionAction.kind === "dangerousIntelligence" &&
            activeFunctionAction.stage === "awaitingDiscard" &&
            activeFunctionAction.sourcePlayerId === viewerId
              ? state.players[activeFunctionAction.targetPlayerId].hand.map(
                  projectedCardById,
                )
              : undefined,
        }
      : undefined,
    pendingPublicTextReceipt: state.pendingPublicTextReceipt
      ? {
          recipientId: state.pendingPublicTextReceipt.recipientId,
          stage: state.pendingPublicTextReceipt.stage,
          choices: [...state.pendingPublicTextReceipt.choices],
        }
      : undefined,
    pendingSecretOrder: state.pendingSecretOrder
      ? {
          stage: state.pendingSecretOrder.stage,
          targetPlayerId: state.pendingSecretOrder.targetPlayerId,
          sourcePlayerId: state.pendingSecretOrder.sourcePlayerId,
          word: state.pendingSecretOrder.word,
          requiredColor:
            !state.pendingSecretOrder.countered &&
            (state.pendingSecretOrder.sourcePlayerId === viewerId ||
              state.pendingSecretOrder.targetPlayerId === viewerId)
              ? state.pendingSecretOrder.requiredColor
              : undefined,
          verifiedNoMatch: state.pendingSecretOrder.verifiedNoMatch,
          inspectedHand:
            state.pendingSecretOrder.verifiedNoMatch &&
            state.pendingSecretOrder.sourcePlayerId === viewerId
              ? state.players[state.activePlayerId].hand.map(projectedCardById)
              : undefined,
        }
      : undefined,
    legalActions: mustDiscardForHandLimit
      ? viewer.hand.map((cardId) => ({
          type: "DISCARD_FOR_HAND_LIMIT" as const,
          cardId,
        }))
      : isLockOfferForViewer
        ? [{ type: "PASS_LOCK" }, ...lockActions]
      : currentReactionResponderId === viewerId
        ? [
            { type: "PASS_REACTION" },
            ...separationActions,
            ...interceptActions,
            ...swapActions,
            ...lureActions,
            ...decryptActions,
            ...burnActions,
            ...counterActions,
            ...functionSeparationActions,
            ...transferActions,
            ...secretOrderActions,
          ]
      : activeFunctionAction?.kind === "dangerousIntelligence" &&
          activeFunctionAction.stage === "awaitingDiscard" &&
          activeFunctionAction.sourcePlayerId === viewerId
        ? state.players[activeFunctionAction.targetPlayerId].hand.map((cardId) => ({
            type: "CHOOSE_DANGEROUS_DISCARD" as const,
            cardId,
          }))
      : activeFunctionAction?.kind === "probeIdentity" &&
          activeFunctionAction.stage === "awaitingProbeChoice" &&
          activeFunctionAction.targetPlayerId === viewerId
        ? [
            { type: "CHOOSE_PROBE_IDENTITY" as const, choice: "announce" as const },
            ...(viewer.hand.length > 0
              ? [{ type: "CHOOSE_PROBE_IDENTITY" as const, choice: "giveRandom" as const }]
              : []),
          ]
      : activeFunctionAction?.kind === "probeDrawDiscard" &&
          activeFunctionAction.stage === "awaitingProbeDiscard" &&
          activeFunctionAction.targetPlayerId === viewerId
        ? viewer.hand.map((cardId) => ({
            type: "CHOOSE_PROBE_DISCARD" as const,
            cardId,
          }))
      : state.pendingPublicTextReceipt?.recipientId === viewerId
        ? state.pendingPublicTextReceipt.stage === "choice"
          ? state.pendingPublicTextReceipt.choices.map((choice) => ({
              type: "CHOOSE_PUBLIC_TEXT_EFFECT" as const,
              choice,
            }))
          : viewer.hand.map((cardId) => ({
              type: "CHOOSE_PUBLIC_TEXT_DISCARD" as const,
              cardId,
            }))
      : isCurrentRecipient &&
          transmission?.receiptStage === "decision" &&
          !transmission.pendingTransfer
        ? [
            ...(canAccept ? [{ type: "ACCEPT_INTELLIGENCE" } as const] : []),
            ...(!isReturnedForViewer &&
            !recipientMustAccept &&
            !transmission.locked
              ? [{ type: "DECLINE_INTELLIGENCE" as const }]
              : []),
          ]
      : state.phase === "preTransmission" &&
          state.pendingSecretOrder?.stage === "offering" &&
          currentReactionResponderId === viewerId
        ? [
            { type: "PASS_REACTION" as const },
            ...(viewerId === state.activePlayerId
              ? []
              : viewer.hand.flatMap((cardId) => {
                  const card = cardById(cardId);
                  return card.variant?.kind === "secretOrder"
                    ? (["听风", "看雨", "日落"] as const).map((word) => ({
                        type: "PLAY_SECRET_ORDER" as const,
                        cardId,
                        word,
                      }))
                    : [];
                })),
          ]
      : state.phase === "preTransmission" &&
          state.pendingSecretOrder?.stage === "selection" &&
          viewerId === state.activePlayerId &&
          state.pendingSecretOrder.sourceCardId &&
          !state.pendingSecretOrder.countered &&
          !state.pendingSecretOrder.verifiedNoMatch &&
          state.pendingSecretOrder.requiredColor &&
          !viewer.hand.some((id) =>
            cardMatchesSecretOrder(cardById(id), state.pendingSecretOrder!.requiredColor!),
          )
        ? [{ type: "CLAIM_NO_SECRET_ORDER_MATCH" }]
      : state.phase === "initialized" &&
          viewerId === state.activePlayerId &&
          !activeFunctionAction
        ? [...activeFunctionActions, ...burnActions, { type: "ENTER_TRANSMISSION_PHASE" }]
        : activeFunctionActions,
  };
}

export function projectGameForSpectator(state: GameState): SpectatorProjection {
  const base = projectGameForPlayer(state, state.seatOrder[0]);
  const {
    own: _own,
    legalActions: _legalActions,
    privateNotices: _privateNotices,
    ...publicView
  } = base;
  return {
    ...publicView,
    spectator: true,
    players: base.players.map(({ hand: _hand, ...player }) => ({ ...player })),
    transmission: base.transmission
      ? {
          ...base.transmission,
          card: base.transmission.faceUp ? base.transmission.card : undefined,
          decrypted: false,
        }
      : undefined,
    activeFunctionAction: base.activeFunctionAction
      ? { ...base.activeFunctionAction, inspectedHand: undefined }
      : undefined,
    pendingSecretOrder: base.pendingSecretOrder
      ? {
          ...base.pendingSecretOrder,
          requiredColor: undefined,
          inspectedHand: undefined,
        }
      : undefined,
  };
}
