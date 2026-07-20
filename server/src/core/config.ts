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
   *  handshake) for this long is closed, so half-open sockets don't pile up.
   *  MP9·E (F-4/D-9E-5) widened the default from 45 s to 90 s: a live client now
   *  sends a `{t:"ping"}` keepalive every ~20 s, but a BACKGROUNDED browser tab
   *  throttles timers to ~1/min, so 90 s clears two throttled pings before a
   *  briefly-inactive tab is reaped. This stays well under resumeGraceMs's
   *  independent budget (a DISCONNECTED slot's hold), so the two are unrelated. */
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
  idleTimeoutMs: 90_000, // MP9·E F-4: room for a throttled backgrounded tab's keepalive
};

/** MP8·A world-mode knobs (persistent worlds: zones + AOI + passports), on
 *  top of the base limits. Scale-target defaults per the roadmap table
 *  (200/zone, 1000+/world); the broadcast cadence default is the MP8·A
 *  tick-strategy MEASUREMENT decision (see docs/mp-8-spec.md — sim stays
 *  60 Hz, state broadcast is decimated; friend rooms keep every-tick). */
export interface WorldLimits extends BeaconLimits {
  /** Max players simultaneously inside one zone (one map). */
  maxPlayersPerZone: number;
  /** Max players in the whole world (all zones). */
  maxPlayersPerWorld: number;
  /** Broadcast one state delta every N sim ticks (N=1 ⇒ 60 Hz, N=5 ⇒ 12 Hz). */
  broadcastEveryTicks: number;
  /** Zones with at most this many players skip AOI filtering entirely. */
  aoiBypassMax: number;
  /** An emptied zone lingers this long before its instance is dropped. */
  emptyZoneTtlMs: number;
}

export const DEFAULT_WORLD_LIMITS: WorldLimits = {
  ...DEFAULT_LIMITS,
  maxPlayersPerZone: 250,
  maxPlayersPerWorld: 1200,
  broadcastEveryTicks: 5, // 12 Hz — the MP8·A measured default (docs/mp-8-spec.md)
  aoiBypassMax: 32,
  emptyZoneTtlMs: 60_000,
};
