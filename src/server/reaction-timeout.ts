import type { ReactionTimeoutSeconds } from "../room";
import type { GameState } from "../game/engine";
import type { GameCommand, GameSessionService } from "./game-session";

export interface ReactionTimerSnapshot {
  promptId: string;
  actorId: string;
  deadlineAt: number | null;
  remainingMs: number;
  paused: boolean;
}

export interface ReactionTimerClock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface ReactionTimeoutSchedulerOptions {
  gameSessions: GameSessionService;
  timeoutForNextPrompt(roomCode: string): ReactionTimeoutSeconds;
  isPaused(roomCode: string): boolean;
  dispatch(roomCode: string, actorId: string, command: GameCommand): void;
  onGameAdvanced(roomCode: string): void | Promise<void>;
  onTimerChanged?(
    roomCode: string,
    timer: ReactionTimerSnapshot | null,
  ): void | Promise<void>;
  clock?: ReactionTimerClock;
}

interface OptionalPrompt {
  fingerprint: string;
  actorId: string;
  command: Extract<GameCommand, { type: "PASS_REACTION" | "PASS_LOCK" }>;
}

interface ScheduledPrompt extends OptionalPrompt {
  promptId: string;
  remainingMs: number;
  deadlineAt: number | null;
  paused: boolean;
  handle?: unknown;
}

const systemClock: ReactionTimerClock = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Server-owned wall-clock scheduling; no timing data is written into GameState. */
export class ReactionTimeoutScheduler {
  private readonly scheduled = new Map<string, ScheduledPrompt>();
  private readonly nextPromptSequence = new Map<string, number>();
  private readonly clock: ReactionTimerClock;

  constructor(private readonly options: ReactionTimeoutSchedulerOptions) {
    this.clock = options.clock ?? systemClock;
  }

  reconcile(roomCode: string): void {
    const prompt = this.currentOptionalPrompt(roomCode);
    const existing = this.scheduled.get(roomCode);
    if (!prompt) {
      if (existing) this.clear(roomCode, existing, true);
      return;
    }

    let scheduled = existing;
    if (!scheduled || scheduled.fingerprint !== prompt.fingerprint) {
      if (scheduled) this.clear(roomCode, scheduled, false);
      const sequence = (this.nextPromptSequence.get(roomCode) ?? 0) + 1;
      this.nextPromptSequence.set(roomCode, sequence);
      const seconds = this.options.timeoutForNextPrompt(roomCode);
      scheduled = {
        ...prompt,
        promptId: `${roomCode}:${sequence}`,
        remainingMs: seconds === null ? Number.POSITIVE_INFINITY : seconds * 1_000,
        deadlineAt: null,
        paused: false,
      };
      this.scheduled.set(roomCode, scheduled);
    }

    const paused = this.options.isPaused(roomCode);
    if (paused) {
      this.pause(roomCode, scheduled);
      return;
    }
    if (scheduled.paused) scheduled.paused = false;
    if (scheduled.handle === undefined && Number.isFinite(scheduled.remainingMs)) {
      this.arm(roomCode, scheduled);
    } else {
      this.notify(roomCode, scheduled);
    }
  }

  snapshot(roomCode: string): ReactionTimerSnapshot | null {
    const scheduled = this.scheduled.get(roomCode);
    if (!scheduled || !Number.isFinite(scheduled.remainingMs)) return null;
    return this.toSnapshot(scheduled);
  }

  cancel(roomCode: string): void {
    const scheduled = this.scheduled.get(roomCode);
    if (scheduled) this.clear(roomCode, scheduled, true);
  }

  close(): void {
    for (const [roomCode, scheduled] of this.scheduled) {
      this.clear(roomCode, scheduled, false);
    }
  }

