const MAX_CSV_LENGTH = 500_000;
const MAX_CSV_RECORDS = 50;

function rows(value: string) {
  const output: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (quoted) {
      if (character === '"' && value[index + 1] === '"') { cell += '"'; index++; }
      else if (character === '"') quoted = false;
      else cell += character;
    } else if (character === '"' && cell === "") quoted = true;
    else if (character === ",") { row.push(cell); cell = ""; }
    else if (character === "\n") { row.push(cell); output.push(row); row = []; cell = ""; }
    else if (character !== "\r") cell += character;
  }
  if (quoted) throw new Error("CSV contains an unclosed quoted field.");
  if (cell || row.length) { row.push(cell); output.push(row); }
  return output;
}

function possibleJson(value: string) {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return trimmed;
  try { return JSON.parse(trimmed); } catch { return trimmed; }
}

export function parseCsvCatalog(value: string): Record<string, unknown>[] {
  if (!value.trim() || value.length > MAX_CSV_LENGTH) throw new Error("CSV input is empty or too large.");
  const parsedRows = rows(value);
  if (parsedRows.length < 2 || parsedRows.length > MAX_CSV_RECORDS + 1) throw new Error(`CSV must contain a header and 1 to ${MAX_CSV_RECORDS} records.`);
  const headers = parsedRows[0].map((header) => header.trim().toLowerCase());
  const unsafeHeaders = new Set(["__proto__", "constructor", "prototype"]);
  if (headers.some((header) => !/^[a-z][a-z0-9_]{0,63}$/.test(header) || unsafeHeaders.has(header)) || new Set(headers).size !== headers.length) throw new Error("CSV headers must be unique, safe snake_case field names.");
  return parsedRows.slice(1).filter((row) => row.some((cell) => cell.trim())).map((row) =>
    Object.fromEntries(headers.map((header, index) => [header, possibleJson(row[index] ?? "")]))
  );
}
