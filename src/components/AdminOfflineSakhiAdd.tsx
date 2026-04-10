import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { authHeadersJson, authUrl, parseJsonResponse } from '../lib/api';
import { ArrowLeft, FileSpreadsheet, Upload } from 'lucide-react';

interface AdminOfflineSakhiAddProps {
  onBack?: () => void;
  embedded?: boolean;
}

const ADMIN_USER_ID = 'admin';
const ADMIN_PASSWORD = 'admin@123';

type RowStatus = 'ok' | 'mismatch' | 'not_found';

interface ParsedCsvRow {
  applicantName: string;
  mobile: string;
  fatherName: string;
  dob: string;
  gender: string;
  epic: string;
  aadhaar: string;
  altMobile: string;
  district: string;
  halka: string;
  tehsil: string;
  region: string;
  booth: string;
}

interface ValidateResultRow {
  rowIndex: number;
  status: RowStatus;
  epic: string;
  mismatchedFields: string[];
  csv: ParsedCsvRow;
  /** Original CSV row cells, same order as `csvHeaders` */
  rawCells: string[];
  roll: {
    full_name: string | null;
    father_or_husband: string | null;
    sex: string | null;
    age: number | null;
    halka: string | null;
    booth: string | null;
  } | null;
}

interface ImportAssemblyStats {
  assembly: string;
  inserted: number;
  skipped: number;
  reasons: Record<string, number>;
}

interface ImportSummary {
  inserted: number;
  skipped: number;
  assemblyStats: ImportAssemblyStats[];
  reasonSummary: Record<string, number>;
  errors: Array<{ epic: string; mobile: string; assembly?: string; reason?: string; message: string }>;
}

const HEADER_ALIASES: Record<keyof ParsedCsvRow, string[]> = {
  applicantName: [
    'applicantfullname',
    'applicantname',
    'name',
    'fullname',
    'full name',
    'applicant name',
  ],
  mobile: ['mobilenumber', 'mobile', 'phone', 'contact'],
  fatherName: [
    'fathershusbandsname',
    'fathershusbandname',
    'fatherhusband',
    'father',
    'husband',
    'father name',
    'fathers name',
    'fatherhusbandname',
  ],
  dob: ['dateofbirth', 'dob', 'birthdate', 'birth date'],
  gender: ['gender', 'sex'],
  epic: [
    'epicnumber',
    'epicnumbervoterid',
    'epicnovoterid',
    'epic',
    'voterid',
    'voter id',
    'voteridentity',
    'electionphotoidentity',
    'vcardid',
    'epicno',
  ],
  aadhaar: ['aadhaarnumber', 'aadhaar', 'uid', 'aadhar'],
  altMobile: ['alternatemobilenumber', 'altmobile', 'alt mobile', 'alternate mobile', 'alternatephone'],
  district: ['district'],
  halka: ['halkaname', 'halka', 'assembly', 'acname'],
  tehsil: ['tehsil'],
  region: ['region'],
  booth: ['boothnumber', 'boothno', 'booth', 'pollingbooth'],
};

function parseCsvRows(csvText: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i += 1) {
    const ch = csvText[i];
    const next = csvText[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === ',' && !inQuotes) {
      row.push(cell.trim());
      cell = '';
      continue;
    }

    if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && next === '\n') i += 1;
      row.push(cell.trim());
      const hasAnyValue = row.some((c) => c.length > 0);
      if (hasAnyValue) rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += ch;
  }

  row.push(cell.trim());
  if (row.some((c) => c.length > 0)) rows.push(row);
  return rows;
}

function stripBom(value: string): string {
  return value.replace(/^\uFEFF/, '');
}

