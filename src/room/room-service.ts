import { RoomError } from "./errors";
import {
  REACTION_TIMEOUT_OPTIONS,
  SUPPORTED_ROOM_CAPACITIES,
  type PlayerCredentials,
  type NormalDeathResolver,
  type ReactionTimeoutSeconds,
  type RoomCapacity,
  type RoomEntryResult,
  type RoomIdGenerator,
  type RoomPlayerSnapshot,
  type RoomRandom,
  type RoomSnapshot,
  type RoomSpectatorSnapshot,
  type SeatSwapRequestSnapshot,
  type StartRoomResult,
  type StartSeatMode,
} from "./types";

const ROOM_CODE_LENGTH = 6;
const ROOM_CODE_PATTERN = /^[A-Z]{6}$/;
const MAX_CODE_ATTEMPTS = 1_000;

interface RoomPlayer extends RoomPlayerSnapshot {
  reconnectToken?: string;
  joinedSequence: number;
}

interface SeatSwapRequest extends SeatSwapRequestSnapshot {}

interface RoomSpectator extends RoomSpectatorSnapshot {
  reconnectToken: string;
}

interface RoomRecord {
  code: string;
  capacity: RoomCapacity;
  phase: "lobby" | "started";
  hostPlayerId: string | null;
  players: Map<string, RoomPlayer>;
  spectators: Map<string, RoomSpectator>;
  pendingSeatSwaps: Map<string, SeatSwapRequest>;
  reactionTimeoutSeconds: ReactionTimeoutSeconds;
  publicAuditLog: string[];
  nextJoinedSequence: number;
}

export interface RoomServiceOptions {
  random?: RoomRandom;
  playerIdGenerator?: RoomIdGenerator;
  reconnectTokenGenerator?: RoomIdGenerator;
  swapRequestIdGenerator?: RoomIdGenerator;
  roomCodeGenerator?: RoomIdGenerator;
  botIdGenerator?: RoomIdGenerator;
}

/**
 * In-memory room authority. Its snapshots intentionally never contain reconnect
 * tokens. One instance should be owned by the server process.
 */
export class RoomService {
  private readonly rooms = new Map<string, RoomRecord>();
  private readonly random: RoomRandom;
  private readonly playerIdGenerator: RoomIdGenerator;
  private readonly reconnectTokenGenerator: RoomIdGenerator;
  private readonly swapRequestIdGenerator: RoomIdGenerator;
  private readonly roomCodeGenerator: RoomIdGenerator;
  private readonly botIdGenerator: RoomIdGenerator;

  constructor(options: RoomServiceOptions = {}) {
    this.random = options.random ?? Math.random;
    this.playerIdGenerator = options.playerIdGenerator ?? defaultOpaqueId;
    this.reconnectTokenGenerator =
      options.reconnectTokenGenerator ?? defaultReconnectToken;
    this.swapRequestIdGenerator = options.swapRequestIdGenerator ?? defaultOpaqueId;
    this.roomCodeGenerator =
      options.roomCodeGenerator ?? (() => generateRoomCode(this.random));
    this.botIdGenerator = options.botIdGenerator ?? (() => `bot-${defaultOpaqueId()}`);
  }

  createRoom(
    capacity: number,
    displayName: string,
    requestedCode?: string,
  ): RoomEntryResult {
    if (!isRoomCapacity(capacity)) {
      throw new RoomError("INVALID_CAPACITY", "不支持该房间人数");
    }

    const name = normalizeDisplayName(displayName);
    const code = requestedCode === undefined
      ? this.generateUniqueCode()
      : this.reserveRequestedCode(requestedCode);
    const credentials = this.createCredentials();
    const creator: RoomPlayer = {
      id: credentials.playerId,
      reconnectToken: credentials.reconnectToken,
      displayName: name,
      seatIndex: 0,
      isHost: true,
      isBot: false,
      botControlled: false,
      connected: true,
      alive: true,
      joinedSequence: 0,
    };
    const room: RoomRecord = {
      code,
      capacity,
      phase: "lobby",
      hostPlayerId: creator.id,
      players: new Map([[creator.id, creator]]),
      spectators: new Map(),
      pendingSeatSwaps: new Map(),
      reactionTimeoutSeconds: 15,
      publicAuditLog: [`${creator.displayName} 创建了房间`],
      nextJoinedSequence: 1,
    };
    this.rooms.set(code, room);

    return { ...credentials, room: this.snapshot(room) };
  }

