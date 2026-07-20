/* RPGAtlas — server/src/core/config.ts
   Project Beacon MP5: tunable limits for the Beacon server core. Every number
   here is a safety or capacity knob (the MP5·D hardening + security gate audit
   these). Defaults suit a free-tier friend-room relay (2–16 players/room);
   a self-hosted world operator can override via BeaconServerOptions. GPL-3.0. */

export interface BeaconLimits {
  /** Max simultaneous players in one room (roadmap friend-room tier: 2–16). */
  maxPlayersPerRoom: number;
  /** Max rooms one server process will hold before refusing new ones. */
  maxRooms: number;
  /** Client→server frames allowed per connection per second (token bucket).
   *  Movement is ≤ 60/s; this leaves headroom and caps floods. */
  messagesPerSecond: number;
  /** Burst size for the per-connection message token bucket. */
  messageBurst: number;
  /** Room `join`/`resume` attempts allowed per source (IP) per window. Caps
   *  room-code brute force (each attempt has ≥ 44 bits to guess, and this makes
   *  online guessing hopeless). */
  joinsPerSource: number;
  /** Window (ms) for {@link joinsPerSource}. */
  joinWindowMs: number;
  /** Hard byte cap on one inbound frame (mirrors protocol MAX_CLIENT_MESSAGE_
   *  BYTES; enforced again at the socket so an oversized frame is dropped before
   *  JSON.parse). */
  maxFrameBytes: number;
  /** How long (ms) a disconnected member's slot is held for `resume` before the
   *  reaper removes them and broadcasts a presence `leave`. */
  resumeGraceMs: number;
  /** How long (ms) a room with no connected members lingers before it expires
   *  (empty rooms must not accumulate — roadmap safety rule 2). */
  emptyRoomTtlMs: number;
  /** Idle-connection timeout (ms): a link that sends nothing (not even the
   *  handshake) for this long is closed, so half-open sockets don't pile up. */
  idleTimeoutMs: number;
}

export const DEFAULT_LIMITS: BeaconLimits = {
  maxPlayersPerRoom: 16,
  maxRooms: 1000,
  messagesPerSecond: 40,
  messageBurst: 80,
  joinsPerSource: 30,
  joinWindowMs: 60_000,
  maxFrameBytes: 16 * 1024,
  resumeGraceMs: 30_000,
  emptyRoomTtlMs: 60_000,
  idleTimeoutMs: 45_000,
};
