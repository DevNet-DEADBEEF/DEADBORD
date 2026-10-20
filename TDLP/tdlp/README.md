# @deadbord/tdlp

Node.js 20+ ESM UDP networking with TypeScript declarations. Depends on `@deadbord/lmp` and `@deadbord/tlon`.

`new Server({ privateKey, authorize, dispatcher, ...limits })` provides `await listen(port, host)` and `await close()`. Keys are PEM strings, Buffers, or Node KeyObjects; use RSA 2048 bits or larger. `authorize({ sessionKey, resources, packetCount, remote })` returns null or `{ principal, ...context }`. A dispatcher provides `dispatch(request, context, principal)`; `@deadbord/lmp` includes an in-memory implementation. Application code must enforce session permissions, CREATE parent authorization, field permissions, and database version checks.

`new Client({ host, port, publicKey, retryMs?, maxRetries? })` provides:

- `await connect({ sessionKey, resources, packetCount, payloadTimeoutMs? })` for one batch. Resources are decimal scoped IDs produced by LMP's `resourceId()`.
- `await request(lmpPacket)`; concurrent calls pipeline independent requests.
- `close()` when finished, including on failure. A Client is single-use.

Client/server retry defaults are 250 ms and eight retries. Server defaults: 60-second connection lifetime, 1,000 connections, 1,024 actions per batch, maximum 60-second payload timeout. Server option names: `connectionTtlMs`, `maxConnections`, `maxBatchSize`, `maxPayloadTimeoutMs`. The server resends cached responses for duplicates and issues bounded HUH missing-packet rounds. UDP expiration/timeout does not establish whether an application mutation committed. Preserve action UUIDs across retries.

The `@deadbord/tdlp/wire` export provides packet helpers and the counter-based Cipher. Binary integers are big-endian. Encryption adds a two-byte independent counter after the plaintext six-byte connection/packet ID header. RSA-OAEP/SHA-256 transports fresh AES-256-CTR keys and direction prefixes. Retransmissions reuse original datagrams. Unknown connection IDs receive plaintext BUGOFF, rate limited per peer/ID. The epoch is 2026-10-18T06:00:00Z; expiration is epoch seconds and durations are milliseconds.

As specified, AES-CTR has **no integrity authentication**. Validation and duplicate detection do not prevent an attacker from modifying packets. No automatic reconnect or mutation retry with a new action UUID is performed.

Events: `invalidPacket` (client/server), `networkError` (server), `close` (client). Import `Message`, `now`, and `EPOCH_MS` for protocol constants.