  joinRoom(roomCode: string, displayName: string): RoomEntryResult {
    const room = this.requireRoom(roomCode);
    this.requireLobby(room);
    if (room.players.size >= room.capacity) {
      throw new RoomError("ROOM_FULL", "房间已满");
    }

    const name = normalizeDisplayName(displayName);
    if (identityNameTaken(room, name)) {
      throw new RoomError("DUPLICATE_DISPLAY_NAME", "房间内已有同名玩家");
    }

    const credentials = this.createCredentials();
    const player: RoomPlayer = {
      id: credentials.playerId,
      reconnectToken: credentials.reconnectToken,
      displayName: name,
      seatIndex: firstEmptySeat(room),
      isHost: false,
      isBot: false,
      botControlled: false,
      connected: true,
      alive: true,
      joinedSequence: room.nextJoinedSequence++,
    };
    room.players.set(player.id, player);
    room.publicAuditLog.push(`${player.displayName} 加入了房间`);
    return { ...credentials, room: this.snapshot(room) };
  }

  spectateRoom(roomCode: string, displayName: string): RoomEntryResult {
    const room = this.requireRoom(roomCode);
    const name = normalizeDisplayName(displayName);
    if (identityNameTaken(room, name)) {
      throw new RoomError("DUPLICATE_DISPLAY_NAME", "房间内已有同名玩家或旁观者");
    }
    const credentials = this.createCredentials();
    const spectator: RoomSpectator = {
      id: credentials.playerId,
      reconnectToken: credentials.reconnectToken,
      displayName: name,
      connected: true,
    };
    room.spectators.set(spectator.id, spectator);
    room.publicAuditLog.push(`${name} 开始旁观`);
    return { ...credentials, isSpectator: true, room: this.snapshot(room) };
  }

  reconnect(roomCode: string, reconnectToken: string): RoomEntryResult {
    const room = this.requireRoom(roomCode);
    const spectator = [...room.spectators.values()].find(
      (candidate) => candidate.reconnectToken === reconnectToken,
    );
    if (spectator) {
      spectator.connected = true;
      return {
        playerId: spectator.id,
        reconnectToken: spectator.reconnectToken,
        isSpectator: true,
        room: this.snapshot(room),
      };
    }
    const player = [...room.players.values()].find(
      (candidate) => candidate.reconnectToken === reconnectToken,
    );
    if (!player) {
      throw new RoomError("INVALID_RECONNECT_TOKEN", "重连凭证无效");
    }
    const wasConnected = player.connected;
    player.connected = true;
    player.botControlled = false;
    if (!wasConnected) room.publicAuditLog.push(`${player.displayName} 已重新连接`);
    if (
      room.phase === "started" &&
      room.hostPlayerId === null &&
      player.alive
    ) {
      // Room mutations are serialized; the first eligible reconnect processed
      // after succession became pending deterministically becomes host.
      transferInGameHost(room, player);
    }
    return {
      playerId: player.id,
      reconnectToken: player.reconnectToken!,
      room: this.snapshot(room),
    };
  }

  disconnect(roomCode: string, playerId: string): RoomSnapshot {
    const room = this.requireRoom(roomCode);
    const spectator = room.spectators.get(playerId);
    if (spectator) {
      spectator.connected = false;
      return this.snapshot(room);
    }
    const player = requirePlayer(room, playerId);
    player.connected = false;
    room.publicAuditLog.push(`${player.displayName} 已断开连接`);
    ensureInGameHost(room);
    return this.snapshot(room);
  }

  leaveSpectator(roomCode: string, spectatorId: string): RoomSnapshot {
    const room = this.requireRoom(roomCode);
    if (!room.spectators.delete(spectatorId)) {
      throw new RoomError("PLAYER_NOT_FOUND", "旁观者不存在");
    }
    return this.snapshot(room);
  }

