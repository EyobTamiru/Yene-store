/**
 * ============================================================================
 *  FREELANCER EARNINGS - release rules
 * ============================================================================
 *
 *  Pure decision functions. A job's earnings are PENDING when it completes and
 *  only become AVAILABLE once the applicable conditions are met, and which
 *  conditions apply is CONFIGURABLE rather than hardcoded (Part 5).
 *
 *  WHY PENDING IS NOT A DISPLAY CONVENTION
 *  ---------------------------------------
 *  Pending money lives in a different wallet BUCKET from available money, and
 *  `checkWithdrawalAllowed` reads only the available bucket. So "a freelancer
 *  cannot withdraw earnings that have not cleared their dispute window" is
 *  enforced by where the money is, not by a check somebody could forget to add
 *  to the withdrawal path. That is the difference between a rule and a
 *  convention.
 *
 *  THE RELEASE GATES, AND WHY EACH EXISTS
 *  -------------------------------------
 *   completion        the work is actually done
 *   customerApproved  the customer accepted it, so nobody disputes later
 *   disputeWindow     time has passed with no dispute raised
 *   adminReview       a human checked it (high-value jobs, flagged orders)
 *
 *  A category of work can require any subset, and `requiredGates` is the AND of
 *  them - so configuring all four makes release impossible until a human
 *  intervenes, which is the correct reading of a strict policy, not a bug.
 */

import type { Minor } from "./money";

/** The conditions that can gate the release of an earning. */
export type ReleaseGate = "completion" | "customerApproved" | "disputeWindow" | "adminReview";

export const RELEASE_GATES: ReleaseGate[] = [
  "completion",
  "customerApproved",
  "disputeWindow",
  "adminReview",
];

/** Which gates a category of work requires. Administrator-configurable. */
export interface EarningReleasePolicy {
  /** The gates that must ALL be satisfied. */
  requiredGates: ReleaseGate[];
  /** How long the dispute window lasts, in days. */
  disputeWindowDays: number;
  /** Jobs at or above this amount always require an administrator review. */
  adminReviewAbove: Minor;
}

/** The shipped default: completed, customer-approved, then a 7-day window. */
export const DEFAULT_RELEASE_POLICY: EarningReleasePolicy = {
  requiredGates: ["completion", "customerApproved", "disputeWindow"],
  disputeWindowDays: 7,
  adminReviewAbove: 50_000_00,
};

/** Everything known about a job at the moment a release is considered. */
export interface EarningFacts {
  completed: boolean;
  customerApproved: boolean;
  /** A dispute is open. Blocks release for as long as it is. */
  disputed: boolean;
  adminApproved: boolean;
  /** When the job was completed, in ISO-8601. */
  completedAt: string | null;
  /** The gross job amount, used for the admin-review threshold. */
  gross: Minor;
}

export interface ReleaseDecision {
  releasable: boolean;
  /** Each gate and whether it is satisfied, for the admin UI. */
  gates: { gate: ReleaseGate; satisfied: boolean; note: string }[];
  /** The earliest moment this could release, when a date is the only blocker. */
  releasableAt: string | null;
  reason: string | null;
}

/**
 * Decide whether an earning may move from pending to available.
 *
 * A DISPUTE OVERRIDES EVERYTHING. It is checked first and is deliberately not
 * one of the configurable gates, because a policy that lets an administrator
 * release money on a disputed job can pay out against a customer who is
 * actively saying the work was never delivered.
 *
 * `now` is a parameter rather than a call to `Date.now()` so the rule is
 * testable at its boundary: a suite can assert on a job whose window closes at
 * exactly this instant.
 */
export function decideRelease(
  facts: EarningFacts,
  policy: EarningReleasePolicy = DEFAULT_RELEASE_POLICY,
  now: number = Date.now(),
): ReleaseDecision {
  if (facts.disputed) {
    return {
      releasable: false,
      gates: [{ gate: "completion", satisfied: false, note: "Blocked: this job is under dispute." }],
      releasableAt: null,
      reason: "This job is under dispute, so the earnings are held until it is resolved.",
    };
  }

  // A job at or above the review threshold always needs a human, whatever the
  // configured gates say. A value-based control, so it sits outside the config.
  const needsAdmin = facts.gross >= policy.adminReviewAbove;
  const effectiveGates = needsAdmin
    ? [...new Set([...policy.requiredGates, "adminReview" as ReleaseGate])]
    : policy.requiredGates;

  const completedAtMs = facts.completedAt ? new Date(facts.completedAt).getTime() : null;
  const gates: ReleaseDecision["gates"] = [];

  for (const gate of effectiveGates) {
    switch (gate) {
      case "completion":
        gates.push({
          gate,
          satisfied: facts.completed,
          note: facts.completed ? "Job completed" : "Waiting for the job to be completed",
        });
        break;
      case "customerApproved":
        gates.push({
          gate,
          satisfied: facts.customerApproved,
          note: facts.customerApproved
            ? "Approved by the customer"
            : "Waiting for customer approval",
        });
        break;
      case "disputeWindow": {
        // The window starts when the job actually FINISHED, so a job that took a
        // month to deliver still gets its full window afterwards.
        const windowEndsAt =
          completedAtMs === null ? null : completedAtMs + dayMs(policy.disputeWindowDays);
        const satisfied = windowEndsAt !== null && windowEndsAt <= now;
        const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
        gates.push({
          gate,
          satisfied,
          note:
            windowEndsAt === null
              ? "Waiting for completion"
              : satisfied
                ? `Dispute window closed on ${day(windowEndsAt)}`
                : `Dispute window closes on ${day(windowEndsAt)}`,
        });
        break;
      }
      case "adminReview":
        gates.push({
          gate,
          satisfied: facts.adminApproved,
          note: facts.adminApproved
            ? "Reviewed by an administrator"
            : "Waiting for an administrator review",
        });
        break;
    }
  }

  const blocking = gates.filter((gate) => !gate.satisfied);
  const releasable = blocking.length === 0;

  // The soonest release time, so the UI can say "available on the 12th" rather
  // than an indefinite "pending". Only meaningful when a DATE is the sole
  // blocker, so a pending human gate suppresses it.
  let releasableAt: string | null = null;
  const onlyDates = blocking.length > 0 && blocking.every((gate) => gate.gate === "disputeWindow");
  if (onlyDates && completedAtMs !== null) {
    releasableAt = new Date(completedAtMs + dayMs(policy.disputeWindowDays)).toISOString();
  }

  return {
    releasable,
    gates,
    releasableAt,
    reason: releasable ? null : blocking.map((gate) => gate.note).join("; "),
  };
}


function dayMs(days: number): number {
  return days * 24 * 60 * 60 * 1000;
}
