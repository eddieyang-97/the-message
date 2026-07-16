import { useCallback, useEffect, useMemo, useState } from "react";

import type { PlayerProjection, SpectatorProjection } from "../game/engine";
import type { RoomEntryResult, RoomSnapshot } from "../room";
import type { GameCommand, ReactionTimerSnapshot } from "../server";
import { GameTable } from "./GameTable";
import { LandingPage } from "./LandingPage";
import type {
  CreateRoomInput,
  InviteEntryState,
  JoinRoomInput,
  LobbyPlayer,
  PlayerCount,
  ReactionTimeoutSeconds,
  SeatSwapRequest,
  StartMode,
} from "./lobby-types";
import { RoomLobby } from "./RoomLobby";
import { SpectatorTable } from "./SpectatorTable";
import { createLobbySocketClient } from "./socket-client";

interface StoredCredentials {
  playerId: string;
  reconnectToken: string;
  isSpectator?: boolean;
}

const ROOM_PATH = /^\/([A-Za-z]{6})\/?$/;
const client = createLobbySocketClient();

function roomFromPath(pathname = window.location.pathname): string | undefined {
  return ROOM_PATH.exec(pathname)?.[1]?.toUpperCase();
}

function credentialKey(roomCode: string): string {
  return `fengsheng:room:${roomCode.toUpperCase()}`;
}

function loadCredentials(roomCode: string): StoredCredentials | undefined {
  try {
    const raw = localStorage.getItem(credentialKey(roomCode));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<StoredCredentials>;
    return typeof parsed.playerId === "string" && typeof parsed.reconnectToken === "string"
      ? { playerId: parsed.playerId, reconnectToken: parsed.reconnectToken, isSpectator: parsed.isSpectator === true }
      : undefined;
  } catch {
    return undefined;
  }
}

function saveCredentials(roomCode: string, credentials: StoredCredentials): void {
  localStorage.setItem(credentialKey(roomCode), JSON.stringify(credentials));
}

function clearCredentials(roomCode: string): void {
  localStorage.removeItem(credentialKey(roomCode));
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败，请稍后重试";
}

