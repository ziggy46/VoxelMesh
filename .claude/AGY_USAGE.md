# agy usage

**Decision (2026-10-27): agy is NOT used for delegation on this project.** The user ruled it out (usage limits).
All `[AGY]` tasks (D1-D5) go to the `voxelmesh-kernel-fallback` agent, then `voxelmesh-verifier`.

## What the pre-flight found (for reference only)
- `agy` is at `~/.local/bin/agy`; `agy --help` confirms `-p/--print` runs one prompt non-interactively.
- Working example: `agy -p "Reply with exactly: PONG" --print-timeout 90s` -> `PONG` (about 6.6 s).
- Piped stdin is NOT attached when a prompt argument is given. Context must be inlined (`agy -p "$(cat spec.md) ..."`) or referenced by path (agy has read access to the workspace).
- Capture output with `> .agy-out/<name>.raw.txt`.
