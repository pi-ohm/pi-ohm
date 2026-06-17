# @pi-ohm/profiler

Profiles Pi extension startup without requiring other extensions to integrate.

- `/ohm-profiler` runs an isolated benchmark process and shows slow extension load/lifecycle records.
- Startup shows an `ohm profiler` widget with the latest profile summary.
- Background profiling is throttled by `profiler.staleAfterMs`.

Config lives under `profiler` in `.pi/ohm.json` or the global ohm config.

```json
{
  "profiler": {
    "enabled": true,
    "autoProfile": true,
    "includeLifecycle": true,
    "slowThresholdMs": 50,
    "maxRows": 5,
    "staleAfterMs": 300000,
    "timeoutMs": 30000
  }
}
```
