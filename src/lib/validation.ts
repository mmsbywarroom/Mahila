/** Indian mobile: 10 digits, first digit 6–9. Rejects obvious dummy / sequential numbers. */
export function isValidIndianMobile10(digits: string): boolean {
  return validateIndianMobile10(digits) === null;
}

export function validateIndianMobile10(digits: string): string | null {
  const d = digits.replace(/\D/g, '');
  if (d.length !== 10) return 'Mobile number must be exactly 10 digits.';
  if (!/^[6-9]\d{9}$/.test(d)) return 'Mobile must start with 6, 7, 8, or 9.';
  if (isSuspiciousIndianMobile(d)) return 'This mobile number looks invalid. Please enter a real 10-digit number.';
  return null;
}

function isSuspiciousIndianMobile(d: string): boolean {
  if (/^(\d)\1{9}$/.test(d)) return true;
  const banned = new Set([
    '1234567890',
    '9876543210',
    '0123456789',
    '9988776655',
    '9090909090',
    '9898989898',
  ]);
  if (banned.has(d)) return true;
  const roll = '012345678901234567890';
  if (roll.includes(d) || '98765432109876543210'.includes(d)) return true;
  return false;
}

/** 12-digit Aadhaar format; rejects obvious dummy patterns (not UIDAI Verhoeff). */
export function validateAadhaar12(digits: string): string | null {
  const d = digits.replace(/\D/g, '');
  if (d.length !== 12) return 'Aadhaar number must be exactly 12 digits.';
  if (!/^\d{12}$/.test(d)) return 'Aadhaar must contain numbers only.';
  if (/^(\d)\1{11}$/.test(d)) return 'This Aadhaar number looks invalid.';
  const long = '012345678901234567890123456789012345678901234567890';
  if (long.includes(d)) return 'This Aadhaar number looks invalid.';
  return null;
}
