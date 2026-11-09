import { describe, expect, it } from 'vitest';
import { assignLoans, type AssignOfficer } from '../src/shared/assignment';

const officers: AssignOfficer[] = [
  { id: 'rahul', name: 'Rahul', branchId: 'IND', pincodes: ['452001', '452010'], load: 10, cap: 12 },
  { id: 'neha', name: 'Neha', branchId: 'IND', pincodes: ['452010', '452015'], load: 4, cap: 12 },
  { id: 'imran', name: 'Imran', branchId: 'IND', pincodes: ['452016'], load: 0, cap: 12 },
  { id: 'arjun', name: 'Arjun', branchId: 'PTP', pincodes: ['454775'], load: 2, cap: 12 },
];

describe('assignLoans', () => {
  it('keeps a loan with its current officer when they still cover the pincode (continuity)', () => {
    const [a] = assignLoans([{ loanId: 'L1', pincode: '452010', currentOfficerId: 'rahul' }], officers);
    expect(a.officerId).toBe('rahul');
    expect(a.rule).toBe('kept');
  });

  it('assigns a new loan to the least-loaded officer covering its pincode', () => {
    const [a] = assignLoans([{ loanId: 'L2', pincode: '452010', currentOfficerId: null }], officers);
    expect(a.officerId).toBe('neha');
    expect(a.rule).toBe('pincode_least_load');
  });

  it('updates load as it goes, so a batch spreads across officers', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ loanId: `N${i}`, pincode: '452010', currentOfficerId: null }));
    const result = assignLoans(many, officers);
    const counts = result.reduce<Record<string, number>>((acc, a) => {
      acc[a.officerId!] = (acc[a.officerId!] ?? 0) + 1;
      return acc;
    }, {});
    // Neha starts at 4, Rahul at 10: Neha takes 6 to draw level, then they alternate (ties go by name).
    expect(counts).toEqual({ neha: 8, rahul: 2 });
  });

  it('overflows to the least-loaded officer in the same branch when pincode officers are full', () => {
    const full = officers.map((o) => (o.pincodes.includes('452001') ? { ...o, load: o.cap } : o));
    const [a] = assignLoans([{ loanId: 'L3', pincode: '452001', currentOfficerId: null }], full);
    expect(a.rule).toBe('branch_overflow');
    expect(a.officerId).toBe('imran');
  });

  it('moves a loan off an officer who is over capacity', () => {
    const over = officers.map((o) => (o.id === 'rahul' ? { ...o, load: 13 } : o));
    const [a] = assignLoans([{ loanId: 'L4', pincode: '452010', currentOfficerId: 'rahul' }], over);
    expect(a.officerId).toBe('neha');
  });

  it('leaves loans with an uncovered pincode unassigned for the manager', () => {
    const [a] = assignLoans([{ loanId: 'L5', pincode: '999999', currentOfficerId: null }], officers);
    expect(a.officerId).toBeNull();
    expect(a.rule).toBe('unassigned');
    expect(a.note).toMatch(/999999/);
  });

  it('never assigns across branches', () => {
    const [a] = assignLoans([{ loanId: 'L6', pincode: '454775', currentOfficerId: null }], officers);
    expect(a.officerId).toBe('arjun');
  });

  it('breaks ties by name so results are stable', () => {
    const tied: AssignOfficer[] = [
      { id: 'b', name: 'Bela', branchId: 'X', pincodes: ['1'], load: 0, cap: 5 },
      { id: 'a', name: 'Asha', branchId: 'X', pincodes: ['1'], load: 0, cap: 5 },
    ];
    const [a] = assignLoans([{ loanId: 'T', pincode: '1', currentOfficerId: null }], tied);
    expect(a.officerId).toBe('a');
  });
});
