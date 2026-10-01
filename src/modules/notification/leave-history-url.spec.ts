/// <reference types="jest" />
import {
  isDepartmentApprover,
  isLeaderPosition,
  leaveHistoryUrlForRole,
} from './leave-history-url';

describe('leaveHistoryUrlForRole', () => {
  it.each([
    ['Employee', '/dashboard/user/history'],
    ['Manager', '/dashboard/manager/history'],
    ['HR', '/dashboard/hr/leave-history'],
    ['CEO', '/dashboard/ceo/dashboard'],
    [undefined, '/dashboard/user/history'],
    [null, '/dashboard/user/history'],
  ])('%s → %s', (role, url) => {
    expect(leaveHistoryUrlForRole(role)).toBe(url);
  });
});

describe('isLeaderPosition — only Leader is a department head', () => {
  it.each([
    ['Leader', true],
    ['Team Leader', true],
    ['leader', true],
    ['Manager', false],
    ['HR Manager', false],
    ['Asistance Project Manager', false],
    ['Programmer', false],
    [undefined, false],
  ])('%s → %s', (pos, expected) => {
    expect(isLeaderPosition(pos)).toBe(expected);
  });
});

describe('isDepartmentApprover (same rule as ManagerService access)', () => {
  it.each([
    ['Manager', 'Programmer', true],
    ['HR', 'Leader', true],
    // Business rule 2026-09-24: ONLY a Leader position is a department head
    ['HR', 'HR Manager', false],
    ['HR', 'Project Manager', false],
    ['HR', 'Team Leader', true],
    ['HR', 'HR Officer', false],
    ['Employee', 'Manager', false],
    ['CEO', 'CEO', false],
    [undefined, undefined, false],
  ])('role %s, position %s → %s', (role, pos, expected) => {
    expect(isDepartmentApprover(role, pos)).toBe(expected);
  });
});
