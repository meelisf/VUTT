import { describe, expect, it } from 'vitest';
import { emailErrorKey } from '../AccountEmailSection';
import { ApiError } from '../../services/apiClient';

describe('emailErrorKey', () => {
  it('kaardistab serveri koodid', () => {
    expect(emailErrorKey(new ApiError('x', 403, { detail: 'wrong_password' }))).toBe('account.email.errors.wrongPassword');
    expect(emailErrorKey(new ApiError('x', 400, { detail: 'invalid_email' }))).toBe('account.email.errors.invalid');
    expect(emailErrorKey(new ApiError('x', 409, { detail: 'email_taken' }))).toBe('account.email.errors.taken');
    expect(emailErrorKey(new ApiError('x', 429, { detail: 'locked' }))).toBe('account.email.errors.locked');
  });

  it('tundmatu viga = üldine teade', () => {
    expect(emailErrorKey(new Error('võrk'))).toBe('account.email.errors.failed');
    expect(emailErrorKey(new ApiError('x', 500, null))).toBe('account.email.errors.failed');
  });
});