export function App() {
  const initialCode = useMemo(roomFromPath, []);
  const [invite, setInvite] = useState<InviteEntryState>(
    initialCode ? { kind: "valid", roomCode: initialCode } : { kind: "none" },
  );
  const [room, setRoom] = useState<RoomSnapshot>();
  const [credentials, setCredentials] = useState<StoredCredentials>();
  const [busyAction, setBusyAction] = useState<string>();
  const [errorMessage, setErrorMessage] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [game, setGame] = useState<PlayerProjection>();
  const [spectatorGame, setSpectatorGame] = useState<SpectatorProjection>();
  const [connected, setConnected] = useState(true);
  const [reactionTimer, setReactionTimer] = useState<ReactionTimerSnapshot | null>(null);

  const enterRoom = useCallback((entry: RoomEntryResult) => {
    const nextCredentials = {
      playerId: entry.playerId,
      reconnectToken: entry.reconnectToken,
      isSpectator: entry.isSpectator === true,
    };
    saveCredentials(entry.room.code, nextCredentials);
    setCredentials(nextCredentials);
    setRoom(entry.room);
    if (entry.room.phase === "lobby") {
      setGame(undefined);
      setSpectatorGame(undefined);
      setReactionTimer(null);
    }
    setInvite({ kind: "valid", roomCode: entry.room.code });
    window.history.replaceState(null, "", `/${entry.room.code}`);
  }, []);

  useEffect(() => {
    if (!initialCode) return;
    const stored = loadCredentials(initialCode);
    if (!stored) return;
    setBusyAction("reconnect");
    client.reconnect({ roomCode: initialCode, reconnectToken: stored.reconnectToken })
      .then(enterRoom)
      .catch((error: unknown) => {
        clearCredentials(initialCode);
        setErrorMessage(errorText(error));
      })
      .finally(() => setBusyAction(undefined));
  }, [enterRoom, initialCode]);

  useEffect(() => client.onRoomUpdated((updatedRoom) => {
    setRoom((current) => current?.code === updatedRoom.code ? updatedRoom : current);
  }), []);

  useEffect(() => client.onRemoved((message) => {
    if (room) clearCredentials(room.code);
    setRoom(undefined);
    setCredentials(undefined);
    setGame(undefined);
    setSpectatorGame(undefined);
    setReactionTimer(null);
    setInvite({ kind: "none" });
    window.history.replaceState(null, "", "/");
    setErrorMessage(message ?? "你已被移出房间");
  }), [room]);

  useEffect(() => client.onRoomStarted((result) => {
    setRoom(result.room);
    setNotice("游戏已开始");
  }), []);

  useEffect(() => client.onGameSnapshot(setGame), []);
  useEffect(() => client.onSpectatorSnapshot(setSpectatorGame), []);
  useEffect(() => client.onReactionTimer(setReactionTimer), []);
  useEffect(() => client.onDisconnect(() => setConnected(false)), []);

  useEffect(() => client.onConnect(() => {
    setConnected(true);
    if (!room || !credentials) return;
    void client.reconnect({ roomCode: room.code, reconnectToken: credentials.reconnectToken })
      .then(enterRoom)
      .catch((error: unknown) => setErrorMessage(errorText(error)));
  }), [credentials, enterRoom, room]);

  useEffect(() => {
    if (room?.phase !== "lobby" || (!game?.winner && !spectatorGame?.winner)) return;
    setGame(undefined);
    setSpectatorGame(undefined);
    setReactionTimer(null);
    setNotice("已返回大厅，可以开始新游戏");
  }, [game?.winner, room?.phase, spectatorGame?.winner]);

  const runAction = useCallback(async (name: string, action: () => Promise<unknown>) => {
    setBusyAction(name);
    setErrorMessage(undefined);
    setNotice(undefined);
    try {
      return await action();
    } catch (error) {
      setErrorMessage(errorText(error));
      return undefined;
    } finally {
      setBusyAction(undefined);
    }
  }, []);

  const createRoom = (input: CreateRoomInput) => {
    void runAction("create", async () => enterRoom(await client.createRoom({
      capacity: input.playerCount,
      displayName: input.displayName,
      roomCode: input.roomCode,
    })));
  };

  const joinRoom = (input: JoinRoomInput) => {
    void runAction("join", async () => enterRoom(await client.joinRoom(input)));
  };

  const spectateRoom = (input: JoinRoomInput) => {
    void runAction("spectate", async () => enterRoom(await client.spectateRoom(input)));
  };

  const goHome = useCallback(() => {
    setInvite({ kind: "none" });
    setErrorMessage(undefined);
    setGame(undefined);
    setSpectatorGame(undefined);
    setReactionTimer(null);
    window.history.replaceState(null, "", "/");
  }, []);

  if (!room || !credentials) {
    return (
      <LandingPage
        busy={busyAction !== undefined}
        errorMessage={errorMessage}
        invite={invite}
        onBackHome={goHome}
        onCreateRoom={createRoom}
        onJoinRoom={joinRoom}
        onSpectateRoom={spectateRoom}
      />
    );
  }

  if (credentials.isSpectator && spectatorGame) {
    return (
      <SpectatorTable
        connected={connected}
        onLeave={() => void runAction("leave", async () => {
          await client.leaveRoom();
          clearCredentials(room.code);
          setRoom(undefined);
          setCredentials(undefined);
          setSpectatorGame(undefined);
          goHome();
        })}
        playerDisplayNames={Object.fromEntries(room.players.map((player) => [player.id, player.displayName]))}
        projection={spectatorGame}
        roomAuditLog={room.publicAuditLog}
        spectators={room.spectators}
      />
    );
  }

  if (game) {
    return (
      <GameTable
        busy={busyAction !== undefined}
        connected={connected}
        disconnectedLivingPlayers={room.players
          .filter((player) => !player.connected && player.alive)
          .map((player) => ({
            id: player.id,
            displayName: player.displayName,
            botControlled: player.botControlled,
          }))}
        errorMessage={errorMessage}
        isHost={room.hostPlayerId === credentials.playerId &&
          room.players.find((player) => player.id === credentials.playerId)?.alive !== false}
        onCommand={(command: GameCommand) => void runAction("game-command", async () => {
          const updated = await client.sendGameCommand(command);
          setGame(updated);
        })}
        projection={game}
        playerDisplayNames={Object.fromEntries(
          room.players.map((player) => [
            player.id,
            player.botControlled && !player.isBot
              ? `${player.displayName}（AI 接管）`
              : player.displayName,
          ]),
        )}
        reactionTimer={reactionTimer}
        reactionTimeoutSeconds={(room.reactionTimeoutSeconds ?? 0) as ReactionTimeoutSeconds}
        roomAuditLog={room.publicAuditLog}
        spectators={room.spectators}
        onReactionTimeoutChange={(seconds) => void runAction("timeout", () => client.setReactionTimeout({
          seconds: seconds === 0 ? null : seconds,
        }))}
        onMarkDisconnectedPlayerDead={(targetPlayerId) => void runAction(
          "mark-dead",
          () => client.markDisconnectedPlayerDead({ targetPlayerId }),
        )}
        onSetBotTakeover={(targetPlayerId, enabled) => void runAction(
          "bot-takeover",
          () => client.setBotTakeover({ targetPlayerId, enabled }),
        )}
        onNewGame={() => void runAction("new-game", () => client.returnToLobby())}
      />
    );
  }

  const players: LobbyPlayer[] = room.players.map((player) => ({
    id: player.id,
    displayName: player.displayName,
    seat: player.seatIndex + 1,
    isHost: player.isHost,
    isConnected: player.connected,
    isBot: player.isBot,
  }));
  const playerNames = new Map(room.players.map((player) => [player.id, player.displayName]));
  const swapRequests: SeatSwapRequest[] = room.pendingSeatSwaps
    .filter((request) => request.recipientId === credentials.playerId)
    .map((request) => ({
      id: request.id,
      fromPlayerId: request.requesterId,
      fromDisplayName: playerNames.get(request.requesterId) ?? "其他玩家",
      fromSeat: request.requesterSeatIndex + 1,
      toPlayerId: request.recipientId,
      toDisplayName: playerNames.get(request.recipientId) ?? "你",
      toSeat: request.recipientSeatIndex + 1,
    }));
  const allConnected = room.players.every((player) => player.connected);
  const startDisabledReason = room.players.length < room.capacity
    ? `还需 ${room.capacity - room.players.length} 名玩家加入`
    : !allConnected
      ? "有玩家已断线，暂时无法开始"
      : undefined;
  const baseUrl = `${window.location.protocol}//${window.location.host}`;
  const leaveRoom = () => {
    void runAction("leave", async () => {
      await client.leaveRoom();
      clearCredentials(room.code);
      setRoom(undefined);
      setCredentials(undefined);
      goHome();
    });
  };

  const startGame = (mode: StartMode) => {
    void runAction("start", async () => {
      const result = await client.startRoom({
        seatMode: mode === "current-seats" ? "as-is" : "random",
      });
      setRoom(result.room);
      setNotice("游戏已开始");
    });
  };

  return (
    <RoomLobby
      busyAction={busyAction}
      capacity={room.capacity as PlayerCount}
      errorMessage={errorMessage}
      inviteUrl={`${baseUrl}/${room.code}`}
      notice={notice}
      onCopyInvite={(url) => {
        void navigator.clipboard.writeText(url)
          .then(() => setNotice("邀请链接已复制"))
          .catch(() => setErrorMessage("无法复制链接，请手动复制地址栏链接"));
      }}
      onAddBot={(seat) => void runAction(
        "add-bot",
        () => client.addBot({ seatIndex: seat - 1 }),
      )}
      onFillEmptySeatsWithBots={() => void runAction(
        "fill-bots",
        () => client.fillEmptySeatsWithBots(),
      )}
      onLeaveRoom={leaveRoom}
      onMoveSeat={(seat) => void runAction("seat", () => client.requestSeat({ seatIndex: seat - 1 }))}
      onReactionTimeoutChange={(seconds: ReactionTimeoutSeconds) => void runAction(
        "timeout",
        () => client.setReactionTimeout({
          seconds: seconds === 0 ? null : seconds,
        }),
      )}
      onRemovePlayer={(targetPlayerId) => void runAction(
        "remove",
        () => client.removePlayer({ targetPlayerId }),
      )}
      onRemoveBot={(targetPlayerId) => void runAction(
        "remove-bot",
        () => client.removeBot({ targetPlayerId }),
      )}
      onRespondToSwap={(requestId, accept) => void runAction(
        "swap",
        () => client.answerSeatSwap({ requestId, accept }),
      )}
      onStartGame={startGame}
      players={players}
      spectators={room.spectators}
      isSpectator={credentials.isSpectator === true}
      reactionTimeoutSeconds={(room.reactionTimeoutSeconds ?? 0) as ReactionTimeoutSeconds}
      roomCode={room.code}
      selfPlayerId={credentials.playerId}
      startDisabledReason={startDisabledReason}
      swapRequests={swapRequests}
    />
  );
}
