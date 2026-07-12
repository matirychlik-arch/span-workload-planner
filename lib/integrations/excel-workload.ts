import { inflateRawSync } from 'node:zlib';
import { clamp, DAY_END_HOUR, DAY_START_HOUR } from '@/lib/domain/time';

export interface ExcelWorkloadEntry {
  employeeName: string;
  title: string;
  date: string;
  durationHours: number;
}

type ZipEntry = {
  method: number;
  compressedSize: number;
  localHeaderOffset: number;
  name: string;
};

type SheetRows = Map<number, Map<number, string | number>>;

const DATE_SERIAL_MIN = 20_000;
const DATE_SERIAL_MAX = 80_000;

function readUInt16(buffer: Buffer, offset: number): number {
  return buffer.readUInt16LE(offset);
}

function readUInt32(buffer: Buffer, offset: number): number {
  return buffer.readUInt32LE(offset);
}

function unzipXlsx(input: ArrayBuffer): Map<string, Buffer> {
  const buffer = Buffer.from(input);
  let eocdOffset = -1;
  for (let index = buffer.length - 22; index >= 0; index -= 1) {
    if (readUInt32(buffer, index) === 0x06054b50) {
      eocdOffset = index;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error('Nie udało się odczytać struktury XLSX.');

  const entryCount = readUInt16(buffer, eocdOffset + 10);
  const centralDirectoryOffset = readUInt32(buffer, eocdOffset + 16);
  const entries: ZipEntry[] = [];
  let offset = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (readUInt32(buffer, offset) !== 0x02014b50) break;
    const method = readUInt16(buffer, offset + 10);
    const compressedSize = readUInt32(buffer, offset + 20);
    const fileNameLength = readUInt16(buffer, offset + 28);
    const extraLength = readUInt16(buffer, offset + 30);
    const commentLength = readUInt16(buffer, offset + 32);
    const localHeaderOffset = readUInt32(buffer, offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + fileNameLength).toString('utf8');
    entries.push({ method, compressedSize, localHeaderOffset, name });
    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  const files = new Map<string, Buffer>();
  for (const entry of entries) {
    const localOffset = entry.localHeaderOffset;
    if (readUInt32(buffer, localOffset) !== 0x04034b50) continue;
    const fileNameLength = readUInt16(buffer, localOffset + 26);
    const extraLength = readUInt16(buffer, localOffset + 28);
    const dataStart = localOffset + 30 + fileNameLength + extraLength;
    const compressed = buffer.subarray(dataStart, dataStart + entry.compressedSize);
    if (entry.method === 0) {
      files.set(entry.name, compressed);
    } else if (entry.method === 8) {
      files.set(entry.name, inflateRawSync(compressed));
    }
  }
  return files;
}

function xmlDecode(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function attr(source: string, name: string): string | undefined {
  const match = source.match(new RegExp(`${name}="([^"]*)"`));
  return match ? xmlDecode(match[1]) : undefined;
}

function columnIndex(cellRef: string): number {
  const letters = cellRef.match(/[A-Z]+/)?.[0] ?? 'A';
  let output = 0;
  for (const letter of letters) {
    output = output * 26 + letter.charCodeAt(0) - 64;
  }
  return output - 1;
}

function parseSharedStrings(xml?: string): string[] {
  if (!xml) return [];
  const output: string[] = [];
  const matches = xml.match(/<si[\s\S]*?<\/si>/g) ?? [];
  for (const item of matches) {
    const texts = item.match(/<t[^>]*>[\s\S]*?<\/t>/g) ?? [];
    output.push(
      texts
        .map((text) => xmlDecode(text.replace(/<t[^>]*>/, '').replace(/<\/t>/, '')))
        .join('')
        .trim()
    );
  }
  return output;
}

function parseCellValue(cellXml: string, sharedStrings: string[]): string | number | undefined {
  const type = attr(cellXml, 't');
  const valueMatch = cellXml.match(/<v[^>]*>([\s\S]*?)<\/v>/);
  if (type === 'inlineStr') {
    const text = cellXml.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1];
    return text ? xmlDecode(text).trim() : undefined;
  }
  if (!valueMatch) return undefined;
  const raw = xmlDecode(valueMatch[1]);
  if (type === 's') return sharedStrings[Number(raw)] ?? '';
  if (type === 'str') return raw.trim();
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? numeric : raw.trim();
}

function parseFirstWorksheet(files: Map<string, Buffer>): SheetRows {
  const sharedStrings = parseSharedStrings(files.get('xl/sharedStrings.xml')?.toString('utf8'));
  const worksheetName = files.has('xl/worksheets/sheet1.xml')
    ? 'xl/worksheets/sheet1.xml'
    : Array.from(files.keys()).find((name) => name.startsWith('xl/worksheets/sheet'));
  if (!worksheetName) throw new Error('Nie znaleziono arkusza w pliku XLSX.');

  const xml = files.get(worksheetName)?.toString('utf8');
  if (!xml) throw new Error('Nie udało się odczytać pierwszego arkusza.');

  const rows: SheetRows = new Map();
  const rowMatches = xml.match(/<row\b[\s\S]*?<\/row>/g) ?? [];
  for (const rowXml of rowMatches) {
    const rowNumber = Number(attr(rowXml, 'r'));
    if (!Number.isFinite(rowNumber)) continue;
    const cells = new Map<number, string | number>();
    const cellMatches = rowXml.match(/<c\b[\s\S]*?<\/c>/g) ?? [];
    for (const cellXml of cellMatches) {
      const ref = attr(cellXml, 'r');
      if (!ref) continue;
      const value = parseCellValue(cellXml, sharedStrings);
      if (value === undefined || value === '') continue;
      cells.set(columnIndex(ref), value);
    }
    if (cells.size > 0) rows.set(rowNumber - 1, cells);
  }
  return rows;
}

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .replace(/\r?\n+/g, ' / ')
    .replace(/\s+/g, ' ')
    .trim();
}

function employeeToken(value: string): string {
  return normalizeText(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')[0] ?? '';
}

function parseDate(value: string | number | undefined): string | null {
  if (typeof value === 'number' && value >= DATE_SERIAL_MIN && value <= DATE_SERIAL_MAX) {
    const date = new Date(Date.UTC(1899, 11, 30));
    date.setUTCDate(date.getUTCDate() + Math.floor(value));
    return date.toISOString().slice(0, 10);
  }
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  }
  return null;
}

function parseDuration(value: string | number | undefined, title: string): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return clamp(Math.round(value), 1, DAY_END_HOUR - DAY_START_HOUR);
  }
  const text = normalizeText(value).replace(',', '.');
  const match = text.match(/\d+(\.\d+)?/);
  if (match) return clamp(Math.round(Number(match[0])), 1, DAY_END_HOUR - DAY_START_HOUR);
  if (/urlop|święto|boże ciało/i.test(title)) return 8;
  return 1;
}

