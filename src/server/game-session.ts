import {
  acceptIntelligence,
  chooseDangerousIntelligenceDiscard,
  chooseProbeDiscard,
  chooseProbeIdentityResponse,
  choosePublicTextReceiptDiscard,
  choosePublicTextReceiptEffect,
  declineIntelligence,
  discardForHandLimit,
  enterTransmissionPhase,
  initializeGame,
  passLockOpportunity,
  passReaction,
  playConfidentialFile,
  playBurn,
  playCounter,
  playDangerousIntelligence,
  playDecrypt,
  playIntercept,
  playLock,
  playLure,
  playPublicText,
  playProbe,
  playReinforcement,
  playSeparationOnFunction,
  playSeparationOnTransfer,
  playSecretOrder,
  playSwap,
  playTransfer,
  projectGameForPlayer,
  resolveHostImposedDeath,
  startTransmission,
  claimNoSecretOrderMatch,
  type Direction,
  type FixedTransmissionMethod,
  type GameState,
  type PlayerProjection,
  type PublicTextReceiptChoice,
} from "../game/engine";
import type { PhysicalCardId, SecretOrderWord } from "../game/cards";

export type GameCommand =
  | { type: "DISCARD_FOR_HAND_LIMIT"; cardId: PhysicalCardId }
  | {
      type: "START_TRANSMISSION";
      cardId: PhysicalCardId;
      method?: FixedTransmissionMethod;
      direction?: Direction;
      targetId?: string;
    }
  | { type: "PLAY_REINFORCEMENT"; cardId: PhysicalCardId }
  | { type: "PLAY_CONFIDENTIAL_FILE"; cardId: PhysicalCardId }
  | {
      type: "PLAY_BURN";
      cardId: PhysicalCardId;
      targetPlayerId: string;
      targetIntelligenceCardId: PhysicalCardId;
    }
  | { type: "PLAY_PUBLIC_TEXT"; cardId: PhysicalCardId; targetId: string }
  | {
      type: "PLAY_DANGEROUS_INTELLIGENCE";
      cardId: PhysicalCardId;
      targetId: string;
    }
  | { type: "PLAY_PROBE"; cardId: PhysicalCardId; targetId: string }
  | { type: "PLAY_FUNCTION_SEPARATION"; cardId: PhysicalCardId; targetId: string }
  | { type: "CHOOSE_DANGEROUS_DISCARD"; cardId: PhysicalCardId }
  | { type: "CHOOSE_PROBE_IDENTITY"; choice: "announce" | "giveRandom" }
  | { type: "CHOOSE_PROBE_DISCARD"; cardId: PhysicalCardId }
  | { type: "ENTER_TRANSMISSION_PHASE" }
  | { type: "PLAY_SECRET_ORDER"; cardId: PhysicalCardId; word: SecretOrderWord }
  | { type: "CLAIM_NO_SECRET_ORDER_MATCH" }
  | { type: "PASS_LOCK" }
  | { type: "PLAY_LOCK"; cardId: PhysicalCardId }
  | { type: "PLAY_SWAP"; cardId: PhysicalCardId }
  | { type: "PLAY_LURE"; cardId: PhysicalCardId }
  | { type: "PLAY_DECRYPT"; cardId: PhysicalCardId }
  | { type: "ACCEPT_INTELLIGENCE" }
  | { type: "DECLINE_INTELLIGENCE" }
  | { type: "PLAY_TRANSFER"; cardId: PhysicalCardId; targetId: string }
  | { type: "PASS_REACTION" }
  | { type: "PLAY_INTERCEPT"; cardId: PhysicalCardId }
  | {
      type: "PLAY_COUNTER";
      cardId: PhysicalCardId;
      targetInteractionId: string;
    }
  | { type: "PLAY_SEPARATION"; cardId: PhysicalCardId; targetId: string }
  | { type: "CHOOSE_PUBLIC_TEXT_EFFECT"; choice: PublicTextReceiptChoice }
  | { type: "CHOOSE_PUBLIC_TEXT_DISCARD"; cardId: PhysicalCardId };

export class GameSessionService {
  private readonly sessions = new Map<string, GameState>();

  create(roomCode: string, seatOrder: readonly string[], seed: number): GameState {
    if (this.sessions.has(roomCode)) throw new Error("房间游戏已经存在");
    const state = initializeGame(seatOrder, seed);
    this.sessions.set(roomCode, state);
    return state;
  }

  has(roomCode: string): boolean {
    return this.sessions.has(roomCode);
  }

  delete(roomCode: string): boolean {
    return this.sessions.delete(roomCode);
  }

  getState(roomCode: string): GameState {
    const state = this.sessions.get(roomCode);
    if (!state) throw new GameSessionError("GAME_NOT_FOUND", "房间游戏尚未开始");
    return state;
  }