  leaveLobby(roomCode: string, playerId: string): RoomSnapshot | undefined {
    const room = this.requireRoom(roomCode);
    this.requireLobby(room);
    this.removePlayerRecord(room, requirePlayer(room, playerId));
    if (![...room.players.values()].some((player) => !player.isBot)) {
      this.rooms.delete(room.code);
      return undefined;
    }
    return this.snapshot(room);
  }

  removeLobbyPlayer(
    roomCode: string,
    hostPlayerId: string,
    targetPlayerId: string,
  ): RoomSnapshot | undefined {
    const room = this.requireRoom(roomCode);
    this.requireLobby(room);
    this.requireHost(room, hostPlayerId);
    const target = requirePlayer(room, targetPlayerId);
    this.removePlayerRecord(room, target);
    if (![...room.players.values()].some((player) => !player.isBot)) {
      this.rooms.delete(room.code);
      return undefined;
    }
    return this.snapshot(room);
  }

  addBot(
    roomCode: string,
    hostPlayerId: string,
    seatIndex: number,
  ): RoomSnapshot {
    const room = this.requireRoom(roomCode);
    this.requireLobby(room);
    this.requireHost(room, hostPlayerId);
    if (room.players.size >= room.capacity) {
      throw new RoomError("ROOM_FULL", "房间已满");
    }
    requireSeat(room, seatIndex);
    if (playerAtSeat(room, seatIndex)) {
      throw new RoomError("INVALID_SEAT", "该座位已被占用");
    }

    const bot: RoomPlayer = {
      id: this.botIdGenerator(),
      displayName: nextBotName(room),
      seatIndex,
      isHost: false,
      isBot: true,
      botControlled: true,
      connected: true,
      alive: true,
      joinedSequence: room.nextJoinedSequence++,
    };
    room.players.set(bot.id, bot);
    room.publicAuditLog.push(`${bot.displayName} 加入了房间`);
    return this.snapshot(room);
  }

  fillEmptySeatsWithBots(
    roomCode: string,
    hostPlayerId: string,
  ): RoomSnapshot {
    const room = this.requireRoom(roomCode);
    this.requireLobby(room);
    this.requireHost(room, hostPlayerId);

    for (let seatIndex = 0; seatIndex < room.capacity; seatIndex += 1) {
      if (playerAtSeat(room, seatIndex)) continue;
      const bot: RoomPlayer = {
        id: this.botIdGenerator(),
        displayName: nextBotName(room),
        seatIndex,
        isHost: false,
        isBot: true,
        botControlled: true,
        connected: true,
        alive: true,
        joinedSequence: room.nextJoinedSequence++,
      };
      room.players.set(bot.id, bot);
      room.publicAuditLog.push(`${bot.displayName} 加入了房间`);
    }
    return this.snapshot(room);
  }

  removeBot(
    roomCode: string,
    hostPlayerId: string,
    botPlayerId: string,
  ): RoomSnapshot {
    const room = this.requireRoom(roomCode);
    this.requireLobby(room);
    this.requireHost(room, hostPlayerId);
    const bot = requirePlayer(room, botPlayerId);
    if (!bot.isBot) {
      throw new RoomError("PLAYER_NOT_BOT", "只能用此操作移除机器人");
    }
    this.removePlayerRecord(room, bot);
    return this.snapshot(room);
  }

  setBotTakeover(
    roomCode: string,
    hostPlayerId: string,
    targetPlayerId: string,
    enabled: boolean,
  ): RoomSnapshot {
    const room = this.requireRoom(roomCode);
    if (room.phase !== "started") {
      throw new RoomError("ROOM_NOT_STARTED", "游戏尚未开始");
    }
    this.requireHost(room, hostPlayerId);
    const host = requirePlayer(room, hostPlayerId);
    if (!host.alive) {
      throw new RoomError("DEAD_PLAYER_CANNOT_ACT", "死亡房主不能指定 AI 接管");
    }
    const target = requirePlayer(room, targetPlayerId);
    if (target.isBot) {
      throw new RoomError("PLAYER_NOT_DISCONNECTED", "固定 AI 座位无需接管");
    }
    if (target.connected) {
      throw new RoomError("PLAYER_NOT_DISCONNECTED", "只能接管已断线玩家");
    }
    if (!target.alive) {
      throw new RoomError("PLAYER_ALREADY_DEAD", "死亡玩家不能由 AI 接管");
    }
    target.botControlled = enabled;
    room.publicAuditLog.push(
      enabled
        ? `房主指定 AI 暂时接管 ${target.displayName}`
        : `房主取消 AI 对 ${target.displayName} 的接管`,
    );
    return this.snapshot(room);
  }