function isNoiseTitle(title: string): boolean {
  return !title || /^suma$/i.test(title) || /^\d+(\.\d+)?$/.test(title);
}

export function parseExcelWorkload(input: ArrayBuffer, knownEmployeeNames: string[] = []): ExcelWorkloadEntry[] {
  const rows = parseFirstWorksheet(unzipXlsx(input));
  const headerRowIndex = Array.from(rows.entries()).find(
    ([, cells]) => normalizeText(cells.get(0)).toLowerCase() === 'osoba'
  )?.[0];
  if (headerRowIndex === undefined) {
    throw new Error('Nie znalazłem nagłówka OSOBA w Excelu.');
  }

  const header = rows.get(headerRowIndex);
  if (!header) return [];
  const dateColumns = Array.from(header.entries())
    .map(([column, value]) => ({ column, date: parseDate(value) }))
    .filter((item): item is { column: number; date: string } => Boolean(item.date));

  const knownEmployeeTokens = new Set(knownEmployeeNames.map(employeeToken).filter(Boolean));
  const employeeStarts = Array.from(rows.entries())
    .filter(([rowIndex, cells]) => rowIndex > headerRowIndex && typeof cells.get(0) === 'string')
    .map(([rowIndex, cells]) => ({ rowIndex, name: normalizeText(cells.get(0)) }))
    .filter((item) => {
      if (!item.name || /^suma$/i.test(item.name)) return false;
      return knownEmployeeTokens.size === 0 || knownEmployeeTokens.has(employeeToken(item.name));
    });

  const output: ExcelWorkloadEntry[] = [];
  for (let index = 0; index < employeeStarts.length; index += 1) {
    const employee = employeeStarts[index];
    const nextStart = employeeStarts[index + 1]?.rowIndex ?? Math.max(...Array.from(rows.keys())) + 1;
    for (let rowIndex = employee.rowIndex; rowIndex < nextStart; rowIndex += 1) {
      const cells = rows.get(rowIndex);
      if (!cells) continue;
      for (const { column, date } of dateColumns) {
        const title = normalizeText(cells.get(column));
        if (isNoiseTitle(title)) continue;
        output.push({
          employeeName: employee.name,
          title,
          date,
          durationHours: parseDuration(cells.get(column + 1), title)
        });
      }
    }
  }

  return output;
}

export function inferEpicName(title: string): string {
  const clean = normalizeText(title).replace(/^✅\s*/, '');
  if (/urlop|boże ciało|święto/i.test(clean)) return 'Nieobecności';
  const firstLine = clean.split('/')[0]?.trim() ?? clean;
  const candidate = firstLine.split(/\s[-–—:]\s/)[0]?.trim() ?? firstLine;
  if (candidate.length >= 3 && candidate.length <= 32) return candidate;
  return 'Excel import';
}
