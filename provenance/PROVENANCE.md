# Orbital Trace Labs — provenance baseline

Status: recovery record. This baseline is **not** a continuation of the lost commit chain.

## What was lost

The working copy had been checkpointed in an isolated repository at `.cache/otl-repair`,
holding this chain of five commits:

```
75b7fb9 -> 86c59b9 -> 634fa8e -> 4cb0bbe -> de942de   (LOST)
```

A cloud VM restoration discarded `.cache/` and `node_modules/` wholesale, which removed
that repository and every object inside it. No push had ever been made from it.

## Recovery attempt (2026-11-03), before this baseline was created

| Probe | Result |
| --- | --- |
| `git cat-file -t` on 75b7fb9, 86c59b9, 634fa8e, 4cb0bbe, de942de | object not found (all five) |
| `git fsck --lost-found --dangling` | no recoverable commits or blobs |
| `git reflog --all` | only the two platform import entries |
| pack files (`.pack` / `.idx`) | none |
| `git stash list` | empty |
| `git remote -v` | no remotes configured on the platform repository |
| other `.git` directories, `.bundle`, patch, mirror in the workspace | none found |

Conclusion: the objects are gone and the chain cannot be reconstructed.

## This baseline

- Repository (git dir): `.cache/otl-provenance/snapshot.git`
- Work tree: the project root
- Branch: `provenance/phase2-landing`
- Root commit: `c06bcb5e5699f651caead61ee70ddb20a6c0db88` — **no parent**, deliberately
- Content: the complete working tree as verified on 2026-11-03 (Phase 2 repairs, landing
  page, tests, physics core, verification and evidence records, `artifacts/`, `docs/`,
  `scripts/`), staged from a dry-run that excluded `node_modules/`, `dist/`, `.cache/`
  and all `.env` files.

This commit does not continue `de942de` and claims no ancestry with it.

## Verification on the recorded tree

- `tsc --noEmit`: exit 0
- `vitest run`: exit 0, 17/17 test files passing
- `npm run build`: exit 0 (dist/assets/index-7Cw24UoP.css 14.68 kB, index-CKfP3iTB.js 576.01 kB)

## Pre-loss reference points (recorded only; not reachable from here)

- Platform shared repository HEAD at recovery time: `77dc9e5` "Import cloud project files" —
  its tree contains no project files; the entire working tree was untracked.
- The published Sites preview predates the Phase 2 repair.
- GitHub `bry92/orbital-trace-labs` was last known at `2ce2b98`; no remote is configured in
  this VM, so it was not consulted or altered.

## Limitation

`.cache/` is ignored by `.gitignore` and is discarded on VM restore, so this snapshot has
the same durability as the repository it replaces. To keep it, copy
`.cache/otl-provenance/snapshot.git` or `.cache/otl-provenance/otl-provenance.bundle`
off this VM. Re-create the baseline after any restore that removes `.cache/`.

---

# Backup durability

## This document is a companion, not commit content

`PROVENANCE.md` is **not** stored in commit `c06bcb5e5699f651caead61ee70ddb20a6c0db88`.
Verified two ways: `git ls-tree -r --name-only c06bcb5 | grep -c PROVENANCE.md` returns `0`,
and the bundle carries only `refs/heads/provenance/phase2-landing` plus `HEAD`. Restoring the
bundle therefore reproduces the 107-file tree with no provenance document inside it. That is
deliberate: the commit was accepted as-is and is not rewritten to absorb a document written
after it.

## Durable copies (outside the disposable `.cache` directory)

| File | Workspace path | Bytes | SHA-256 |
| --- | --- | --- | --- |
| Git bundle | `provenance/otl-provenance.bundle` | `5435920` | `f51bfde5299df4f9860924c46d7e4e09b5e77611cffcf62bbffcc960f5e28377` |
| This document | `provenance/PROVENANCE.md` | see `SHA256SUMS.txt` | see `SHA256SUMS.txt` |
| Hash manifest | `provenance/SHA256SUMS.txt` | — | self-referential, not listed |

A document cannot carry its own SHA-256, so the hash of `PROVENANCE.md` is recorded only in
`provenance/SHA256SUMS.txt`, which pins both files.

## Restore procedure

```sh
cd <workspace>
git clone provenance/otl-provenance.bundle restored-check
git -C restored-check rev-parse HEAD            # expect c06bcb5e5699f651caead61ee70ddb20a6c0db88
git -C restored-check rev-parse 'HEAD^{tree}'   # expect 07680ac8e7a4e2b5938a19f33d9f5f542535c970
git -C restored-check ls-files | wc -l          # expect 107
cd provenance && sha256sum -c SHA256SUMS.txt    # expect two OK lines
```

Verified on 2026-11-03 by cloning the durable bundle copy: HEAD and tree hash matched the
original snapshot repository exactly, 107 files restored, commit is a root commit (no parent).

## What survives a VM restore

The platform checkpoints the workspace files themselves, so `provenance/` survives a restore
that discards `.cache/`. The live snapshot repository at `.cache/otl-provenance/snapshot.git`
does **not** survive; it is reproducible from the durable bundle with the procedure above.
The commit is preserved either way: same SHA-1, same tree, no contents changed.
