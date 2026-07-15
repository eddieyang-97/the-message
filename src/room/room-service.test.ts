import { describe, expect, it } from "vitest";

import { RoomError } from "./errors";
import {
  RoomService,
  buildRoomInviteUrl,
  normalizeRoomCode,
} from "./room-service";

function sequence(values: readonly string[]): () => string {
  let index = 0;
  return () => values[index++] ?? `generated-${index}`;
}

function createService(options: {
  codes?: readonly string[];
  random?: readonly number[];
} = {}): RoomService {
  let randomIndex = 0;
  return new RoomService({
    roomCodeGenerator: sequence(options.codes ?? ["ABCDEF"]),
    playerIdGenerator: sequence([
      "player-1",
      "player-2",
      "player-3",
      "player-4",
      "player-5",
      "player-6",
      "player-7",
      "player-8",
    ]),
    reconnectTokenGenerator: sequence([
      "token-1",
      "token-2",
      "token-3",
      "token-4",
      "token-5",
      "token-6",
      "token-7",
      "token-8",
    ]),
    swapRequestIdGenerator: sequence(["swap-1", "swap-2", "swap-3"]),
    random: () => options.random?.[randomIndex++] ?? 0,
  });
}

function expectRoomError(action: () => unknown, code: RoomError["code"]): void {
  try {
    action();
    throw new Error(`Expected RoomError ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(RoomError);
    expect((error as RoomError).code).toBe(code);
  }
}

function fillDuel(service: RoomService): {
  code: string;
  hostId: string;
  guestId: string;
  guestToken: string;
} {
  const host = service.createRoom(2, "房主");
  const guest = service.joinRoom(host.room.code, "客人");
  return {
    code: host.room.code,
    hostId: host.playerId,
    guestId: guest.playerId,
    guestToken: guest.reconnectToken,
  };
}

describe("房间代码", () => {
  it("生成六位大写字母代码，并规范化输入和邀请链接", () => {
    const service = createService({ codes: ["abcdef"] });
    const created = service.createRoom(2, "甲");

    expect(created.room.code).toBe("ABCDEF");
    expect(normalizeRoomCode("  abcdef  ")).toBe("ABCDEF");
    expect(normalizeRoomCode("ABCDE1")).toBeUndefined();
    expect(normalizeRoomCode("ABCDE")).toBeUndefined();
    expect(service.getRoom(" abcdef ").code).toBe("ABCDEF");
    expect(buildRoomInviteUrl("https://game.example///", "abcdef")).toBe(
      "https://game.example/ABCDEF",
    );
  });

  it("跳过无效和冲突代码，直到生成唯一代码", () => {
    const service = createService({
      codes: ["abcdef", "bad-01", "ABCDEF", "ghijkl"],
    });

    expect(service.createRoom(2, "甲").room.code).toBe("ABCDEF");
    expect(service.createRoom(2, "乙").room.code).toBe("GHIJKL");
  });
});

describe("容量、名字和加入限制", () => {
  it.each([
    [2, "duel"],
    [5, "standard"],
    [6, "standard"],
    [7, "standard"],
    [8, "standard"],
  ] as const)("支持 %d 人房间并选择 %s 模式", (capacity, mode) => {
    const service = createService();
    const result = service.createRoom(capacity, "甲");
    expect(result.room).toMatchObject({ capacity, mode });
  });

  it("拒绝不支持的容量和空白或超过十六字符的名字", () => {
    const service = createService({ codes: ["ABCDEF", "BCDEFG", "CDEFGH"] });
    expectRoomError(() => service.createRoom(3, "甲"), "INVALID_CAPACITY");
    expectRoomError(() => service.createRoom(2, "   "), "INVALID_DISPLAY_NAME");
    expectRoomError(
      () => service.createRoom(2, "一二三四五六七八九十甲乙丙丁戊己庚"),
      "INVALID_DISPLAY_NAME",
    );
  });

  it("修剪并规范化 Unicode 名字，且房内名字必须唯一", () => {
    const service = createService();
    const host = service.createRoom(2, "  café  ");

    expect(host.room.players[0].displayName).toBe("café");
    expectRoomError(
      () => service.joinRoom(host.room.code, "cafe\u0301"),
      "DUPLICATE_DISPLAY_NAME",
    );
  });

  it("拒绝加入已满或已经开始的房间", () => {
    const fullService = createService();
    const full = fillDuel(fullService);
    expectRoomError(() => fullService.joinRoom(full.code, "第三人"), "ROOM_FULL");

    const startedService = createService();
    const started = fillDuel(startedService);
    startedService.startRoom(started.code, started.hostId, "as-is");
    expectRoomError(
      () => startedService.joinRoom(started.code, "第三人"),
      "ROOM_ALREADY_STARTED",
    );
  });
});

describe("连接、离开和房主权限", () => {
  it("断线后保留座位，并仅凭正确令牌恢复同一玩家", () => {
    const service = createService();
    const room = fillDuel(service);

    const disconnected = service.disconnect(room.code, room.guestId);
    expect(disconnected.players.find((player) => player.id === room.guestId)).toMatchObject({
      seatIndex: 1,
      connected: false,
    });
    expectRoomError(() => service.reconnect(room.code, "wrong"), "INVALID_RECONNECT_TOKEN");

    const reconnected = service.reconnect(room.code, room.guestToken);
    expect(reconnected.playerId).toBe(room.guestId);
    expect(reconnected.room.players.find((player) => player.id === room.guestId)?.connected).toBe(true);
    expectRoomError(
      () => service.reconnect(room.code, room.guestToken),
      "PLAYER_ALREADY_CONNECTED",
    );
  });

  it("房主离开后转交给在场最久的玩家", () => {
    const service = createService();
    const host = service.createRoom(5, "甲");
    const second = service.joinRoom(host.room.code, "乙");
    const third = service.joinRoom(host.room.code, "丙");

    const room = service.leaveLobby(host.room.code, host.playerId);
    expect(room?.hostPlayerId).toBe(second.playerId);
    expect(room?.players.find((player) => player.id === second.playerId)?.isHost).toBe(true);
    expect(room?.players.find((player) => player.id === third.playerId)?.isHost).toBe(false);
  });

  it("只有房主能移除大厅玩家，房主可移除断线玩家", () => {
    const service = createService();
    const room = fillDuel(service);
    service.disconnect(room.code, room.guestId);

    expectRoomError(
      () => service.removeLobbyPlayer(room.code, room.guestId, room.hostId),
      "NOT_HOST",
    );
    const snapshot = service.removeLobbyPlayer(room.code, room.hostId, room.guestId);
    expect(snapshot?.players.map((player) => player.id)).toEqual([room.hostId]);
  });

  it("最后一名玩家离开后删除空房间", () => {
    const service = createService();
    const host = service.createRoom(2, "甲");

    expect(service.leaveLobby(host.room.code, host.playerId)).toBeUndefined();
    expect(service.hasRoom(host.room.code)).toBe(false);
    expectRoomError(() => service.getRoom(host.room.code), "ROOM_NOT_FOUND");
  });
});

describe("大厅换座", () => {
  it("玩家可直接移动到空座位", () => {
    const service = createService();
    const host = service.createRoom(5, "甲");
    const guest = service.joinRoom(host.room.code, "乙");

    const room = service.requestSeat(host.room.code, guest.playerId, 4);
    expect(room.players.find((player) => player.id === guest.playerId)?.seatIndex).toBe(4);
    expect(room.pendingSeatSwaps).toEqual([]);
  });

  it("占用座位需要对方同意后才交换", () => {
    const service = createService();
    const host = service.createRoom(2, "甲");
    const guest = service.joinRoom(host.room.code, "乙");

    const requested = service.requestSeat(host.room.code, host.playerId, 1);
    const request = requested.pendingSeatSwaps[0];
    expect(request).toMatchObject({
      requesterId: host.playerId,
      recipientId: guest.playerId,
      requesterSeatIndex: 0,
      recipientSeatIndex: 1,
    });
    expectRoomError(
      () => service.answerSeatSwap(host.room.code, host.playerId, request.id, true),
      "SEAT_SWAP_NOT_RECIPIENT",
    );

    const swapped = service.answerSeatSwap(host.room.code, guest.playerId, request.id, true);
    expect(swapped.players.find((player) => player.id === host.playerId)?.seatIndex).toBe(1);
    expect(swapped.players.find((player) => player.id === guest.playerId)?.seatIndex).toBe(0);
    expect(swapped.pendingSeatSwaps).toEqual([]);
  });

  it("被请求者可拒绝交换而不改变座位", () => {
    const service = createService();
    const room = fillDuel(service);
    const request = service.requestSeat(room.code, room.hostId, 1).pendingSeatSwaps[0];

    const declined = service.answerSeatSwap(room.code, room.guestId, request.id, false);
    expect(declined.players.map((player) => [player.id, player.seatIndex])).toEqual([
      [room.hostId, 0],
      [room.guestId, 1],
    ]);
  });
});

describe("开始游戏", () => {
  it("必须由房主在房间坐满且所有玩家在线时开始", () => {
    const service = createService();
    const host = service.createRoom(2, "甲");
    expectRoomError(
      () => service.startRoom(host.room.code, host.playerId, "as-is"),
      "ROOM_NOT_FULL",
    );

    const guest = service.joinRoom(host.room.code, "乙");
    expectRoomError(
      () => service.startRoom(host.room.code, guest.playerId, "as-is"),
      "NOT_HOST",
    );
    service.disconnect(host.room.code, guest.playerId);
    expectRoomError(
      () => service.startRoom(host.room.code, host.playerId, "as-is"),
      "PLAYER_DISCONNECTED",
    );
  });

  it("按当前座位开始并独立随机选择首位行动玩家", () => {
    const service = createService({ random: [0.99] });
    const room = fillDuel(service);

    const started = service.startRoom(room.code, room.hostId, "as-is");
    expect(started.seatOrder).toEqual([room.hostId, room.guestId]);
    expect(started.initialActivePlayerId).toBe(room.guestId);
    expect(started.room.phase).toBe("started");
  });

  it("随机座位使用确定性洗牌，并在洗牌后选择首位行动玩家", () => {
    const service = createService({ random: [0, 0] });
    const room = fillDuel(service);

    const started = service.startRoom(room.code, room.hostId, "random");
    expect(started.seatOrder).toEqual([room.guestId, room.hostId]);
    expect(started.initialActivePlayerId).toBe(room.guestId);
    expect(started.room.players.map((player) => player.id)).toEqual(started.seatOrder);
  });
});

describe("反应时限", () => {
  it("默认十五秒，房主可选择支持的值且变更写入公开日志", () => {
    const service = createService();
    const room = fillDuel(service);
    expect(service.reactionTimeoutForNextPrompt(room.code)).toBe(15);

    const changed = service.setReactionTimeout(room.code, room.hostId, 30);
    expect(changed.reactionTimeoutSeconds).toBe(30);
    expect(service.reactionTimeoutForNextPrompt(room.code)).toBe(30);
    expect(changed.publicAuditLog.at(-1)).toContain("30");

    const disabled = service.setReactionTimeout(room.code, room.hostId, null);
    expect(disabled.reactionTimeoutSeconds).toBeNull();
    expect(disabled.publicAuditLog).toHaveLength(changed.publicAuditLog.length + 1);
  });

  it("非房主不能修改，且拒绝未支持的时限", () => {
    const service = createService();
    const room = fillDuel(service);
    expectRoomError(
      () => service.setReactionTimeout(room.code, room.guestId, 20),
      "NOT_HOST",
    );
    expectRoomError(
      () => service.setReactionTimeout(room.code, room.hostId, 25 as 20),
      "INVALID_TIMEOUT",
    );
  });
});

describe("断线暂停和房主判死", () => {
  it("游戏未开始不能推进；开始后仅存活玩家断线会暂停", () => {
    const service = createService();
    const room = fillDuel(service);
    expectRoomError(() => service.assertGameplayCanProgress(room.code), "ROOM_NOT_STARTED");

    service.startRoom(room.code, room.hostId, "as-is");
    expect(() => service.assertGameplayCanProgress(room.code)).not.toThrow();
    const snapshot = service.disconnect(room.code, room.guestId);
    expect(snapshot.gamePausedForDisconnect).toBe(true);
    expectRoomError(() => service.assertGameplayCanProgress(room.code), "GAME_PAUSED");
  });

  it("房主判定断线玩家死亡时调用普通死亡流程并解除暂停", () => {
    const service = createService();
    const room = fillDuel(service);
    service.startRoom(room.code, room.hostId, "as-is");
    service.disconnect(room.code, room.guestId);
    const resolved: string[] = [];

    const snapshot = service.markDisconnectedPlayerDead(
      room.code,
      room.hostId,
      room.guestId,
      (playerId) => resolved.push(playerId),
    );

    expect(resolved).toEqual([room.guestId]);
    expect(snapshot.players.find((player) => player.id === room.guestId)?.alive).toBe(false);
    expect(snapshot.gamePausedForDisconnect).toBe(false);
    expect(() => service.assertGameplayCanProgress(room.code)).not.toThrow();
    expectRoomError(
      () =>
        service.markDisconnectedPlayerDead(room.code, room.hostId, room.guestId, () => {}),
      "PLAYER_ALREADY_DEAD",
    );
  });

  it("不能判定在线玩家死亡，且普通死亡回调失败时不改房间状态", () => {
    const service = createService();
    const room = fillDuel(service);
    service.startRoom(room.code, room.hostId, "as-is");
    expectRoomError(
      () =>
        service.markDisconnectedPlayerDead(room.code, room.hostId, room.guestId, () => {}),
      "PLAYER_STILL_CONNECTED",
    );

    service.disconnect(room.code, room.guestId);
    expect(() =>
      service.markDisconnectedPlayerDead(room.code, room.hostId, room.guestId, () => {
        throw new Error("engine rejected death");
      }),
    ).toThrow("engine rejected death");
    expect(service.getRoom(room.code).players.find((player) => player.id === room.guestId)?.alive).toBe(true);
  });

  it("静默同步规则引擎产生的死亡状态", () => {
    const service = createService();
    const room = fillDuel(service);
    service.startRoom(room.code, room.hostId, "as-is");
    const beforeLog = service.getRoom(room.code).publicAuditLog;

    const snapshot = service.synchronizePlayerDeaths(room.code, [room.guestId]);

    expect(snapshot.players.find((player) => player.id === room.guestId)?.alive).toBe(false);
    expect(snapshot.publicAuditLog).toEqual(beforeLog);
    service.disconnect(room.code, room.guestId);
    expect(service.getRoom(room.code).gamePausedForDisconnect).toBe(false);
  });

  it("死亡的原房主不能使用对局管理操作", () => {
    const service = createService();
    const room = fillDuel(service);
    service.startRoom(room.code, room.hostId, "as-is");
    service.synchronizePlayerDeaths(room.code, [room.hostId]);
    service.disconnect(room.code, room.guestId);

    expectRoomError(
      () => service.setReactionTimeout(room.code, room.hostId, 30),
      "NOT_HOST",
    );
    expectRoomError(
      () => service.markDisconnectedPlayerDead(room.code, room.hostId, room.guestId, () => {}),
      "NOT_HOST",
    );
  });

  it("游戏中房主离线或死亡后按顺时针永久移交", () => {
    const service = createService();
    const host = service.createRoom(5, "甲");
    const second = service.joinRoom(host.room.code, "乙");
    const third = service.joinRoom(host.room.code, "丙");
    const fourth = service.joinRoom(host.room.code, "丁");
    service.joinRoom(host.room.code, "戊");
    service.startRoom(host.room.code, host.playerId, "as-is");

    service.disconnect(host.room.code, second.playerId);
    const transferred = service.disconnect(host.room.code, host.playerId);
    expect(transferred.hostPlayerId).toBe(third.playerId);
    expect(transferred.players.find((player) => player.id === third.playerId)?.isHost)
      .toBe(true);
    expect(transferred.publicAuditLog.at(-1)).toBe("丙 成为房主");

    service.reconnect(host.room.code, host.reconnectToken);
    expect(service.getRoom(host.room.code).hostPlayerId).toBe(third.playerId);
    const afterDeath = service.synchronizePlayerDeaths(host.room.code, [third.playerId]);
    expect(afterDeath.hostPlayerId).toBe(fourth.playerId);
    expect(afterDeath.publicAuditLog.at(-1)).toBe("丁 成为房主");
  });

  it("双人连续断线时等待下一名存活玩家重连继任", () => {
    const service = createService();
    const host = service.createRoom(2, "甲");
    const guest = service.joinRoom(host.room.code, "乙");
    service.startRoom(host.room.code, host.playerId, "as-is");

    expect(service.disconnect(host.room.code, host.playerId).hostPlayerId).toBe(
      guest.playerId,
    );
    const pending = service.disconnect(host.room.code, guest.playerId);
    expect(pending.hostPlayerId).toBeNull();
    expect(pending.players.every((player) => !player.isHost)).toBe(true);

    const resolved = service.reconnect(host.room.code, host.reconnectToken);
    expect(resolved.room.hostPlayerId).toBe(host.playerId);
    expect(resolved.room.publicAuditLog.at(-1)).toBe("甲 成为房主");
    service.reconnect(host.room.code, guest.reconnectToken);
    expect(service.getRoom(host.room.code).hostPlayerId).toBe(host.playerId);
  });
});
