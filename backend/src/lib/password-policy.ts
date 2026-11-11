// Passwords that are far too common. Only entries of 10 characters or more matter,
// because shorter passwords are already refused by the length rule.
const COMMON = new Set([
    '1234567890', '12345678910', '0123456789', '1234567891', '9876543210',
    'qwertyuiop', 'qwerty12345', 'qwerty123456', '1q2w3e4r5t', 'asdfghjkl1', 'zxcvbnm123',
    'password123', 'password1234', 'password12345', 'passw0rd123', 'password!23',
    'iloveyou123', 'welcome123', 'welcome1234', 'welcome@123', 'changeme123', 'letmein1234',
    'administrator', 'admin123456', 'admin@12345', 'abcdefghij', 'abcd123456',
    'india@12345', 'india123456',
]);

export function isWeakPassword(password: string): boolean {
    const p = password.toLowerCase();
    if (COMMON.has(p)) return true;
    return new Set(p).size <= 3; // "aaaaaaaaaa", "abababababab"
}