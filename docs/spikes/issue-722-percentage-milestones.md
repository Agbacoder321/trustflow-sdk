# Spike: percentage-based milestone splits (#722)

Status: partial. The contract and builder were read. No prototype was built or run against testnet.

## Findings

- **Builder.** `EscrowBuilder.addMilestone` takes `amount: bigint` in absolute
  stroops. `build()` checks that every milestone amount is positive and that
  the sum does not exceed the total escrow amount.
- **Contract.** The contract source is not in this repository, so whether it
  stores percentages or only absolute amounts is unverified. Until someone
  reads the contract, assume absolute amounts. That matches the SDK today.
- **Consequence.** The SDK can support percentages client-side without a
  contract change, as long as the percentages are converted to stroops before
  the escrow is created.

## Proposed rounding rule

1. Require integer percentages that sum to exactly 100.
2. Compute each milestone as `floor(total * pct / 100)` in `bigint`.
3. Give the remainder (`total - sum of floors`, at most `n - 1` stroops, where
   `n` is the number of milestones) to the last milestone, so the parts always
   add up to the total.

Example: total 10 stroops, split `[33, 33, 34]`. Floors are `3, 3, 3`, and the
remainder of `1` goes to the last milestone, giving `3, 3, 4`.

## Proposed API

`EscrowBuilder.setMilestonesByPercentage([30, 70])` converts to absolute
milestones at `build()`, using the rule above. It rejects percentages that do
not sum to 100, and any percentage that is not a positive integer.

## Open questions

- Confirm the contract's milestone representation (see Findings).
- Decide whether the remainder should go to the last milestone or be spread
  one stroop at a time from the first.
- Batching (#721) may need to chunk milestones; percentage conversion should
  happen before chunking.