  private removePlayerRecord(room: RoomRecord, target: RoomPlayer): void {
    room.players.delete(target.id);
    clearSwapRequestsForPlayer(room, target.id);
    room.publicAuditLog.push(`${target.displayName} 离开了房间`);
    if (target.id === room.hostPlayerId) {
      transferHostToLongestPresent(room);
    }
  }

  requestSeat(
    roomCode: string,
    playerId: string,
    targetSeatIndex: number,
  ): RoomSnapshot {
    const room = this.requireRoom(roomCode);
    this.requireLobby(room);
    const player = requirePlayer(room, playerId);
    requireSeat(room, targetSeatIndex);
    if (player.seatIndex === targetSeatIndex) return this.snapshot(room);

    const occupant = playerAtSeat(room, targetSeatIndex);
    clearSwapRequestsForPlayer(room, player.id);
    if (!occupant) {
      player.seatIndex = targetSeatIndex;
      return this.snapshot(room);
    }

    clearSwapRequestsForPlayer(room, occupant.id);
    const request: SeatSwapRequest = {
      id: this.swapRequestIdGenerator(),
      requesterId: player.id,
      recipientId: occupant.id,
      requesterSeatIndex: player.seatIndex,
      recipientSeatIndex: occupant.seatIndex,
    };
    room.pendingSeatSwaps.set(request.id, request);
    return this.snapshot(room);
  }

  answerSeatSwap(
    roomCode: string,
    recipientId: string,
    requestId: string,
    accept: boolean,
  ): RoomSnapshot {
    const room = this.requireRoom(roomCode);
    this.requireLobby(room);
    const request = room.pendingSeatSwaps.get(requestId);
    if (!request) {
      throw new RoomError("SEAT_SWAP_NOT_FOUND", "换座请求不存在或已失效");
    }
    if (request.recipientId !== recipientId) {
      throw new RoomError("SEAT_SWAP_NOT_RECIPIENT", "只有被请求者可以回应换座");
    }
    room.pendingSeatSwaps.delete(requestId);
    if (!accept) return this.snapshot(room);

    const requester = requirePlayer(room, request.requesterId);
    const recipient = requirePlayer(room, request.recipientId);
    if (
      requester.seatIndex !== request.requesterSeatIndex ||
      recipient.seatIndex !== request.recipientSeatIndex
    ) {
      throw new RoomError("SEAT_SWAP_NOT_FOUND", "座位已经变化，请重新请求");
    }
    [requester.seatIndex, recipient.seatIndex] = [
      recipient.seatIndex,
      requester.seatIndex,
    ];
    clearSwapRequestsForPlayer(room, requester.id);
    clearSwapRequestsForPlayer(room, recipient.id);
    return this.snapshot(room);
  }

  startRoom(
    roomCode: string,
    hostPlayerId: string,
    seatMode: StartSeatMode,
  ): StartRoomResult {
    const room = this.requireRoom(roomCode);
    this.requireLobby(room);
    this.requireHost(room, hostPlayerId);
    if (room.players.size !== room.capacity) {
      throw new RoomError("ROOM_NOT_FULL", "所有座位坐满后才能开始");
    }
    const disconnected = [...room.players.values()].find(
      (player) => !player.isBot && !player.connected,
    );
    if (disconnected) {
      throw new RoomError(
        "PLAYER_DISCONNECTED",
        `${disconnected.displayName} 尚未连接`,
      );
    }

    let players = [...room.players.values()].sort(
      (left, right) => left.seatIndex - right.seatIndex,
    );
    if (seatMode === "random") {
      players = shuffled(players, this.random);
      players.forEach((player, index) => {
        player.seatIndex = index;
      });
    }
    const seatOrder = players.map((player) => player.id);
    const initialActivePlayerId =
      seatOrder[randomIndex(seatOrder.length, this.random)];

    room.phase = "started";
    room.pendingSeatSwaps.clear();
    room.publicAuditLog.push(
      seatMode === "random" ? "房间以随机座位开始游戏" : "房间以当前座位开始游戏",
    );
    return {
      room: this.snapshot(room),
      seatOrder,
      initialActivePlayerId,
    };
  }

