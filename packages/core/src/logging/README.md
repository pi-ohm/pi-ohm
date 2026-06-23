# `@pi-ohm/core/logging`

Tiny structured debug logging for packages that already use `better-result`.

Logs are disabled by default. Enable with:

```sh
PI_OHM_DEBUG_MODE=true
```

Accepted truthy values: `true`, `1`, `yes`.

## Basic usage

```ts
import { createDebug } from "@pi-ohm/core/logging";

const debug = createDebug("@demo/payments");

debug("charge.requested", {
  customerId: "cus_123",
  amountCents: 2500,
});
```

Output:

```json
{
  "package": "@demo/payments",
  "event": "charge.requested",
  "fields": { "customerId": "cus_123", "amountCents": 2500 }
}
```

## Result usage

`debugResult` observes a `Result` and returns it unchanged.

```ts
import { debugResult } from "@pi-ohm/core/logging";

const result = await chargeCard(input);

return debugResult(debug, "charge.completed", result, {
  customerId: input.customerId,
});
```

Success adds `outcome: "ok"`. Errors add `outcome: "error"` and a small serialized error.

## Notes

- Use at boundaries, not every line.
- Prefer structured fields over strings.
- Debug logs are ephemeral. They are not durable state.
