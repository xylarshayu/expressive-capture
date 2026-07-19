# Performance budgets

Measure release builds on the target Windows laptop. Do not substitute framework marketing or a WSL
browser build for desktop measurements.

| Metric | Budget |
| --- | --- |
| Resident hotkey to focused editable window | p95 at most 150 ms over 100 invocations |
| Cold launch to editable window | at most 1.5 s |
| Idle private working set | target at most 100 MB; investigate above it |
| Ordinary editor response | no sustained frame above 16 ms in a representative note |
| Paste acknowledgement | placeholder or link feedback within 100 ms |
| Persist and link a 4K image | p95 at most 750 ms on local SSD |
| Excalidraw before first diagram | absent from the initial executed UI chunk |
| Finalize a small folder and copy path | p95 at most 250 ms excluding slow roots |

Record hardware, build identifier, sample count, median, p95, cold/warm distinction, output volume,
and observed failures. Profile before changing the durable document architecture to chase a number.

Use the [Windows smoke-test checklist](windows-smoke-test.md) for functional release gating before
recording these performance measurements. CI build time and a WSL browser preview are not substitutes
for measurements from the packaged Windows desktop process.