/** Normalize header for alias lookup: ignore case, parentheses, most punctuation. */
function normalizeHeader(value: string): string {
  return stripBom(value)
    .trim()
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[''`"]/g, '')
    .replace(/[\s/_.:,;|+]+/g, '')
    .replace(/[^a-z0-9\u0900-\u097F]+/g, '');
}

/** Looks like an Indian EPIC (letters + digits, not a tiny integer). */
function cellLooksLikeEpic(s: string): boolean {
  const t = String(s ?? '').replace(/\s/g, '').toUpperCase();
  if (t.length < 6) return false;
  if (/^\d{1,4}$/.test(t)) return false;
  return /^[A-Z]{2,6}\d{4,10}[A-Z0-9]*$/i.test(t) || /^[A-Z]\d{6,12}$/i.test(t);
}

function guessEpicColumnIndex(headers: string[], headerMap: Map<string, number>): number {
  const direct = resolveColumnIndex(headerMap, 'epic');
  if (direct >= 0) return direct;
  for (let i = 0; i < headers.length; i += 1) {
    const raw = stripBom(headers[i] ?? '').toLowerCase();
    const n = normalizeHeader(headers[i] ?? '');
    if (/\bepic\b/.test(raw) || /\bvoter\s*id\b/.test(raw) || /\bvcardid\b/.test(raw)) return i;
    if (n.includes('epic') && (n.includes('voter') || n.includes('number') || n.includes('id'))) return i;
  }
  return -1;
}

function pickEpicFromRow(cells: string[], epicCol: number): string {
  if (epicCol >= 0 && epicCol < cells.length) {
    const v = String(cells[epicCol] ?? '').trim();
    if (cellLooksLikeEpic(v)) return v.replace(/\s/g, '');
  }
  for (let i = 0; i < cells.length; i += 1) {
    const v = String(cells[i] ?? '').trim();
    if (cellLooksLikeEpic(v)) return v.replace(/\s/g, '');
  }
  if (epicCol >= 0 && epicCol < cells.length) return String(cells[epicCol] ?? '').trim().replace(/\s/g, '');
  return '';
}

function buildHeaderToIndex(headers: string[]): Map<string, number> {
  const map = new Map<string, number>();
  headers.forEach((h, i) => {
    map.set(normalizeHeader(h), i);
  });
  return map;
}

function padRowToLength(cells: string[], len: number): string[] {
  const out = cells.slice();
  while (out.length < len) out.push('');
  return out;
}

function mapCellsToParsedRow(
  cells: string[],
  headerMap: Map<string, number>,
  epicCol: number
): ParsedCsvRow {
  const row = emptyRow();
  const keys = Object.keys(HEADER_ALIASES) as (keyof ParsedCsvRow)[];
  for (const k of keys) {
    if (k === 'epic') continue;
    const idx = resolveColumnIndex(headerMap, k);
    if (idx >= 0 && idx < cells.length) row[k] = cells[idx] ?? '';
  }
  row.epic = pickEpicFromRow(cells, epicCol);
  return row;
}

function resolveColumnIndex(headerMap: Map<string, number>, field: keyof ParsedCsvRow): number {
  const aliases = HEADER_ALIASES[field];
  for (const a of aliases) {
    const idx = headerMap.get(normalizeHeader(a));
    if (idx !== undefined) return idx;
  }
  return -1;
}

/** Which ParsedCsvRow field (if any) owns CSV column index `j` — used to avoid duplicating rawCells in DB saves. */
function columnFieldForIndex(
  headerMap: Map<string, number>,
  headers: string[],
  j: number
): keyof ParsedCsvRow | null {
  const keys = Object.keys(HEADER_ALIASES) as (keyof ParsedCsvRow)[];
  for (const k of keys) {
    if (resolveColumnIndex(headerMap, k) === j) return k;
  }
  const epicCol = guessEpicColumnIndex(headers, headerMap);
  if (epicCol === j) return 'epic';
  return null;
}

function listUnmappedColumnIndices(headers: string[]): number[] {
  const headerMap = buildHeaderToIndex(headers);
  const out: number[] = [];
  for (let j = 0; j < headers.length; j += 1) {
    if (columnFieldForIndex(headerMap, headers, j) === null) out.push(j);
  }
  return out;
}

/** Rebuild per-column display values after loading a thin-saved row (csv + optional extraCells for unmapped cols). */
function rehydrateRawCellsFromSaved(
  headers: string[],
  csv: ParsedCsvRow,
  extraCells?: Record<string, string> | Record<number, string> | null
): string[] {
  const headerMap = buildHeaderToIndex(headers);
  const getExtra = (j: number): string => {
    if (!extraCells) return '';
    const rec = extraCells as Record<string, string> & Record<number, string>;
    const v = rec[j] ?? rec[String(j)];
    return v != null ? String(v) : '';
  };
  return headers.map((_, j) => {
    const f = columnFieldForIndex(headerMap, headers, j);
    if (f === 'epic') return String(csv.epic ?? '');
    if (f) return String(csv[f] ?? '');
    return getExtra(j);
  });
}

function normalizeResultRowsFromDb(rows: unknown[], headers: string[]): ValidateResultRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    const r = row as ValidateResultRow & { extraCells?: Record<number, string> };
    if (Array.isArray(r.rawCells) && r.rawCells.length >= headers.length) {
      return r;
    }
    const rawCells = rehydrateRawCellsFromSaved(headers, r.csv, r.extraCells);
    return { ...r, rawCells };
  });
}

function emptyRow(): ParsedCsvRow {
  return {
    applicantName: '',
    mobile: '',
    fatherName: '',
    dob: '',
    gender: '',
    epic: '',
    aadhaar: '',
    altMobile: '',
    district: '',
    halka: '',
    tehsil: '',
    region: '',
    booth: '',
  };
}

interface ParsedUpload {
  headers: string[];
  bodyRows: string[][];
  parsedRows: ParsedCsvRow[];
}

function mapGridToUpload(grid: string[][]): ParsedUpload | null {
  if (grid.length < 2) return null;
  const headers = (grid[0] ?? []).map((h) => stripBom(h.trim()));
  const headerMap = buildHeaderToIndex(headers);
  const epicCol = guessEpicColumnIndex(headers, headerMap);
  const bodyRows: string[][] = [];
  const parsedRows: ParsedCsvRow[] = [];
  for (let r = 1; r < grid.length; r += 1) {
    const cells = grid[r] ?? [];
    const row = mapCellsToParsedRow(cells, headerMap, epicCol);
    const any =
      Object.values(row).some((v) => String(v).trim()) ||
      cells.some((c) => String(c).trim());
    if (any) {
      bodyRows.push(cells);
      parsedRows.push(row);
    }
  }
  if (parsedRows.length === 0) return null;
  return { headers, bodyRows, parsedRows };
}

function statusLabel(s: RowStatus): string {
  if (s === 'ok') return 'Match';
  if (s === 'mismatch') return 'EPIC found — details differ';
  return 'EPIC not in roll';
}

function rowBg(status: RowStatus): string {
  if (status === 'ok') return 'bg-emerald-50 hover:bg-emerald-100/80';
  if (status === 'mismatch') return 'bg-red-50 hover:bg-red-100/80';
  return 'bg-amber-50 hover:bg-amber-100/80';
}

export default function AdminOfflineSakhiAdd({ onBack, embedded }: AdminOfflineSakhiAddProps) {
  const [fileName, setFileName] = useState('');
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState<{ ok: number; mismatch: number; not_found: number; total: number } | null>(
    null
  );
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [results, setResults] = useState<ValidateResultRow[]>([]);
  const [selectedHalka, setSelectedHalka] = useState<string>('all');
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  /** After load from DB or successful save */
  const [persistNotice, setPersistNotice] = useState('');
  /** If user picks a CSV before latest-report fetch finishes, do not overwrite */
  const userChoseNewFileRef = useRef(false);

  const halkaColIndex = useMemo(
    () => csvHeaders.findIndex((h) => /halka|assembly|ac/i.test(String(h ?? ''))),
    [csvHeaders]
  );

  const rowHalka = useCallback(
    (row: ValidateResultRow): string => {
      const direct = String(row.csv.halka ?? '').trim();
      if (direct) return direct;
      if (halkaColIndex >= 0) {
        const fallback = String(row.rawCells[halkaColIndex] ?? '').trim();
        if (fallback) return fallback;
      }
      return '—';
    },
    [halkaColIndex]
  );

  const halkaOptions = useMemo(() => {
    const s = new Set<string>();
    for (const r of results) s.add(rowHalka(r));
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [results, rowHalka]);

  const filteredResults = useMemo(() => {
    if (selectedHalka === 'all') return results;
    return results.filter((r) => rowHalka(r) === selectedHalka);
  }, [results, rowHalka, selectedHalka]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(authUrl('admin-offline-sakhi-report-latest'), {
          method: 'POST',
          headers: authHeadersJson(),
          body: JSON.stringify({ userId: ADMIN_USER_ID, password: ADMIN_PASSWORD }),
        });
        const data = await parseJsonResponse(response);
        if (cancelled || userChoseNewFileRef.current || !data?.success || !data?.report) return;
        const rep = data.report as {
          fileName?: string;
          savedAt?: string;
          summary: { ok: number; mismatch: number; not_found: number; total: number };
          csvHeaders: string[];
          results: ValidateResultRow[];
        };
        setFileName(String(rep.fileName ?? ''));
        setSummary(rep.summary);
        const hdrs = Array.isArray(rep.csvHeaders) ? rep.csvHeaders : [];
        setCsvHeaders(hdrs);
        setResults(normalizeResultRowsFromDb(Array.isArray(rep.results) ? rep.results : [], hdrs));
        const savedAt = rep.savedAt ? new Date(rep.savedAt).toLocaleString() : '';
        setPersistNotice(
          savedAt
            ? `Latest report loaded from database (saved ${savedAt}). Same data for all admins / devices.`
            : 'Latest report loaded from database.'
        );
      } catch {
        if (!cancelled) setPersistNotice('');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const runValidate = useCallback(async (upload: ParsedUpload, sourceFileName: string) => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(authUrl('admin-offline-sakhi-validate'), {
        method: 'POST',
        headers: authHeadersJson(),
        body: JSON.stringify({
          userId: ADMIN_USER_ID,
          password: ADMIN_PASSWORD,
          rows: upload.parsedRows.map((r) => ({ ...r })),
        }),
      });
      const data = await parseJsonResponse(response);
      if (!response.ok || !data?.success) {
        throw new Error(data?.message || 'Validation failed');
      }
      const summaryNext = data.summary ?? null;
      setSummary(summaryNext);
      setImportSummary(null);
      const rawList = Array.isArray(data.results) ? data.results : [];
      const hl = upload.headers.length;
      const merged: ValidateResultRow[] = rawList.map((r: ValidateResultRow, i: number) => ({
        ...r,
        rawCells: padRowToLength(upload.bodyRows[i] ?? [], hl),
      }));
      setResults(merged);
      if (summaryNext) {
        const unmappedCols = listUnmappedColumnIndices(upload.headers);
        const payloadResults = merged.map((r) => {
          const base = {
            rowIndex: r.rowIndex,
            status: r.status,
            epic: r.epic,
            mismatchedFields: r.mismatchedFields,
            csv: { ...r.csv },
            roll: r.roll
              ? {
                  full_name: r.roll.full_name,
                  father_or_husband: r.roll.father_or_husband,
                  sex: r.roll.sex,
                  age: r.roll.age,
                  halka: r.roll.halka,
                  booth: r.roll.booth,
                }
              : null,
          };
          if (unmappedCols.length === 0) return base;
          const extraCells: Record<number, string> = {};
          for (const j of unmappedCols) {
            extraCells[j] = r.rawCells[j] ?? '';
          }
          return { ...base, extraCells };
        });
        let reportId: string | null = null;
        try {
          const ROW_CHUNK = 80;
          const beginRes = await fetch(authUrl('admin-offline-sakhi-report-save-begin'), {
            method: 'POST',
            headers: authHeadersJson(),
            body: JSON.stringify({
              userId: ADMIN_USER_ID,
              password: ADMIN_PASSWORD,
              fileName: sourceFileName,
              summary: summaryNext,
              csvHeaders: upload.headers,
            }),
          });
          const beginData = await parseJsonResponse(beginRes);
          if (!beginRes.ok || !beginData?.success || !beginData?.reportId) {
            throw new Error(beginData?.message || 'Could not start database save');
          }
          reportId = String(beginData.reportId);
          for (let i = 0; i < payloadResults.length; i += ROW_CHUNK) {
            const chunk = payloadResults.slice(i, i + ROW_CHUNK);
            const rowsRes = await fetch(authUrl('admin-offline-sakhi-report-save-rows'), {
              method: 'POST',
              headers: authHeadersJson(),
              body: JSON.stringify({
                userId: ADMIN_USER_ID,
                password: ADMIN_PASSWORD,
                reportId,
                rows: chunk,
              }),
            });
            const rowsData = await parseJsonResponse(rowsRes);
            if (!rowsRes.ok || !rowsData?.success) {
              throw new Error(rowsData?.message || `Save failed at row ${i + 1}`);
            }
          }
          setPersistNotice(
            'Report saved in the database — refresh or open from another device to see the same report.'
          );
        } catch (saveErr) {
          console.warn('Offline Sakhi: save to server failed', saveErr);
          const detail = saveErr instanceof Error ? saveErr.message : String(saveErr);
          setPersistNotice(
            `Validation done, but saving the report failed: ${detail} Export CSV as backup.`
          );
          if (reportId) {
            try {
              await fetch(authUrl('admin-offline-sakhi-report-save-abort'), {
                method: 'POST',
                headers: authHeadersJson(),
                body: JSON.stringify({
                  userId: ADMIN_USER_ID,
                  password: ADMIN_PASSWORD,
                  reportId,
                }),
              });
            } catch {
              /* ignore */
            }
          }
        }
      }
    } catch (e) {
      setSummary(null);
      setResults([]);
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  }, []);

  const clearSavedReport = useCallback(async () => {
    try {
      const response = await fetch(authUrl('admin-offline-sakhi-report-clear'), {
        method: 'POST',
        headers: authHeadersJson(),
        body: JSON.stringify({ userId: ADMIN_USER_ID, password: ADMIN_PASSWORD }),
      });
      const data = await parseJsonResponse(response);
      if (!response.ok || !data?.success) {
        setError(data?.message || 'Could not clear saved report on server.');
        return;
      }
    } catch {
      setError('Could not clear saved report on server.');
      return;
    }
    userChoseNewFileRef.current = false;
    setSummary(null);
    setResults([]);
    setCsvHeaders([]);
    setFileName('');
    setPersistNotice('');
    setError('');
  }, []);

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    userChoseNewFileRef.current = true;
    setFileName(f.name);
    setError('');
    setPersistNotice('');
    setSummary(null);
    setResults([]);
    setCsvHeaders([]);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      const grid = parseCsvRows(text);
      const upload = mapGridToUpload(grid);
      if (!upload) {
        setError('No data rows found. Check CSV headers match the template (EPIC, name, DOB, etc.).');
        return;
      }
      setCsvHeaders(upload.headers);
      void runValidate(upload, f.name);
    };
    reader.readAsText(f, 'UTF-8');
    e.target.value = '';
  };

  const exportReportCsv = () => {
    if (results.length === 0) return;
    const rollHdr = [
      'Roll name',
      'Roll father/husband',
      'Roll sex',
      'Roll age',
      'Roll halka',
      'Roll booth',
    ];
    const headers = [
      'Row',
      'Match status',
      'Mismatch notes',
      'EPIC (match key)',
      ...csvHeaders.map((h) => `CSV: ${h}`),
      ...rollHdr,
    ];
    const lines = [headers.join(',')];
    for (const r of results) {
      const esc = (s: string) => {
        const t = String(s ?? '').replace(/"/g, '""');
        return `"${t}"`;
      };
      const mf = r.mismatchedFields.join('; ');
      const roll = r.roll;
      const csvCells = csvHeaders.map((_, j) => r.rawCells[j] ?? '');
      lines.push(
        [
          String(r.rowIndex + 1),
          r.status,
          mf,
          r.epic,
          ...csvCells,
          roll?.full_name ?? '',
          roll?.father_or_husband ?? '',
          roll?.sex ?? '',
          roll?.age ?? '',
          roll?.halka ?? '',
          roll?.booth ?? '',
        ]
          .map((x) => esc(String(x)))
          .join(',')
      );
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `offline-sakhi-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importToSubmissions = async () => {
    if (!summary || results.length === 0) return;
    setImporting(true);
    setError('');
    setImportSummary(null);
    try {
      const byCsvIndex = (row: ValidateResultRow, headerNeedle: RegExp): string => {
        const idx = csvHeaders.findIndex((h) => headerNeedle.test(String(h ?? '')));
        if (idx < 0) return '';
        return String(row.rawCells[idx] ?? '').trim();
      };

      // Prefer ParsedCsvRow mapping; fall back to raw cells for columns not in ParsedCsvRow (district/halka/booth etc)
      const mapped = results.map((r) => ({
        epic: r.epic || r.csv.epic || '',
        applicantName: r.csv.applicantName || byCsvIndex(r, /applicant.*name|full\s*name|name/i),
        mobile: r.csv.mobile || byCsvIndex(r, /mobile/i),
        fatherName: r.csv.fatherName || byCsvIndex(r, /father|husband/i),
        dob: r.csv.dob || byCsvIndex(r, /dob|date\s*of\s*birth/i),
        gender: r.csv.gender || byCsvIndex(r, /gender|sex/i),
        aadhaar: r.csv.aadhaar || byCsvIndex(r, /aadhaar|aadhar|uid/i),
        district: r.csv.district || byCsvIndex(r, /district/i),
        halka: r.csv.halka || byCsvIndex(r, /halka|assembly|ac/i),
        booth: r.csv.booth || byCsvIndex(r, /booth/i),
      }));

      const ROW_CHUNK = 120;
      let insertedTotal = 0;
      let skippedTotal = 0;
      const errs: Array<{ epic: string; mobile: string; assembly?: string; reason?: string; message: string }> = [];
      const byAssembly = new Map<string, ImportAssemblyStats>();
      const reasonSummary: Record<string, number> = {};

      for (let i = 0; i < mapped.length; i += ROW_CHUNK) {
        const chunk = mapped.slice(i, i + ROW_CHUNK);
        const res = await fetch(authUrl('admin-offline-sakhi-import-submissions-rows'), {
          method: 'POST',
          headers: authHeadersJson(),
          body: JSON.stringify({
            userId: ADMIN_USER_ID,
            password: ADMIN_PASSWORD,
            sourceName: 'Googleform',
            rows: chunk,
          }),
        });
        const data = await parseJsonResponse(res);
        if (!res.ok || !data?.success) {
          throw new Error(data?.message || `Import failed (HTTP ${res.status})`);
        }
        insertedTotal += Number(data.inserted || 0);
        skippedTotal += Number(data.skipped || 0);
        if (Array.isArray(data.errors)) errs.push(...data.errors);
        if (Array.isArray(data.assemblyStats)) {
          for (const item of data.assemblyStats as ImportAssemblyStats[]) {
            const name = String(item.assembly || '—').trim() || '—';
            const prev = byAssembly.get(name) ?? { assembly: name, inserted: 0, skipped: 0, reasons: {} };
            prev.inserted += Number(item.inserted || 0);
            prev.skipped += Number(item.skipped || 0);
            const reasons = item.reasons && typeof item.reasons === 'object' ? item.reasons : {};
            Object.entries(reasons).forEach(([k, v]) => {
              prev.reasons[k] = (prev.reasons[k] ?? 0) + Number(v || 0);
            });
            byAssembly.set(name, prev);
          }
        }
        if (data.reasonSummary && typeof data.reasonSummary === 'object') {
          Object.entries(data.reasonSummary as Record<string, number>).forEach(([k, v]) => {
            reasonSummary[k] = (reasonSummary[k] ?? 0) + Number(v || 0);
          });
        }
      }

      const assemblyStats = [...byAssembly.values()].sort((a, b) => {
        if (b.inserted !== a.inserted) return b.inserted - a.inserted;
        if (b.skipped !== a.skipped) return b.skipped - a.skipped;
        return a.assembly.localeCompare(b.assembly);
      });

      setImportSummary({
        inserted: insertedTotal,
        skipped: skippedTotal,
        assemblyStats,
        reasonSummary,
        errors: errs,
      });

      setPersistNotice(
        `Imported to All Submissions (source: Googleform). Inserted ${insertedTotal}, skipped ${skippedTotal}.` +
          (errs.length ? ` First error: ${errs[0]?.message || 'unknown'}` : '')
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="max-w-[100rem] mx-auto">
      {!embedded && onBack && (
        <button
          type="button"
          onClick={onBack}
          className="mb-4 flex items-center gap-2 text-sm font-medium text-orange-700 hover:text-orange-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
      )}

      <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <FileSpreadsheet className="h-8 w-8 text-orange-600" />
              Offline Sakhi Add
            </h1>
            <p className="mt-2 text-gray-600 text-sm max-w-2xl">
              Upload a CSV in the prescribed format. Each row is matched by <strong>EPIC (Voter ID)</strong> against the
              electoral roll. Green = all checked fields match; red = EPIC found but name / father / gender / age /
              halka / booth differ; yellow = EPIC not found in the database. After each successful run, the full report is{' '}
              <strong>saved in the database</strong> so any admin can reopen it after refresh or from another device.
            </p>
          </div>
        </div>

        <label className="flex flex-col items-center justify-center w-full border-2 border-dashed border-orange-300 rounded-xl p-8 cursor-pointer hover:bg-orange-50/50 transition-colors">
          <Upload className="h-10 w-10 text-orange-500 mb-2" />
          <span className="text-sm font-medium text-gray-700">Choose CSV file</span>
          <span className="text-xs text-gray-500 mt-1">Headers: Applicant name, Mobile, Father/Husband, DOB, Gender, EPIC, …</span>
          <input type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} disabled={loading} />
        </label>
        {fileName ? <p className="mt-2 text-sm text-gray-600">Last file: {fileName}</p> : null}
        {loading ? <p className="mt-4 text-sm text-orange-700">Processing…</p> : null}
        {error ? <p className="mt-4 text-sm text-red-700">{error}</p> : null}
        {persistNotice ? (
          <p className="mt-4 text-sm text-teal-800 bg-teal-50 border border-teal-200 rounded-lg px-3 py-2">{persistNotice}</p>
        ) : null}
      </div>

      {summary ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
            <p className="text-xs font-medium text-gray-500 uppercase">Total rows</p>
            <p className="text-2xl font-bold text-gray-900">{summary.total}</p>
          </div>
          <div className="bg-emerald-50 rounded-xl border border-emerald-200 p-4 shadow-sm">
            <p className="text-xs font-medium text-emerald-800 uppercase">Match (green)</p>
            <p className="text-2xl font-bold text-emerald-900">{summary.ok}</p>
          </div>
          <div className="bg-red-50 rounded-xl border border-red-200 p-4 shadow-sm">
            <p className="text-xs font-medium text-red-800 uppercase">Detail mismatch (red)</p>
            <p className="text-2xl font-bold text-red-900">{summary.mismatch}</p>
          </div>
          <div className="bg-amber-50 rounded-xl border border-amber-200 p-4 shadow-sm">
            <p className="text-xs font-medium text-amber-800 uppercase">EPIC not found (yellow)</p>
            <p className="text-2xl font-bold text-amber-900">{summary.not_found}</p>
          </div>
        </div>
      ) : null}

      {results.length > 0 && csvHeaders.length > 0 ? (
        <div className="bg-white rounded-2xl shadow-xl p-4 md:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Report</h2>
              <p className="text-xs text-gray-500 mt-1">
                <strong>Match result</strong> (status / EPIC) on the left, <strong>every column from your uploaded CSV</strong>{' '}
                in the middle, and <strong>electoral roll fields from the database</strong> in a separate block on the right.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <div className="min-w-[14rem]">
                <label className="text-xs text-gray-600 block mb-1">Filter by Halka</label>
                <select
                  value={selectedHalka}
                  onChange={(e) => setSelectedHalka(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800"
                >
                  <option value="all">All Halka</option>
                  {halkaOptions.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={exportReportCsv}
                className="rounded-lg bg-orange-600 text-white px-4 py-2 text-sm font-medium hover:bg-orange-700"
              >
                Export CSV
              </button>
              <button
                type="button"
                onClick={() => void importToSubmissions()}
                disabled={importing}
                className="rounded-lg bg-emerald-600 text-white px-4 py-2 text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
                title="Import mapped CSV columns into All Submissions (source Googleform)"
              >
                {importing ? 'Importing…' : 'Import to All Submissions'}
              </button>
              <button
                type="button"
                onClick={() => void clearSavedReport()}
                className="rounded-lg border border-gray-300 bg-white text-gray-800 px-4 py-2 text-sm font-medium hover:bg-gray-50"
              >
                Clear all saved reports (database)
              </button>
            </div>
          </div>
          <p className="mb-3 text-xs text-gray-600">
            Showing <strong>{filteredResults.length}</strong> rows
            {selectedHalka !== 'all' ? (
              <>
                {' '}
                for <strong>{selectedHalka}</strong>
              </>
            ) : null}
            .
          </p>
          {importSummary ? (
            <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50/40 p-3">
              <p className="text-sm font-semibold text-emerald-900">
                Import summary: inserted {importSummary.inserted}, skipped {importSummary.skipped}
              </p>
              <p className="text-xs text-emerald-800 mt-1">
                Reason wise:{' '}
                {Object.entries(importSummary.reasonSummary)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(', ') || 'none'}
              </p>
              {importSummary.assemblyStats.length > 0 ? (
                <div className="mt-3 overflow-x-auto rounded border border-emerald-200 bg-white">
                  <table className="min-w-[34rem] w-full text-xs">
                    <thead className="bg-emerald-100/70 text-emerald-900">
                      <tr>
                        <th className="px-2 py-1.5 text-left">Assembly (Halka)</th>
                        <th className="px-2 py-1.5 text-right">Inserted</th>
                        <th className="px-2 py-1.5 text-right">Skipped</th>
                        <th className="px-2 py-1.5 text-left">Skipped reasons</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importSummary.assemblyStats.map((a) => (
                        <tr key={a.assembly} className="border-t border-emerald-100">
                          <td className="px-2 py-1.5">{a.assembly}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{a.inserted}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{a.skipped}</td>
                          <td className="px-2 py-1.5">
                            {Object.entries(a.reasons)
                              .map(([k, v]) => `${k}: ${v}`)
                              .join(', ') || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="overflow-x-auto rounded-lg border border-gray-200 max-h-[70vh] overflow-y-auto">
            <table className="min-w-max text-xs md:text-sm border-collapse">
              <thead className="sticky top-0 z-20">
                <tr className="text-[10px] md:text-xs uppercase tracking-wide text-gray-600">
                  <th
                    colSpan={4}
                    className="px-2 py-2 text-center font-semibold bg-slate-200 border border-gray-300 border-b-0"
                  >
                    Match result
                  </th>
                  <th
                    colSpan={csvHeaders.length}
                    className="px-2 py-2 text-center font-semibold bg-amber-100/90 border border-gray-300 border-b-0"
                  >
                    Uploaded CSV — all columns
                  </th>
                  <th
                    colSpan={6}
                    className="px-2 py-2 text-center font-semibold bg-sky-100/90 border border-gray-300 border-b-0"
                  >
                    Electoral roll (database)
                  </th>
                </tr>
                <tr className="bg-gray-50 border-b border-gray-300">
                  <th className="px-2 py-2 text-left font-semibold text-gray-800 border-l border-gray-200 whitespace-nowrap">
                    #
                  </th>
                  <th className="px-2 py-2 text-left font-semibold text-gray-800 whitespace-nowrap min-w-[8rem]">
                    Status
                  </th>
                  <th className="px-2 py-2 text-left font-semibold text-gray-800 whitespace-nowrap min-w-[10rem]">
                    Notes
                  </th>
                  <th className="px-2 py-2 text-left font-semibold text-gray-800 whitespace-nowrap border-r border-gray-300">
                    EPIC
                  </th>
                  {csvHeaders.map((h, hi) => (
                    <th
                      key={`h-${hi}`}
                      className="px-2 py-2 text-left font-semibold text-gray-800 bg-amber-50/50 max-w-[11rem] align-bottom"
                      title={h}
                    >
                      <span className="line-clamp-3 break-words">{h || `Col ${hi + 1}`}</span>
                    </th>
                  ))}
                  <th className="px-2 py-2 text-left font-semibold text-gray-800 bg-sky-50/50 border-l border-gray-300 whitespace-nowrap">
                    Roll name
                  </th>
                  <th className="px-2 py-2 text-left font-semibold text-gray-800 bg-sky-50/50 whitespace-nowrap">
                    Roll father
                  </th>
                  <th className="px-2 py-2 text-left font-semibold text-gray-800 bg-sky-50/50 whitespace-nowrap">
                    Sex
                  </th>
                  <th className="px-2 py-2 text-left font-semibold text-gray-800 bg-sky-50/50 whitespace-nowrap">
                    Age
                  </th>
                  <th className="px-2 py-2 text-left font-semibold text-gray-800 bg-sky-50/50 whitespace-nowrap">
                    Roll halka
                  </th>
                  <th className="px-2 py-2 text-left font-semibold text-gray-800 bg-sky-50/50 whitespace-nowrap">
                    Roll booth
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredResults.map((r) => (
                  <tr key={r.rowIndex} className={`border-t border-gray-200 ${rowBg(r.status)}`}>
                    <td className="px-2 py-1.5 tabular-nums text-gray-800 border-l border-gray-100">{r.rowIndex + 1}</td>
                    <td className="px-2 py-1.5 font-medium text-gray-900">{statusLabel(r.status)}</td>
                    <td className="px-2 py-1.5 text-gray-800 max-w-[14rem]">{r.mismatchedFields.join(', ') || '—'}</td>
                    <td className="px-2 py-1.5 font-mono text-gray-900 border-r border-gray-200 whitespace-nowrap">
                      {r.epic}
                    </td>
                    {csvHeaders.map((_, j) => (
                      <td
                        key={`c-${r.rowIndex}-${j}`}
                        className="px-2 py-1.5 text-gray-800 align-top max-w-[11rem] bg-amber-50/20"
                      >
                        <span className="break-words line-clamp-4">{r.rawCells[j] ?? ''}</span>
                      </td>
                    ))}
                    <td className="px-2 py-1.5 text-gray-800 bg-sky-50/30 border-l border-gray-200 align-top">
                      {r.roll?.full_name ?? '—'}
                    </td>
                    <td className="px-2 py-1.5 text-gray-800 bg-sky-50/30 align-top">{r.roll?.father_or_husband ?? '—'}</td>
                    <td className="px-2 py-1.5 text-gray-800 bg-sky-50/30 whitespace-nowrap">{r.roll?.sex ?? '—'}</td>
                    <td className="px-2 py-1.5 text-gray-800 bg-sky-50/30 tabular-nums">{r.roll?.age ?? '—'}</td>
                    <td className="px-2 py-1.5 text-gray-800 bg-sky-50/30 align-top">{r.roll?.halka ?? '—'}</td>
                    <td className="px-2 py-1.5 text-gray-800 bg-sky-50/30">{r.roll?.booth ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-gray-500">
            Legend: green row = full match; red = EPIC exists but differs on roll fields; yellow = EPIC missing from roll.
            Mobile / Aadhaar / district are not stored on the roll and are not compared.
          </p>
        </div>
      ) : null}
    </div>
  );
}
