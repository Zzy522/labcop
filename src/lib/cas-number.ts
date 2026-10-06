/** Validate the CAS Registry Number check digit without making a network request. */
export function isValidCasNumber(value: string): boolean {
  const match = /^(\d{2,7})-(\d{2})-(\d)$/.exec(value.trim());
  if (!match) return false;

  const digits = `${match[1]}${match[2]}`;
  const checksum = [...digits]
    .reverse()
    .reduce((sum, digit, index) => sum + Number(digit) * (index + 1), 0);
  return checksum % 10 === Number(match[3]);
}
