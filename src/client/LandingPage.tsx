import { useId, useState, type FormEvent } from "react";

import {
  SUPPORTED_PLAYER_COUNTS,
  type CreateRoomInput,
  type InviteEntryState,
  type JoinRoomInput,
  type PlayerCount,
} from "./lobby-types";
import "./lobby.css";

export interface LandingPageProps {
  invite?: InviteEntryState;
  busy?: boolean;
  errorMessage?: string;
  onCreateRoom: (input: CreateRoomInput) => void;
  onJoinRoom: (input: JoinRoomInput) => void;
  onBackHome?: () => void;
}
function normalizedName(value: string): string {
  return value.trim();
}

function normalizedRoomCode(value: string): string {
  return value.trim().toUpperCase();
}

function nameError(name: string): string | undefined {
  const length = Array.from(normalizedName(name)).length;
  if (length === 0) return "请输入名字";
  if (length > 16) return "名字不能超过 16 个字符";
  return undefined;
}

function roomCodeError(code: string): string | undefined {
  return /^[A-Z]{6}$/.test(normalizedRoomCode(code))
    ? undefined
    : "房间码应为 6 个英文字母";
}

export function LandingPage({
  invite = { kind: "none" },
  busy = false,
  errorMessage,
  onCreateRoom,
  onJoinRoom,
  onBackHome,
}: LandingPageProps) {
  const [createName, setCreateName] = useState("");
  const [playerCount, setPlayerCount] = useState<PlayerCount>(5);
  const [createRoomCode, setCreateRoomCode] = useState("");
  const [joinName, setJoinName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [formError, setFormError] = useState<string>();
  const createNameId = useId();
  const countId = useId();
  const createRoomCodeId = useId();
  const joinNameId = useId();
  const roomCodeId = useId();

  const submitCreate = (event: FormEvent) => {
    event.preventDefault();
    const validationError = nameError(createName) ||
      (createRoomCode.trim() ? roomCodeError(createRoomCode) : undefined);
    if (validationError) {
      setFormError(validationError);
      return;
    }
    setFormError(undefined);
    onCreateRoom({
      displayName: normalizedName(createName),
      playerCount,
      roomCode: createRoomCode.trim()
        ? normalizedRoomCode(createRoomCode)
        : undefined,
    });
  };

  const submitJoin = (event: FormEvent) => {
    event.preventDefault();
    const code = invite.kind === "valid" ? invite.roomCode : roomCode;
    const validationError = nameError(joinName) ?? roomCodeError(code);
    if (validationError) {
      setFormError(validationError);
      return;
    }
    setFormError(undefined);
    onJoinRoom({
      displayName: normalizedName(joinName),
      roomCode: normalizedRoomCode(code),
    });
  };

  if (invite.kind === "loading") {
    return (
      <main className="lobby-shell lobby-shell--centered">
        <section className="panel entry-panel" aria-live="polite">
          <p className="eyebrow">房间 {invite.roomCode.toUpperCase()}</p>
          <h1>正在查找房间…</h1>
        </section>
      </main>
    );
  }

  if (invite.kind === "invalid") {
    return (
      <main className="lobby-shell lobby-shell--centered">
        <section className="panel entry-panel" role="alert">
          <p className="eyebrow">房间 {invite.roomCode.toUpperCase()}</p>
          <h1>无法加入房间</h1>
          <p>{invite.message ?? "房间不存在、已经过期，或游戏已经开始。"}</p>
          <button className="button button--primary" onClick={onBackHome} type="button">
            返回首页
          </button>
        </section>
      </main>
    );
  }

  if (invite.kind === "valid") {
    return (
      <main className="lobby-shell lobby-shell--centered">
        <section className="panel entry-panel">
          <p className="eyebrow">受邀加入</p>
          <h1>房间 {invite.roomCode.toUpperCase()}</h1>
          <p className="muted">输入名字即可进入等候室。</p>
          <form onSubmit={submitJoin}>
            <label htmlFor={joinNameId}>你的名字</label>
            <input
              id={joinNameId}
              autoComplete="nickname"
              autoFocus
              maxLength={16}
              onChange={(event) => setJoinName(event.target.value)}
              placeholder="1–16 个字符"
              value={joinName}
            />
            {(formError || errorMessage) && (
              <p className="form-error" role="alert">{formError ?? errorMessage}</p>
            )}
            <button className="button button--primary button--wide" disabled={busy} type="submit">
              {busy ? "正在加入…" : "加入房间"}
            </button>
          </form>
          {onBackHome && (
            <button className="button button--text" onClick={onBackHome} type="button">
              返回首页
            </button>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="lobby-shell lobby-shell--centered">
      <header className="brand-header">
        <p className="eyebrow">线上桌游</p>
        <h1>风声</h1>
        <p>创建房间，邀请朋友入局。</p>
      </header>

      <div className="entry-grid">
        <section className="panel entry-panel">
          <h2>创建房间</h2>
          <form onSubmit={submitCreate}>
            <label htmlFor={createNameId}>你的名字</label>
            <input
              id={createNameId}
              autoComplete="nickname"
              maxLength={16}
              onChange={(event) => setCreateName(event.target.value)}
              placeholder="1–16 个字符"
              value={createName}
            />

            <label htmlFor={countId}>玩家人数</label>
            <select
              id={countId}
              onChange={(event) => setPlayerCount(Number(event.target.value) as PlayerCount)}
              value={playerCount}
            >
              {SUPPORTED_PLAYER_COUNTS.map((count) => (
                <option key={count} value={count}>
                  {count} 人{count === 2 ? "（双人模式）" : ""}
                </option>
              ))}
            </select>

            <label htmlFor={createRoomCodeId}>指定房间码（可选）</label>
            <input
              id={createRoomCodeId}
              autoCapitalize="characters"
              autoComplete="off"
              className="room-code-input"
              maxLength={6}
              onChange={(event) => setCreateRoomCode(event.target.value.toUpperCase())}
              placeholder="留空则随机生成"
              value={createRoomCode}
            />

            <button className="button button--primary button--wide" disabled={busy} type="submit">
              {busy ? "正在创建…" : "创建房间"}
            </button>
          </form>
        </section>

        <section className="panel entry-panel">
          <h2>加入房间</h2>
          <form onSubmit={submitJoin}>
            <label htmlFor={roomCodeId}>房间码</label>
            <input
              id={roomCodeId}
              autoCapitalize="characters"
              autoComplete="off"
              className="room-code-input"
              maxLength={6}
              onChange={(event) => setRoomCode(event.target.value.toUpperCase())}
              placeholder="ABCDEF"
              value={roomCode}
            />

            <label htmlFor={joinNameId}>你的名字</label>
            <input
              id={joinNameId}
              autoComplete="nickname"
              maxLength={16}
              onChange={(event) => setJoinName(event.target.value)}
              placeholder="1–16 个字符"
              value={joinName}
            />

            <button className="button button--secondary button--wide" disabled={busy} type="submit">
              {busy ? "正在加入…" : "加入房间"}
            </button>
          </form>
        </section>
      </div>

      {(formError || errorMessage) && (
        <p className="form-error global-error" role="alert">{formError ?? errorMessage}</p>
      )}
    </main>
  );
}
