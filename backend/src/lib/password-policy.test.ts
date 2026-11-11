import { describe, it, expect } from 'vitest';
import { isWeakPassword } from './password-policy';

describe('isWeakPassword', () => {
    it('rejects common passwords whatever the case', () => {
        for (const p of ['Password123', 'QWERTYUIOP', '1234567890', 'Welcome1234']) {
            expect(isWeakPassword(p)).toBe(true);
        }
    });

    it('rejects passwords with almost no variety', () => {
        for (const p of ['aaaaaaaaaaaa', 'ababababab', '1111111111']) {
            expect(isWeakPassword(p)).toBe(true);
        }
    });

    it('accepts normal passwords', () => {
        for (const p of ['StrongPass#2026', 'correct horse battery', 'Tr0ub4dor&3x!']) {
            expect(isWeakPassword(p)).toBe(false);
        }
    });
});