// Daily auto-assignment of overdue loans to field officers, by pincode and workload.
//
// Rules, in order:
// 1. Continuity: if the loan's current officer still covers its pincode and is under cap, keep it.
//    Borrowers deal with the same person, and officers keep context.
// 2. Pincode match: otherwise give it to the least-loaded officer who covers the pincode and is under cap.
// 3. Branch overflow: if every pincode officer is full, give it to the least-loaded officer in the
//    same branch who is under cap.
// 4. Unassigned: pincode not covered, or the whole branch is full. The manager assigns by hand.
// Ties go to the officer whose name sorts first, so the same file always gives the same result.
import type { AssignRule } from './types';

export interface AssignOfficer {
  id: string;
  name: string;
  branchId: string;
  pincodes: string[];
  load: number; // open loans already assigned (not counting this batch)
  cap: number;
}

export interface AssignInput {
  loanId: string;
  pincode: string;
  currentOfficerId: string | null;
}

export interface Assignment {
  loanId: string;
  officerId: string | null;
  rule: AssignRule;
  note: string;
}

export function assignLoans(loans: AssignInput[], officers: AssignOfficer[]): Assignment[] {
  const pool = officers.map((o) => ({ ...o }));
  const byId = new Map(pool.map((o) => [o.id, o]));
  const byName = (a: AssignOfficer, b: AssignOfficer) => a.load - b.load || a.name.localeCompare(b.name);
  const branchOfPincode = (pin: string) => pool.find((o) => o.pincodes.includes(pin))?.branchId ?? null;

  return loans.map((loan): Assignment => {
    const current = loan.currentOfficerId ? byId.get(loan.currentOfficerId) : undefined;
    if (current && current.pincodes.includes(loan.pincode)) {
      // The loan already counts towards this officer's load.
      if (current.load <= current.cap) {
        return { loanId: loan.loanId, officerId: current.id, rule: 'kept', note: `Stays with ${current.name}` };
      }
      current.load -= 1; // over cap: release it and reassign below
    } else if (current) {
      current.load -= 1; // officer no longer covers this pincode
    }

    const candidates = pool.filter((o) => o.pincodes.includes(loan.pincode) && o.load < o.cap).sort(byName);
    if (candidates.length > 0) {
      const o = candidates[0];
      o.load += 1;
      return {
        loanId: loan.loanId,
        officerId: o.id,
        rule: 'pincode_least_load',
        note: `Covers ${loan.pincode}; lightest load (${o.load - 1} open)`,
      };
    }

    const branch = branchOfPincode(loan.pincode);
    if (!branch) {
      return { loanId: loan.loanId, officerId: null, rule: 'unassigned', note: `No officer covers pincode ${loan.pincode}` };
    }
    const overflow = pool.filter((o) => o.branchId === branch && o.load < o.cap).sort(byName);
    if (overflow.length > 0) {
      const o = overflow[0];
      o.load += 1;
      return {
        loanId: loan.loanId,
        officerId: o.id,
        rule: 'branch_overflow',
        note: `Pincode officers full; ${o.name} has room in the branch`,
      };
    }
    return { loanId: loan.loanId, officerId: null, rule: 'unassigned', note: 'Every officer in this branch is at capacity' };
  });
}