  returnToLobby(roomCode: string, hostPlayerId: string): RoomSnapshot {
    const room = this.requireRoom(roomCode);
    if (room.phase !== "started") {
      throw new RoomError("ROOM_NOT_STARTED", "游戏尚未开始");
    }
    this.requireHost(room, hostPlayerId);
    room.phase = "lobby";
    room.pendingSeatSwaps.clear();
    for (const player of room.players.values()) player.alive = true;
    room.publicAuditLog.push("房主发起新游戏，所有玩家返回大厅");
    return this.snapshot(room);
  }

  setReactionTimeout(
    roomCode: string,
    hostPlayerId: string,
    seconds: ReactionTimeoutSeconds,
  ): RoomSnapshot {
    const room = this.requireRoom(roomCode);
    this.requireHost(room, hostPlayerId);
    if (room.phase === "started" && !requirePlayer(room, hostPlayerId).alive) {
      throw new RoomError("DEAD_PLAYER_CANNOT_ACT", "死亡玩家不能修改反应时限");
    }
    if (!REACTION_TIMEOUT_OPTIONS.includes(seconds)) {
      throw new RoomError("INVALID_TIMEOUT", "不支持该反应时限");
    }
    room.reactionTimeoutSeconds = seconds;
    const label = seconds === null ? "关闭" : `${seconds} 秒`;
    room.publicAuditLog.push(`房主将反应时限改为 ${label}`);
    return this.snapshot(room);
  }

  /** Timer owners should capture this value when opening a new optional prompt. */
  reactionTimeoutForNextPrompt(roomCode: string): ReactionTimeoutSeconds {
    return this.requireRoom(roomCode).reactionTimeoutSeconds;
  }

  /** Call before forwarding any gameplay progression command to the engine. */
  assertGameplayCanProgress(roomCode: string): void {
    const room = this.requireRoom(roomCode);
    if (room.phase !== "started") {
      throw new RoomError("ROOM_NOT_STARTED", "游戏尚未开始");
    }
    const disconnected = [...room.players.values()].find(
      (player) =>
        !player.isBot && !player.botControlled && player.alive && !player.connected,
    );
    if (disconnected) {
      throw new RoomError(
        "GAME_PAUSED",
        `${disconnected.displayName} 已断线，游戏暂停`,
      );
    }
  }

  markDisconnectedPlayerDead(
    roomCode: string,
    hostPlayerId: string,
    targetPlayerId: string,
    resolveNormalDeath: NormalDeathResolver,
  ): RoomSnapshot {
    const room = this.requireRoom(roomCode);
    if (room.phase !== "started") {
      throw new RoomError("ROOM_NOT_STARTED", "游戏尚未开始");
    }
    this.requireHost(room, hostPlayerId);
    if (!requirePlayer(room, hostPlayerId).alive) {
      throw new RoomError("DEAD_PLAYER_CANNOT_ACT", "死亡玩家不能判定其他玩家死亡");
    }
    const target = requirePlayer(room, targetPlayerId);
    if (target.connected) {
      throw new RoomError("PLAYER_STILL_CONNECTED", "只能将断线玩家判定死亡");
    }
    if (!target.alive) {
      throw new RoomError("PLAYER_ALREADY_DEAD", "该玩家已经死亡");
    }
    // The game authority performs faction reveal, turn/priority skipping, and
    // any other ordinary death consequences before the room clears its pause.
    resolveNormalDeath(target.id);
    target.alive = false;
    room.publicAuditLog.push(`${target.displayName} 被房主判定死亡`);
    ensureInGameHost(room);
    return this.snapshot(room);
  }

  /** Mirrors engine-authoritative deaths without duplicating game audit entries. */
  synchronizePlayerDeaths(
    roomCode: string,
    deadPlayerIds: readonly string[],
  ): RoomSnapshot {
    const room = this.requireRoom(roomCode);
    if (room.phase !== "started") {
      throw new RoomError("ROOM_NOT_STARTED", "游戏尚未开始");
    }
    const deadPlayers = deadPlayerIds.map((playerId) => requirePlayer(room, playerId));
    for (const player of deadPlayers) player.alive = false;
    ensureInGameHost(room);
    return this.snapshot(room);
  }