  project(roomCode: string, playerId: string): PlayerProjection {
    return projectGameForPlayer(this.getState(roomCode), playerId);
  }

  resolveHostImposedDeath(roomCode: string, playerId: string): PlayerProjection {
    const state = this.getState(roomCode);
    if (!state.players[playerId]) {
      throw new GameSessionError("NOT_A_GAME_PLAYER", "目标玩家不属于这局游戏");
    }
    resolveHostImposedDeath(state, playerId);
    return projectGameForPlayer(state, playerId);
  }

  dispatch(roomCode: string, actorId: string, command: GameCommand): PlayerProjection {
    if (!command || typeof command !== "object" || typeof command.type !== "string") {
      throw new GameSessionError("INVALID_GAME_COMMAND", "游戏指令格式无效");
    }
    const state = this.getState(roomCode);
    if (!state.players[actorId]) {
      throw new GameSessionError("NOT_A_GAME_PLAYER", "当前玩家不属于这局游戏");
    }
    dispatchGameCommand(state, actorId, command);
    return projectGameForPlayer(state, actorId);
  }
}

export class GameSessionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function dispatchGameCommand(
  state: GameState,
  actorId: string,
  command: GameCommand,
): void {
  switch (command.type) {
    case "DISCARD_FOR_HAND_LIMIT":
      return discardForHandLimit(state, actorId, command.cardId);
    case "START_TRANSMISSION":
      return startTransmission(state, actorId, command.cardId, {
        method: command.method,
        direction: command.direction,
        targetId: command.targetId,
      });
    case "PLAY_REINFORCEMENT":
      return playReinforcement(state, actorId, command.cardId);
    case "PLAY_CONFIDENTIAL_FILE":
      return playConfidentialFile(state, actorId, command.cardId);
    case "PLAY_BURN":
      return playBurn(
        state,
        actorId,
        command.cardId,
        command.targetPlayerId,
        command.targetIntelligenceCardId,
      );
    case "PLAY_PUBLIC_TEXT":
      return playPublicText(state, actorId, command.cardId, command.targetId);
    case "PLAY_DANGEROUS_INTELLIGENCE":
      return playDangerousIntelligence(state, actorId, command.cardId, command.targetId);
    case "PLAY_PROBE":
      return playProbe(state, actorId, command.cardId, command.targetId);
    case "PLAY_FUNCTION_SEPARATION":
      return playSeparationOnFunction(state, actorId, command.cardId, command.targetId);
    case "CHOOSE_DANGEROUS_DISCARD":
      return chooseDangerousIntelligenceDiscard(state, actorId, command.cardId);
    case "CHOOSE_PROBE_IDENTITY":
      return chooseProbeIdentityResponse(state, actorId, command.choice);
    case "CHOOSE_PROBE_DISCARD":
      return chooseProbeDiscard(state, actorId, command.cardId);
    case "ENTER_TRANSMISSION_PHASE":
      return enterTransmissionPhase(state, actorId);
    case "PLAY_SECRET_ORDER":
      return playSecretOrder(state, actorId, command.cardId, command.word);
    case "CLAIM_NO_SECRET_ORDER_MATCH":
      return claimNoSecretOrderMatch(state, actorId);
    case "PASS_LOCK":
      return passLockOpportunity(state, actorId);
    case "PLAY_LOCK":
      return playLock(state, actorId, command.cardId);
    case "PLAY_SWAP":
      return playSwap(state, actorId, command.cardId);
    case "PLAY_LURE":
      return playLure(state, actorId, command.cardId);
    case "PLAY_DECRYPT":
      return playDecrypt(state, actorId, command.cardId);
    case "ACCEPT_INTELLIGENCE":
      return acceptIntelligence(state, actorId);
    case "DECLINE_INTELLIGENCE":
      return declineIntelligence(state, actorId);
    case "PLAY_TRANSFER":
      return playTransfer(state, actorId, command.cardId, command.targetId);
    case "PASS_REACTION":
      return passReaction(state, actorId);
    case "PLAY_INTERCEPT":
      return playIntercept(state, actorId, command.cardId);
    case "PLAY_COUNTER":
      return playCounter(state, actorId, command.cardId, command.targetInteractionId);
    case "PLAY_SEPARATION":
      return playSeparationOnTransfer(state, actorId, command.cardId, command.targetId);
    case "CHOOSE_PUBLIC_TEXT_EFFECT":
      return choosePublicTextReceiptEffect(state, actorId, command.choice);
    case "CHOOSE_PUBLIC_TEXT_DISCARD":
      return choosePublicTextReceiptDiscard(state, actorId, command.cardId);
    default: {
      const exhaustive: never = command;
      throw new GameSessionError("INVALID_GAME_COMMAND", `不支持的游戏指令：${String((exhaustive as GameCommand).type)}`);
    }
  }
}
