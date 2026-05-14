const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

function decodeEntity(entity: string) {
  const normalized = entity.toLowerCase();
  if (normalized.startsWith("#x")) {
    const codePoint = Number.parseInt(normalized.slice(2), 16);
    return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : `&${entity};`;
  }
  if (normalized.startsWith("#")) {
    const codePoint = Number.parseInt(normalized.slice(1), 10);
    return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : `&${entity};`;
  }
  return NAMED_ENTITIES[normalized] ?? `&${entity};`;
}

export function decodeHtmlEntities(raw: string) {
  return raw.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, entity: string) => decodeEntity(entity));
}

export function stripHtmlToText(raw: string) {
  return decodeHtmlEntities(raw)
    .replace(/\r/g, "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/?(?:p|div|section|article|blockquote|ul|ol)\b[^>]*>/gi, "\n\n")
    .replace(/<\s*li\b[^>]*>/gi, "\n- ")
    .replace(/<\s*\/li\s*>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\u00a0/g, " ")
    .trim();
}
