// Busca local: nao envia texto ou nomes do contrato a servicos externos.
export type ContractTextMatch = { start: number; end: number };

export function findContractTextMatches(
  text: string,
  rawQuery: string,
  maxResults = 500,
): { matches: ContractTextMatch[]; truncated: boolean } {
  const query = rawQuery.trim();
  if (!query || !text || query.length > 150 || maxResults < 1) {
    return { matches: [], truncated: false };
  }

  const fold = (value: string) => value.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
  const needle = fold(query);
  if (!needle) return { matches: [], truncated: false };

  // Conservar os offsets UTF-16 do texto original ao remover acentos.
  let normalizedText = "";
  const starts: number[] = [];
  const ends: number[] = [];
  for (let offset = 0; offset < text.length;) {
    const character = String.fromCodePoint(text.codePointAt(offset)!);
    const normalized = fold(character);
    normalizedText += normalized;
    for (let index = 0; index < normalized.length; index++) {
      starts.push(offset);
      ends.push(offset + character.length);
    }
    offset += character.length;
  }

  const matches: ContractTextMatch[] = [];
  let cursor = 0;
  while (cursor < normalizedText.length) {
    const position = normalizedText.indexOf(needle, cursor);
    if (position < 0) break;
    if (matches.length >= maxResults) return { matches, truncated: true };
    const start = starts[position];
    const end = ends[position + needle.length - 1];
    if (start !== undefined && end !== undefined) matches.push({ start, end });
    cursor = position + Math.max(needle.length, 1);
  }
  return { matches, truncated: false };
}
