import { describe, expect, it } from 'vitest';
import { ApiError } from '../../services/apiClient';
import { isSessionExpired } from '../apiErrorText';

describe('isSessionExpired', () => {
  it('401 tähendab surnud sessiooni', () => {
    expect(isSessionExpired(new ApiError('Autentimine nõutud', 401))).toBe(true);
  });

  it('muu staatus ei ole sessiooni aegumine', () => {
    expect(isSessionExpired(new ApiError('Keelatud', 403))).toBe(false);
    expect(isSessionExpired(new ApiError('Serveri viga', 500))).toBe(false);
  });

  it('võrguviga ilma staatuseta ei ole sessiooni aegumine', () => {
    // Võrgukatkestus ja väljalogimine vajavad ERI vastust: esimesel tasub
    // uuesti proovida, teisel uuesti sisse logida.
    expect(isSessionExpired(new Error('Failed to fetch'))).toBe(false);
    expect(isSessionExpired(null)).toBe(false);
  });
});
