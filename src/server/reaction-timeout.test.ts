import { describe, expect, it, vi } from "vitest";

import type { PhysicalCard, PhysicalCardId } from "../game/cards";
import { GameSessionService, type GameCommand } from "./game-session";
import {
  ReactionTimeoutScheduler,
  type ReactionTimerClock,
} from "./reaction-timeout";

const playerIds = ["甲", "乙", "丙", "丁", "戊"];

describe("ReactionTimeoutScheduler", () => {
  it("captures configuration per prompt and auto-passes optional priority", () => {
    const context = setup(15);
    startTransmission(context.sessions);
    context.scheduler.reconcile(context.roomCode);
    const lockTimer = context.scheduler.snapshot(context.roomCode)!;
    expect(lockTimer.remainingMs).toBe(15_000);

    context.timeout = 10;
    context.scheduler.reconcile(context.roomCode);
    expect(context.scheduler.snapshot(context.roomCode)).toEqual(lockTimer);

    context.clock.advance(14_999);
    expect(context.sessions.getState(context.roomCode).transmission?.receiptStage).toBe(
      "lockOffer",
    );
    context.clock.advance(1);
    expect(context.sessions.getState(context.roomCode).transmission?.receiptStage).toBe(
      "reactions",
    );
    expect(context.scheduler.snapshot(context.roomCode)?.remainingMs).toBe(10_000);
    expect(context.advanced).toHaveBeenCalledTimes(1);
  });

  it("freezes and resumes the exact remaining duration while disconnected", () => {
    const context = setup(10);
    startTransmission(context.sessions);
    context.scheduler.reconcile(context.roomCode);
    context.clock.advance(4_000);

    context.paused = true;
    context.scheduler.reconcile(context.roomCode);
    expect(context.scheduler.snapshot(context.roomCode)).toMatchObject({
      deadlineAt: null,
      remainingMs: 6_000,
      paused: true,
    });
    context.clock.advance(30_000);
    expect(context.sessions.getState(context.roomCode).transmission?.receiptStage).toBe(
      "lockOffer",
    );

    context.paused = false;
    context.scheduler.reconcile(context.roomCode);
    expect(context.scheduler.snapshot(context.roomCode)).toMatchObject({
      deadlineAt: context.clock.now() + 6_000,
      remainingMs: 6_000,
      paused: false,
    });
    context.clock.advance(6_000);
    expect(context.sessions.getState(context.roomCode).transmission?.receiptStage).toBe(
      "reactions",
    );
  });

  it("does not retroactively enable a disabled current prompt and stops at mandatory choices", () => {
    const context = setup(null);
    startTransmission(context.sessions);
    context.scheduler.reconcile(context.roomCode);
    expect(context.scheduler.snapshot(context.roomCode)).toBeNull();

    context.timeout = 10;
    context.scheduler.reconcile(context.roomCode);
    context.clock.advance(60_000);
    expect(context.sessions.getState(context.roomCode).transmission?.receiptStage).toBe(
      "lockOffer",
    );

    const activePlayerId = context.sessions.getState(context.roomCode).activePlayerId;
    context.sessions.dispatch(context.roomCode, activePlayerId, { type: "PASS_LOCK" });
    context.scheduler.reconcile(context.roomCode);
    for (let count = 0; count < playerIds.length; count += 1) {
      const timer = context.scheduler.snapshot(context.roomCode);
      if (!timer) break;
      context.clock.advance(timer.remainingMs);
    }
    expect(context.sessions.getState(context.roomCode).transmission?.receiptStage).toBe(
      "decision",
    );
    expect(context.scheduler.snapshot(context.roomCode)).toBeNull();
  });
});

function setup(initialTimeout: 10 | 15 | null) {
  const roomCode = "ABCDEF";
  const sessions = new GameSessionService();
  sessions.create(roomCode, playerIds, 42);
  const clock = new FakeClock();
  const advanced = vi.fn();
  const context = {
    roomCode,
    sessions,
    clock,
    advanced,
    timeout: initialTimeout as 10 | 15 | null,
    paused: false,
    scheduler: undefined as unknown as ReactionTimeoutScheduler,
  };
  context.scheduler = new ReactionTimeoutScheduler({
    gameSessions: sessions,
    timeoutForNextPrompt: () => context.timeout,
    isPaused: () => context.paused,
    dispatch: (code, actorId, command) => {
      sessions.dispatch(code, actorId, command);
    },
    onGameAdvanced: advanced,
    clock,
  });
  return context;
}

function startTransmission(sessions: GameSessionService): void {
  const state = sessions.getState("ABCDEF");
  const actorId = state.activePlayerId;
  const projection = sessions.project("ABCDEF", actorId);
  const card = projection.own.hand[0]!;
  const targetId = playerIds.find((id) => id !== actorId)!;
  sessions.dispatch("ABCDEF", actorId, transmissionCommand(card, targetId));
}

function transmissionCommand(card: PhysicalCard, targetId: string): GameCommand {
  return {
    type: "START_TRANSMISSION",
    cardId: card.id as PhysicalCardId,
    ...(card.transmission === "任意" ? { method: "直达" as const } : {}),
    ...(card.transmission === "直达" || card.transmission === "任意"
      ? { targetId }
      : {}),
    ...(card.circle && card.transmission !== "直达"
      ? { direction: "clockwise" as const }
      : {}),
  };
}

class FakeClock implements ReactionTimerClock {
  private time = 1_000;
  private nextId = 1;
  private readonly timers = new Map<
    number,
    { deadline: number; callback: () => void }
  >();

  now(): number {
    return this.time;
  }

  setTimeout(callback: () => void, delayMs: number): unknown {
    const id = this.nextId++;
    this.timers.set(id, { deadline: this.time + delayMs, callback });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  advance(milliseconds: number): void {
    const target = this.time + milliseconds;
    while (true) {
      const next = [...this.timers.entries()]
        .filter(([, timer]) => timer.deadline <= target)
        .sort((left, right) => left[1].deadline - right[1].deadline)[0];
      if (!next) break;
      const [id, timer] = next;
      this.timers.delete(id);
      this.time = timer.deadline;
      timer.callback();
    }
    this.time = target;
  }
}
