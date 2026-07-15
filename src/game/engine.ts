import {
  PHYSICAL_DECK,
  type Faction,
  type PhysicalCard,
  type PhysicalCardId,
  type TransmissionMethod,
} from "./cards";

export type PlayerId = string;
export type GameMode = "duel" | "standard";
export type Direction = "clockwise" | "counterclockwise";
export type FixedTransmissionMethod = Exclude<TransmissionMethod, "任意">;
type ManifestCard = (typeof PHYSICAL_DECK)[number];

export interface TransmissionState {
  cardId: PhysicalCardId;
  senderId: PlayerId;
  method: FixedTransmissionMethod;
  direction?: Direction;
  intendedRecipientId: PlayerId;
}

export type WinnerState =
  | { kind: "faction"; faction: "军情" | "潜伏" }
  | { kind: "agent"; playerId: PlayerId };

export interface PlayerState {
  id: PlayerId;
  faction: Faction;
  alive: boolean;
  hand: PhysicalCardId[];
  intelligence: PhysicalCardId[];
}

export interface GameState {
  mode: GameMode;
  phase:
    | "initialized"
    | "transmitting"
    | "awaitingTurnEnd"
    | "victoryPending";
  activePlayerId: PlayerId;
  seatOrder: PlayerId[];
  players: Record<PlayerId, PlayerState>;
  drawPile: PhysicalCardId[];
  publicDiscard: PhysicalCardId[];
  hiddenSecretOrders: PhysicalCardId[];
  removedProbes: PhysicalCardId[];
  transmission?: TransmissionState;
  winner?: WinnerState;
  auditLog: string[];
}

export interface PublicPlayerProjection {
  id: PlayerId;
  alive: boolean;
  handCount: number;
  intelligence: PhysicalCard[];
}

