export const PLAYER_REACTION_KINDS = ["flower", "tomato"] as const;

export type PlayerReactionKind = (typeof PLAYER_REACTION_KINDS)[number];

export interface PlayerReactionEvent {
  id: string;
  kind: PlayerReactionKind;
  fromPlayerId: string;
  targetPlayerId: string;
}

export function isPlayerReactionKind(value: unknown): value is PlayerReactionKind {
  return (PLAYER_REACTION_KINDS as readonly unknown[]).includes(value);
}
