# @deadbord/tlon

Node.js 20+ ESM TLON codec with TypeScript declarations.

```js
import { encode, decode } from '@deadbord/tlon';
const bytes = encode([['name', 'Example'], ['42']]);
console.log(decode(bytes));
```

Entries terminate with `0x1f`; values separate with `0x1e`. Values must contain only printable ASCII. An empty outer array means no payload. Invalid bytes, empty entry arrays, and unterminated input throw. Payload size limits belong to the enclosing protocol.
