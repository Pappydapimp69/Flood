# ADR 0002 — Multiplayer as server-stamped input lockstep

Status: accepted (milestone 5).

## Decision
The server runs the same deterministic sim as the clients. Every 50 ms it builds frame *k*: each
human's latest steer (a tap shorter than a tick is kept as a one-tick pulse) plus its bots'
steers, one character per river. It steps its own world and broadcasts the frame. Clients run the
same `step()` on the frames. Positions, volumes and channels never cross the wire.

## Why
- The sim was built deterministic from M1 (seeded streams, no transcendental Math in state, fixed
  tick, order-independent phases), so identical inputs give identical worlds.
- Tiny bandwidth: ~105 B per frame at 80 players, about 2 KB/s per client.
- Nobody waits on the slowest player: the server alone decides which tick an input lands on.
- Joining late or reconnecting is a replay of the frame log (the client fast-forwards ≤400 ticks
  per render frame).
- Desync is detectable: clients send a fingerprint every 100 ticks; a mismatch gets `resync`, and
  the client says hello again and replays.

## Costs
- Your own steer shows after a round trip (input → server → frame). Rivers turn slowly anyway.
- Every rule that changes outcomes must live in `src/shared/` and stay deterministic.
- The server is authoritative on timing, not on cheating-proof physics: a client can only send
  steer −1/0/1, which is validated.

## Rejected
- Snapshot sync (server sends state): far more bandwidth with 80 rivers and dug channels.
- Peer lockstep: one slow player stalls the race.
