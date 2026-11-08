export type GameplayPlatform = 'ios' | 'android' | 'web' | 'other';
export type GameplayAudience = 'all' | GameplayPlatform;
export type GameplayCounts = { players: number; attempts: number; completions: number };
export type GameplaySegment = GameplayCounts & {
  returning: number;
  firstSeen: number;
  repeatDays: number;
  signedIn: number;
  solo: number;
  multiplayer: number;
  daily: (GameplayCounts & { date: string })[];
  registeredPlayers: { username: string; attempts: number; completions: number; days: number; lastPlayed: string; platforms: GameplayPlatform[] }[];
};
export type GameplayReport = {
  available: true;
  generatedAt: string;
  range: { from: string; through: string; lookbackFrom: string };
  coverage: { earliestRecord: string | null; latestRecord: string | null; profilesAvailable: boolean };
  segments: Record<GameplayAudience, GameplaySegment>;
} | { available: false; reason: string };
