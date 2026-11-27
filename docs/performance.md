# Performance baseline

Measured on 2026-11-27 with the debug build, PostgreSQL 17 in Docker, and the
in-memory OSS backend, macOS arm64. The default seeded project had 11 active
files and 838 tokens. Each case is 15–30 sequential requests after tokenizer
warm-up; times include HTTP, JSON-RPC and database work.

| Request | avg | p50 | p95 | response |
| --- | ---: | ---: | ---: | ---: |
| `inspect_workspace` | 2.30 ms | 1.21 ms | 5.10 ms | 1,275 B |
| `read_slice` outline | 1.80 ms | 1.66 ms | 2.62 ms | 599 B |
| `read_slice` section | 1.24 ms | 1.24 ms | 1.35 ms | 543 B |
| `read_slice` full, `max_tokens=100` | 2.15 ms | 2.13 ms | 2.26 ms | 667 B |
| `resources/read` text | 1.21 ms | 1.21 ms | 1.29 ms | 1,646 B |
| `resources/directory/read` | 1.05 ms | 1.03 ms | 1.20 ms | 237 B |
| Web revision detail (Diff Studio data) | 2.76 ms | 2.21 ms | 5.91 ms | 6,963 B |
| `pull_bundle_url` (build + sign) | 2.10 ms | 2.00 ms | 3.21 ms | 946 B |

The PostgreSQL text read path meets the millisecond target. The seed and all
ingest paths compute `o200k_base` tokens once; read responses reuse
`content_blobs.token_count` and the stored Markdown outline. `read_slice(full)`
tokenises only when it must truncate to `max_tokens`.

## Guardrails

- `crates/server/src/tokens.rs` is the single tokenizer entry point.
- `read_slice(outline)` never loads the whole file body; it renders the stored
  outline.
- `inspect_workspace` and `load_active_files` load active metadata in one join
  with only `left(text_content, 1024)` for descriptions, computing no tokens at
  read time.
- `collect_skill_entries` batch-loads `SKILL.md` blobs in a single `ANY($1)`
  query, while `skills/get` fetches only the requested skill.
- `propose_revision` reuses the active snapshot when `base_revision_id` is
  omitted or equals the active revision.
- `revision_files` uses joins rather than one query per file.
- The tokenizer is warmed at process start so the first outline read does not
  pay the vocabulary load.
- Contract tests assert the tool response fields, URI shape, digests and token
  totals so accidental response growth fails CI.

A release build is expected to be faster than these debug numbers; they are a
regression baseline, not a capacity claim.
