/** Internal record identifiers must never be rendered in assistant responses. */
const INTERNAL_IDENTIFIER_PATTERNS = [
  /\bc[a-z0-9]{20,31}\b/gi,
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
] as const;

export function redactInternalIdentifiers(content: string): string {
  return INTERNAL_IDENTIFIER_PATTERNS.reduce(
    (result, pattern) => result.replace(pattern, '[内部编号已隐藏]'),
    content
  );
}