  private currentOptionalPrompt(roomCode: string): OptionalPrompt | undefined {
    if (!this.options.gameSessions.has(roomCode)) return undefined;
    const state = this.options.gameSessions.getState(roomCode);
    if (state.phase === "gameOver") return undefined;
    const window = state.reactionWindow;
    if (window) {
      const actorId = window.responderOrder[window.nextResponderIndex];
      if (!actorId) return undefined;
      return {
        fingerprint: reactionFingerprint(state, actorId),
        actorId,
        command: { type: "PASS_REACTION" },
      };
    }
    const transmission = state.transmission;
    if (transmission?.receiptStage === "lockOffer") {
      return {
        fingerprint: `lock:${transmission.receiptCycle}:${transmission.senderId}:${transmission.intendedRecipientId}`,
        actorId: transmission.senderId,
        command: { type: "PASS_LOCK" },
      };
    }
    return undefined;
  }

  private arm(roomCode: string, scheduled: ScheduledPrompt): void {
    scheduled.deadlineAt = this.clock.now() + scheduled.remainingMs;
    scheduled.handle = this.clock.setTimeout(
      () => this.expire(roomCode, scheduled.promptId),
      scheduled.remainingMs,
    );
    this.notify(roomCode, scheduled);
  }

  private pause(roomCode: string, scheduled: ScheduledPrompt): void {
    if (scheduled.handle !== undefined) {
      this.clock.clearTimeout(scheduled.handle);
      scheduled.handle = undefined;
      scheduled.remainingMs = Math.max(
        0,
        (scheduled.deadlineAt ?? this.clock.now()) - this.clock.now(),
      );
    }
    scheduled.deadlineAt = null;
    scheduled.paused = true;
    this.notify(roomCode, scheduled);
  }

  private expire(roomCode: string, promptId: string): void {
    const scheduled = this.scheduled.get(roomCode);
    if (!scheduled || scheduled.promptId !== promptId) return;
    scheduled.handle = undefined;
    scheduled.deadlineAt = null;
    scheduled.remainingMs = 0;
    if (this.options.isPaused(roomCode)) {
      scheduled.paused = true;
      this.notify(roomCode, scheduled);
      return;
    }
    try {
      this.options.dispatch(roomCode, scheduled.actorId, scheduled.command);
      void this.options.onGameAdvanced(roomCode);
    } catch {
      this.clear(roomCode, scheduled, true);
      return;
    }
    this.reconcile(roomCode);
  }

  private clear(
    roomCode: string,
    scheduled: ScheduledPrompt,
    notify: boolean,
  ): void {
    if (scheduled.handle !== undefined) this.clock.clearTimeout(scheduled.handle);
    this.scheduled.delete(roomCode);
    if (notify) void this.options.onTimerChanged?.(roomCode, null);
  }

  private notify(roomCode: string, scheduled: ScheduledPrompt): void {
    void this.options.onTimerChanged?.(
      roomCode,
      Number.isFinite(scheduled.remainingMs) ? this.toSnapshot(scheduled) : null,
    );
  }

  private toSnapshot(scheduled: ScheduledPrompt): ReactionTimerSnapshot {
    const remainingMs =
      scheduled.deadlineAt === null
        ? scheduled.remainingMs
        : Math.max(0, scheduled.deadlineAt - this.clock.now());
    return {
      promptId: scheduled.promptId,
      actorId: scheduled.actorId,
      deadlineAt: scheduled.deadlineAt,
      remainingMs: Number.isFinite(remainingMs) ? remainingMs : 0,
      paused: scheduled.paused,
    };
  }
}

function reactionFingerprint(state: GameState, actorId: string): string {
  const window = state.reactionWindow!;
  const topInteraction =
    window.kind === "function"
      ? state.activeFunctionStack.at(-1)?.id
      : state.interactionStack.at(-1)?.id;
  return [
    "reaction",
    window.kind,
    state.transmission?.receiptCycle ?? "-",
    state.activeFunctionAction?.sourceCardId ?? "-",
    topInteraction ?? "-",
    window.nextResponderIndex,
    actorId,
  ].join(":");
}