  getRoom(roomCode: string): RoomSnapshot {
    return this.snapshot(this.requireRoom(roomCode));
  }

  hasRoom(roomCode: string): boolean {
    const normalized = normalizeRoomCode(roomCode);
    return normalized !== undefined && this.rooms.has(normalized);
  }

  deleteRoom(roomCode: string): boolean {
    const normalized = requireRoomCode(roomCode);
    return this.rooms.delete(normalized);
  }

  private requireRoom(roomCode: string): RoomRecord {
    const normalized = requireRoomCode(roomCode);
    const room = this.rooms.get(normalized);
    if (!room) throw new RoomError("ROOM_NOT_FOUND", "房间不存在或已失效");
    return room;
  }

  private requireLobby(room: RoomRecord): void {
    if (room.phase !== "lobby") {
      throw new RoomError("ROOM_ALREADY_STARTED", "游戏已经开始");
    }
  }

  private requireHost(room: RoomRecord, playerId: string): void {
    if (room.hostPlayerId === null || room.hostPlayerId !== playerId) {
      throw new RoomError("NOT_HOST", "只有房主可以执行此操作");
    }
  }

  private createCredentials(): PlayerCredentials {
    return {
      playerId: this.playerIdGenerator(),
      reconnectToken: this.reconnectTokenGenerator(),
    };
  }

  private generateUniqueCode(): string {
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
      const candidate = this.roomCodeGenerator().toUpperCase();
      if (!ROOM_CODE_PATTERN.test(candidate)) continue;
      if (!this.rooms.has(candidate)) return candidate;
    }
    throw new RoomError(
      "CODE_GENERATION_EXHAUSTED",
      "暂时无法创建房间，请重试",
    );
  }

  private reserveRequestedCode(roomCode: string): string {
    const code = requireRoomCode(roomCode);
    if (this.rooms.has(code)) {
      throw new RoomError("ROOM_CODE_TAKEN", "房间码已被使用");
    }
    return code;
  }

  private snapshot(room: RoomRecord): RoomSnapshot {
    const players = [...room.players.values()]
      .sort((left, right) => left.seatIndex - right.seatIndex)
      .map(({ reconnectToken: _token, joinedSequence: _sequence, ...player }) => ({
        ...player,
      }));
    return {
      code: room.code,
      capacity: room.capacity,
      mode: room.capacity === 2 ? "duel" : "standard",
      phase: room.phase,
      hostPlayerId: room.hostPlayerId,
      players,
      spectators: [...room.spectators.values()].map(
        ({ reconnectToken: _token, ...spectator }) => ({ ...spectator }),
      ),
      pendingSeatSwaps: [...room.pendingSeatSwaps.values()].map((request) => ({
        ...request,
      })),
      reactionTimeoutSeconds: room.reactionTimeoutSeconds,
      gamePausedForDisconnect:
        room.phase === "started" &&
        players.some(
          (player) =>
            !player.isBot &&
            !player.botControlled &&
            player.alive &&
            !player.connected,
        ),
      publicAuditLog: [...room.publicAuditLog],
    };
  }
}

export function normalizeRoomCode(value: string): string | undefined {
  const normalized = value.trim().toUpperCase();
  return ROOM_CODE_PATTERN.test(normalized) ? normalized : undefined;
}

export function buildRoomInviteUrl(baseUrl: string, roomCode: string): string {
  const code = requireRoomCode(roomCode);
  return `${baseUrl.replace(/\/+$/, "")}/${code}`;
}

export function isRoomCapacity(value: number): value is RoomCapacity {
  return (SUPPORTED_ROOM_CAPACITIES as readonly number[]).includes(value);
}

function normalizeDisplayName(value: string): string {
  const normalized = value.trim().normalize("NFC");
  const length = Array.from(normalized).length;
  if (length < 1 || length > 16) {
    throw new RoomError("INVALID_DISPLAY_NAME", "名字须为 1 至 16 个字符");
  }
  return normalized;
}

