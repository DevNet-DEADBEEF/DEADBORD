# @deadbord/lmp

Node.js 20+ ESM LMP packet codec and application dispatcher with TypeScript declarations. Depends only on `@deadbord/tlon`.

```js
import { encode, decode, Scope, Action, newActionId, resourceId } from '@deadbord/lmp';
const request = {
  response: false, scope: Scope.Task, code: Action.Obtain,
  scopeId: 42n, actionId: newActionId(), payload: [['name']],
};
console.log(decode(encode(request)));
console.log(resourceId(Scope.Task, 42n)); // Decimal 66-bit scoped ID for INIT
```

All IDs use bigint. Payloads are TLON entry arrays and may occupy at most 500 bytes. Version is required for UPDATE, DELETE, UPDATE_PERM and DONE, and forbidden elsewhere. DONE application payloads are supplied by callers.

`new Dispatcher(handler, { maxEntries?, ttlMs? })` exposes `dispatch(request, context, principal)`. The handler returns `{ code, version?, payload? }`; the dispatcher supplies response identity fields. Use a stable authenticated principal and share the dispatcher across connections to deduplicate action UUIDs. It stores promises and serialized responses, including failures. Cache defaults: 10,000 entries, no expiration, reject work when full. Finite TTL opts into a shorter deduplication window. Persistent deduplication, database operations, version checks, and authorization remain application responsibilities.