export interface PlayerProjection {
  mode: GameMode;
  phase: GameState["phase"];
  activePlayerId: PlayerId;
  seatOrder: PlayerId[];
  drawPileCount: number;
  players: PublicPlayerProjection[];
  own: {
    id: PlayerId;
    faction: Faction;
    hand: PhysicalCard[];
  };
  auditLog: string[];
  transmission?: {
    senderId: PlayerId;
    method: FixedTransmissionMethod;
    direction?: Direction;
    intendedRecipientId: PlayerId;
    card?: PhysicalCard;
  };
  winner?: WinnerState;
  legalActions: Array<
    | { type: "ACCEPT_INTELLIGENCE" }
    | { type: "DECLINE_INTELLIGENCE" }
  >;
}

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

  const state: GameState = {
    mode: playerIds.length === 2 ? "duel" : "standard",
    phase: "initialized",
    activePlayerId: playerIds[0],
    seatOrder: [...playerIds],
    players,
    drawPile,
    publicDiscard: [],
    hiddenSecretOrders: [],
    removedProbes: [],
    auditLog: [
      `游戏初始化完成：${playerIds.length}名玩家`,
      "每名玩家获得2张起始手牌",
    ],
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
  if ((state.phase === "victoryPending") !== Boolean(state.winner)) {
    throw new Error("待确认胜利阶段与胜者状态不一致");
  }
  if (state.transmission) {
    const transmission = state.transmission;
    if (
      !state.players[transmission.senderId]?.alive ||
      !state.players[transmission.intendedRecipientId]?.alive
    ) {
      throw new Error("传递中的发送者和接收者必须存活且存在");
    }
    const card = cardById(transmission.cardId);
    if (card.transmission !== "任意" && card.transmission !== transmission.method) {
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

export interface StartTransmissionOptions {
  method?: FixedTransmissionMethod;
  direction?: Direction;
  targetId?: PlayerId;
}

export function startTransmission(
  state: GameState,
  actorId: PlayerId,
  cardId: PhysicalCardId,
  options: StartTransmissionOptions = {},
): void {
  if (state.phase !== "initialized") throw new Error("当前不能开始传递情报");
  if (actorId !== state.activePlayerId) throw new Error("只有当前玩家可以传递情报");
  const actor = state.players[actorId];
  if (!actor?.alive) throw new Error("死亡玩家不能传递情报");
  if (!actor.hand.includes(cardId)) throw new Error("该牌不在当前玩家手中");
  const card = cardById(cardId);

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
      if (!options.direction) throw new Error("带圈情报必须选择传递方向");
      direction = options.direction;
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
  };
  state.phase = "transmitting";
  state.auditLog.push(
    `${actorId}开始以${method}传递情报，当前接收者：${intendedRecipientId}`,
  );
  assertGameStateInvariants(state);
}

function countColor(player: PlayerState, color: "红" | "蓝" | "黑"): number {
  return player.intelligence.filter((id) => {
    const cardColor = cardById(id).color;
    return cardColor === color || (cardColor === "红蓝" && color !== "黑");
  }).length;
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

function acceptanceRequiresUnimplementedEffect(
  state: GameState,
  transmission: TransmissionState,
): boolean {
  const receiver = state.players[transmission.intendedRecipientId];
  const card = cardById(transmission.cardId);
  const dies = card.color === "黑" && countColor(receiver, "黑") === 2;
  return card.name === "公开文本" && !dies;
}

export function acceptIntelligence(state: GameState, actorId: PlayerId): void {
  const transmission = state.transmission;
  if (state.phase !== "transmitting" || !transmission) {
    throw new Error("当前没有待接收的情报");
  }
  if (transmission.intendedRecipientId !== actorId) {
    throw new Error("只有当前接收者可以接收情报");
  }
  const receiver = state.players[actorId];
  if (acceptanceRequiresUnimplementedEffect(state, transmission)) {
    throw new Error("公开文本的接收效果尚未实现");
  }

  receiver.intelligence.push(transmission.cardId);
  state.transmission = undefined;
  if (countColor(receiver, "黑") >= 3) {
    receiver.alive = false;
    state.auditLog.push(`${actorId}接收情报后死亡`);
  } else {
    state.auditLog.push(`${actorId}接收情报`);
  }

  const winner = resolveWinner(receiver);
  if (winner) {
    state.winner = winner;
    state.phase = "victoryPending";
    state.auditLog.push("检测到胜利条件，等待确认结束规则");
  } else {
    state.phase = "awaitingTurnEnd";
  }
  assertGameStateInvariants(state);
}

export function declineIntelligence(state: GameState, actorId: PlayerId): void {
  const transmission = state.transmission;
  if (state.phase !== "transmitting" || !transmission) {
    throw new Error("当前没有待回应的情报");
  }
  if (transmission.intendedRecipientId !== actorId) {
    throw new Error("只有当前接收者可以拒绝情报");
  }
  if (
    actorId === transmission.senderId &&
    transmission.method === "直达"
  ) {
    throw new Error("情报返回发送者后的处理规则尚未确认");
  }

  transmission.intendedRecipientId =
    transmission.method === "直达"
      ? transmission.senderId
      : nextLivingPlayer(state, actorId, transmission.direction ?? "clockwise");
  state.auditLog.push(
    `${actorId}拒绝情报，当前接收者：${transmission.intendedRecipientId}`,
  );
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
    (transmission.method === "文本" || transmission.senderId === viewerId);
  const isCurrentRecipient = transmission?.intendedRecipientId === viewerId;
  const awaitsUnresolvedDirectReturn =
    transmission?.method === "直达" && transmission.senderId === viewerId;
  const canAccept =
    transmission && !acceptanceRequiresUnimplementedEffect(state, transmission);

  return {
    mode: state.mode,
    phase: state.phase,
    activePlayerId: state.activePlayerId,
    seatOrder: [...state.seatOrder],
    drawPileCount: state.drawPile.length,
    players: state.seatOrder.map((id) => {
      const player = state.players[id];
      return {
        id,
        alive: player.alive,
        handCount: player.hand.length,
        intelligence: player.intelligence.map(projectedCardById),
      };
    }),
    own: {
      id: viewer.id,
      faction: viewer.faction,
      hand: viewer.hand.map(projectedCardById),
    },
    auditLog: [...state.auditLog],
    transmission: transmission
      ? {
          senderId: transmission.senderId,
          method: transmission.method,
          direction: transmission.direction,
          intendedRecipientId: transmission.intendedRecipientId,
          card: canSeePendingCard
            ? projectedCardById(transmission.cardId)
            : undefined,
        }
      : undefined,
    winner: state.winner ? { ...state.winner } : undefined,
    legalActions:
      isCurrentRecipient && !awaitsUnresolvedDirectReturn
        ? [
            ...(canAccept ? [{ type: "ACCEPT_INTELLIGENCE" } as const] : []),
            { type: "DECLINE_INTELLIGENCE" as const },
          ]
        : [],
  };
}