function identityNameTaken(room: RoomRecord, displayName: string): boolean {
  return [...room.players.values(), ...room.spectators.values()].some(
    (identity) => identity.displayName === displayName,
  );
}

function requireRoomCode(value: string): string {
  const normalized = normalizeRoomCode(value);
  if (!normalized) {
    throw new RoomError("INVALID_ROOM_CODE", "房间码应为六位英文字母");
  }
  return normalized;
}

function requirePlayer(room: RoomRecord, playerId: string): RoomPlayer {
  const player = room.players.get(playerId);
  if (!player) throw new RoomError("PLAYER_NOT_FOUND", "玩家不存在");
  return player;
}

function requireSeat(room: RoomRecord, seatIndex: number): void {
  if (!Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex >= room.capacity) {
    throw new RoomError("INVALID_SEAT", "座位不存在");
  }
}

function playerAtSeat(room: RoomRecord, seatIndex: number): RoomPlayer | undefined {
  return [...room.players.values()].find((player) => player.seatIndex === seatIndex);
}

function firstEmptySeat(room: RoomRecord): number {
  for (let index = 0; index < room.capacity; index += 1) {
    if (!playerAtSeat(room, index)) return index;
  }
  throw new RoomError("ROOM_FULL", "房间已满");
}

function clearSwapRequestsForPlayer(room: RoomRecord, playerId: string): void {
  for (const [requestId, request] of room.pendingSeatSwaps) {
    if (request.requesterId === playerId || request.recipientId === playerId) {
      room.pendingSeatSwaps.delete(requestId);
    }
  }
}

function nextBotName(room: RoomRecord): string {
  const names = new Set(
    [...room.players.values()].map((player) => player.displayName),
  );
  for (let number = 1; ; number += 1) {
    const candidate = `机器人 ${number}`;
    if (!names.has(candidate)) return candidate;
  }
}

function transferHostToLongestPresent(room: RoomRecord): void {
  const successor = [...room.players.values()].sort(
    (left, right) => left.joinedSequence - right.joinedSequence,
  ).find((player) => !player.isBot);
  if (!successor) return;
  for (const player of room.players.values()) player.isHost = false;
  successor.isHost = true;
  room.hostPlayerId = successor.id;
  room.publicAuditLog.push(`${successor.displayName} 成为房主`);
}

function ensureInGameHost(room: RoomRecord): void {
  if (room.phase !== "started" || room.hostPlayerId === null) return;
  const current = requirePlayer(room, room.hostPlayerId);
  if (current.alive && current.connected) return;

  current.isHost = false;
  const successor = nextConnectedLivingHostCandidate(room, current.seatIndex);
  if (successor) {
    transferInGameHost(room, successor);
  } else {
    room.hostPlayerId = null;
  }
}

function nextConnectedLivingHostCandidate(
  room: RoomRecord,
  fromSeatIndex: number,
): RoomPlayer | undefined {
  for (let offset = 1; offset <= room.capacity; offset += 1) {
    const seatIndex = (fromSeatIndex + offset) % room.capacity;
    const player = playerAtSeat(room, seatIndex);
    if (player?.alive && player.connected && !player.isBot) {
      return player;
    }
  }
  return undefined;
}

function transferInGameHost(room: RoomRecord, successor: RoomPlayer): void {
  for (const player of room.players.values()) player.isHost = false;
  successor.isHost = true;
  room.hostPlayerId = successor.id;
  room.publicAuditLog.push(`${successor.displayName} 成为房主`);
}

function shuffled<T>(values: readonly T[], random: RoomRandom): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = randomIndex(index + 1, random);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function randomIndex(length: number, random: RoomRandom): number {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError("Room random source must return a number in [0, 1)");
  }
  return Math.floor(value * length);
}

function generateRoomCode(random: RoomRandom): string {
  let result = "";
  for (let index = 0; index < ROOM_CODE_LENGTH; index += 1) {
    result += String.fromCharCode(65 + randomIndex(26, random));
  }
  return result;
}

function defaultOpaqueId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function defaultReconnectToken(): string {
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    const bytes = new Uint8Array(32);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  throw new RoomError(
    "SECURE_RANDOM_UNAVAILABLE",
    "服务器无法生成安全的重连凭证",
  );
}
