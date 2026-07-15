import {
  PHYSICAL_DECK,
  type Faction,
  type PhysicalCard,
  type PhysicalCardId,
} from "./cards";

export type PlayerId = string;
export type GameMode = "duel" | "standard";
type ManifestCard = (typeof PHYSICAL_DECK)[number];

export interface PlayerState {
  id: PlayerId;
  faction: Faction;
  alive: boolean;
  hand: PhysicalCardId[];
  intelligence: PhysicalCardId[];
}

export interface GameState {
  mode: GameMode;
  phase: "initialized";
  activePlayerId: PlayerId;
  seatOrder: PlayerId[];
  players: Record<PlayerId, PlayerState>;
  drawPile: PhysicalCardId[];
  publicDiscard: PhysicalCardId[];
  hiddenSecretOrders: PhysicalCardId[];
  removedProbes: PhysicalCardId[];
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
  legalActions: readonly [];
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

  const expectedDeck = buildDeckForPlayerCount(state.seatOrder.length);
  const expectedIds = new Set(expectedDeck.map((card) => card.id));
  const locatedIds = [
    ...state.drawPile,
    ...state.publicDiscard,
    ...state.hiddenSecretOrders,
    ...state.removedProbes,
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
}

function cardById(id: PhysicalCardId): PhysicalCard {
  const card = CARD_BY_ID.get(id);
  if (!card) throw new Error(`未知实体牌：${id}`);
  return card;
}

export function projectGameForPlayer(
  state: GameState,
  viewerId: PlayerId,
): PlayerProjection {
  assertGameStateInvariants(state);
  const viewer = state.players[viewerId];
  if (!viewer) throw new Error("玩家不在本局游戏中");

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
        intelligence: player.intelligence.map(cardById),
      };
    }),
    own: {
      id: viewer.id,
      faction: viewer.faction,
      hand: viewer.hand.map(cardById),
    },
    auditLog: [...state.auditLog],
    legalActions: [],
  };
}
