# Upstream contract

Verification target: Ripwire 0.4.0, released binary for macOS arm64. The release archive passed its published SHA-256 check.

## Sources

- [Release](https://github.com/redhat-et/ripwire/releases/tag/v0.4.0)
- [CLI flag table](https://github.com/redhat-et/ripwire/blob/v0.4.0/src/cli.h)
- [Command reference](https://github.com/redhat-et/ripwire/blob/v0.4.0/docs/COMMANDS.md)
- [Parse cache implementation](https://github.com/redhat-et/ripwire/blob/v0.4.0/src/ingest_cache.h)
- [Cache directories and quality snapshots](https://github.com/redhat-et/ripwire/blob/v0.4.0/src/quality.h)

The executable's `--help` output is the flag authority. The wrapper uses explicit operations rather than a raw argument interface.

## Budget semantics

`--max-tokens` shapes the default map and recalled documents. Their `--token-budget` option is a gate, not a shaping request. Search, task packs, trace bundles, and review bundles use `--token-budget` to shape output.

`--top-k` does not constrain the normal search bundle. The wrapper rejects that combination instead of presenting an inert control. Expand retains upstream's automatic choice between a symbol bundle and the smaller whole file.

## Shared checkouts

The parse cache publishes through per-process temporary files and atomic rename. Quality cache writes also use unique temporary names. The cache directory selection starts with `TMPDIR`, then `XDG_CACHE_HOME`.

The wrapper supplies private values for both variables. Each extension instance owns its directory, and each child process owns its output files. This avoids depending on shared cross-session cache eviction or publication behavior.

Bare `--quality-delta` can delete a stale `.ripwire_quality_baseline` file. Explicit committed delta input does not read, write, or delete that baseline. The wrapper exposes only the explicit form.

The wrapper does not prevent concurrent source edits. Ripwire scans a live directory, not a transactional snapshot. Results therefore include a reminder to re-run after concurrent edits.

## Exit codes

- Exit 4 from `--test-gate` means test or coverage obligations exist.
- Exit 2 from `--quality-delta` means gating regressions exist.
- Exit 0 is not a test-success claim or a guarantee about new debt.

The wrapper preserves these reports and labels their outcomes. Other nonzero codes become execution errors.
