# Issue #714: `Escrow.getMilestones()` stale data after `releaseEscrow()`

## Findings

- `releaseEscrow` (`src/escrow/release.ts`) builds the `release_escrow` call and returns the transaction hash. It does not read or invalidate any cache.
- There is no `getMilestones` function, no `Escrow` class and no milestone cache in `src/` on `main`.
- `SimpleCache` (`src/utils/cache.ts`) exists, but nothing imports it.
- No open PR touches this code. The branches `feat/base-trustflow-client`, `feat/event-parsing-40`, `feat/zod-schemas-45` and `feat/eslint-prettier-41` have the same escrow files and no milestone code.

## Status

The bug cannot be reproduced or fixed from this repository as it is. The API described in the issue may live in another package, an unmerged branch, or a different repository. This note does not close the issue.

Refs #714
