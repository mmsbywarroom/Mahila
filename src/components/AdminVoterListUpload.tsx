import { useState, useEffect, useCallback } from 'react';
import { authUrl, authHeadersJson } from '../lib/api';
import { ArrowLeft, Upload, CheckCircle, AlertCircle, Vote } from 'lucide-react';

interface AdminVoterListUploadProps {
  onBack?: () => void;
  embedded?: boolean;
}

const ADMIN_USER_ID = 'admin';
const ADMIN_PASSWORD = 'admin@123';
/** Tuned chunk size for faster throughput with server-side bulk upsert */
const CHUNK_SIZE = 1500;
const MAX_FILES_PER_BATCH = 30;
const PARALLEL_UPLOADS = 4;

async function readJsonSafe(response: Response): Promise<unknown> {
  const raw = await response.text();
  if (!raw || !raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Canonical DB columns (Excel export column names) */
const VOTER_FIELDS = [
  'e_first_name',
  'e_middle_name',
  'sex',
  'age',
  'vcardid',
  'house_no',
  'part_no',
  'srno',
  'boothid',
  'familyid',
  'full_name',
  'e_assemblyname',
] as const;

/** Alternate header names → canonical key */
const HEADER_ALIASES: Record<string, string[]> = {
  e_first_name: ['e_first_name', 'firstname', 'first_name'],
  e_middle_name: ['e_middle_name', 'middlename', 'middle_name'],
  sex: ['sex', 'gender'],
  age: ['age'],
  vcardid: ['vcardid', 'voter_id', 'epic'],
  house_no: ['house_no', 'houseno', 'house_number'],
  part_no: ['part_no', 'partno', 'part'],
  srno: ['srno', 'sr_no', 'serial_no', 'serial'],
  boothid: ['boothid', 'booth_id', 'booth'],
  familyid: ['familyid', 'family_id'],
  full_name: ['full_name', 'fullname', 'name'],
  e_assemblyname: ['e_assemblyname', 'assembly', 'assembly_name', 'ac_name'],
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

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[\s/_-]+/g, '');
}

function buildHeaderToIndex(headers: string[]): Map<string, number> {
  const map = new Map<string, number>();
  headers.forEach((h, i) => {
    map.set(normalizeHeader(h), i);
  });
  return map;
}

function resolveColumnIndex(headerMap: Map<string, number>, canonical: string): number {
  const aliases = HEADER_ALIASES[canonical] ?? [canonical];
  for (const a of aliases) {
    const idx = headerMap.get(normalizeHeader(a));
    if (idx !== undefined) return idx;
  }
  return -1;
}

function parseAgeCell(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function csvToVoterRows(csvText: string): Array<Record<(typeof VOTER_FIELDS)[number], string | number | null>> {
  const matrix = parseCsvRows(csvText);
  if (matrix.length < 2) return [];

  const headerCells = matrix[0];
  const headerMap = buildHeaderToIndex(headerCells);
  const colIdx: Record<string, number> = {};
  for (const f of VOTER_FIELDS) {
    colIdx[f] = resolveColumnIndex(headerMap, f);
  }

  const rows: Array<Record<(typeof VOTER_FIELDS)[number], string | number | null>> = [];
  for (let li = 1; li < matrix.length; li += 1) {
    const cols = matrix[li];
    const row = {} as Record<(typeof VOTER_FIELDS)[number], string | number | null>;
    for (const f of VOTER_FIELDS) {
      const idx = colIdx[f];
      const raw = idx >= 0 ? (cols[idx] ?? '').trim() : '';
      if (f === 'age') {
        row[f] = parseAgeCell(raw);
      } else {
        row[f] = raw || null;
      }
    }
    rows.push(row);
  }
  return rows;
}

export default function AdminVoterListUpload({ onBack, embedded }: AdminVoterListUploadProps) {
  const [fileNames, setFileNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [progressText, setProgressText] = useState('');
  const [totalRows, setTotalRows] = useState<number | null>(null);
  const [boothCount, setBoothCount] = useState<number | null>(null);
  const [assemblyWise, setAssemblyWise] = useState<{ assembly: string; count: number }[]>([]);
  const [countLoading, setCountLoading] = useState(true);

  const fetchVoterRowCount = useCallback(async () => {
    setCountLoading(true);
    try {
      const response = await fetch(authUrl('admin-voters-count'), {
        method: 'POST',
        headers: authHeadersJson(),
        body: JSON.stringify({
          userId: ADMIN_USER_ID,
          password: ADMIN_PASSWORD,
        }),
      });
      const data = (await readJsonSafe(response)) as any;
      if (response.ok && data?.success && typeof data.count === 'number') {
        setTotalRows(data.count);
        if (typeof data.boothDistinct === 'number' && !Number.isNaN(data.boothDistinct)) {
          setBoothCount(data.boothDistinct);
        } else {
          setBoothCount(null);
        }
        if (Array.isArray(data.assemblyWise)) {
          setAssemblyWise(
            data.assemblyWise
              .map((row: { assembly?: string; count?: number }) => ({
                assembly: String(row?.assembly ?? '').trim(),
                count: Number(row?.count ?? 0),
              }))
              .filter((r: { assembly: string; count: number }) => r.assembly.length > 0)
          );
        } else {
          setAssemblyWise([]);
        }
      } else {
        setTotalRows(null);
        setBoothCount(null);
        setAssemblyWise([]);
      }
    } catch {
      setTotalRows(null);
      setBoothCount(null);
      setAssemblyWise([]);
    } finally {
      setCountLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchVoterRowCount();
  }, [fetchVoterRowCount]);

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const selected = Array.from(files);
    if (selected.length > MAX_FILES_PER_BATCH) {
      setError(`Select at most ${MAX_FILES_PER_BATCH} CSV files at once.`);
      return;
    }

    setFileNames(selected.map((f) => f.name));
    setError('');
    setSuccess('');
    setProgressText('');
    setLoading(true);

    try {
      const allRows: Array<Record<(typeof VOTER_FIELDS)[number], string | number | null>> = [];
      for (let i = 0; i < selected.length; i += 1) {
        const file = selected[i];
        setProgressText(`Reading file ${i + 1}/${selected.length}: ${file.name}`);
        const csvText = await file.text();
        const rows = csvToVoterRows(csvText);
        // Avoid stack overflow on very large CSV batches (spread can exceed call stack).
        for (const r of rows) allRows.push(r);
      }

      if (allRows.length === 0) {
        throw new Error(
          'No valid rows found in CSV — EPIC (vcardid) is required in each row. Please check headers.'
        );
      }

      const totalChunks = Math.ceil(allRows.length / CHUNK_SIZE);
      const chunks = Array.from({ length: totalChunks }, (_, i) =>
        allRows.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE)
      );
      let processedRows = 0;
      let skippedMissingEpicRows = 0;
      let completedChunks = 0;

      let nextChunkIndex = 0;
      const workerCount = Math.min(PARALLEL_UPLOADS, totalChunks);

      const uploadChunk = async (chunkIndex: number) => {
        const chunk = chunks[chunkIndex];
        const response = await fetch(authUrl('admin-upload-voters'), {
          method: 'POST',
          headers: authHeadersJson(),
          body: JSON.stringify({
            userId: ADMIN_USER_ID,
            password: ADMIN_PASSWORD,
            rows: chunk,
          }),
        });

        const data = (await readJsonSafe(response)) as any;
        if (!response.ok || !data.success) {
          const fallback =
            data?.message ||
            `Chunk ${chunkIndex + 1} failed (HTTP ${response.status || 'unknown'}). Please retry upload.`;
          throw new Error(fallback);
        }
        processedRows += Number(data.processedRows ?? chunk.length) || chunk.length;
        skippedMissingEpicRows += Number(data.missingEpicCount ?? data.skippedNoEpic ?? 0) || 0;
        completedChunks += 1;
        setProgressText(`Uploading chunks ${completedChunks}/${totalChunks} (last: ${chunk.length} rows)...`);
      };

      const runWorker = async () => {
        while (nextChunkIndex < totalChunks) {
          const current = nextChunkIndex;
          nextChunkIndex += 1;
          await uploadChunk(current);
        }
      };

      setProgressText(`Uploading chunks 0/${totalChunks}...`);
      await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

      const parts = [
        `Files: ${selected.length}`,
        `Total rows read: ${allRows.length.toLocaleString()}`,
        `Processed on server: ${processedRows.toLocaleString()}`,
        skippedMissingEpicRows > 0
          ? `Skipped (missing EPIC): ${skippedMissingEpicRows.toLocaleString()}`
          : '',
      ].filter(Boolean);
      setSuccess(parts.join(' · ') + '.');
      setProgressText('');
      void fetchVoterRowCount();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      setProgressText('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={embedded ? 'w-full' : 'min-h-screen bg-gradient-to-br from-orange-50 to-amber-50'}>
      <div className={`${embedded ? 'max-w-full' : 'max-w-4xl'} mx-auto ${embedded ? '' : 'p-4 py-8'}`}>
        <div className="bg-white rounded-2xl shadow-xl p-8">
          <div className="flex items-center gap-4 mb-8">
            {onBack && (
              <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                <ArrowLeft className="h-6 w-6 text-gray-600" />
              </button>
            )}
            <div className="flex items-center gap-3">
              <div className="bg-violet-100 p-3 rounded-xl">
                <Vote className="h-8 w-8 text-violet-700" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-gray-900">Voter List Upload</h1>
                <p className="text-gray-600">Export from Excel as CSV and upload here — this is a separate module (not tied to Incharge/User creation).</p>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="space-y-3 rounded-xl border border-violet-200 bg-white px-4 py-4 shadow-sm">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-gray-800">Total rows</span>
                  <span className="rounded-lg bg-violet-100 px-3 py-1 font-mono text-lg font-bold text-violet-900 tabular-nums">
                    {countLoading ? '…' : totalRows !== null ? totalRows.toLocaleString() : '—'}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-gray-800">Total booths</span>
                  <span
                    className="rounded-lg bg-amber-50 px-3 py-1 font-mono text-lg font-bold text-amber-950 tabular-nums"
                    title="Distinct assembly + booth number pairs (rows with both filled)"
                  >
                    {countLoading ? '…' : boothCount !== null ? boothCount.toLocaleString() : '—'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => void fetchVoterRowCount()}
                  disabled={countLoading}
                  className="text-xs font-medium text-violet-700 underline decoration-violet-300 hover:text-violet-900 disabled:opacity-50"
                >
                  Refresh
                </button>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                  Assembly-wise voter records
                </p>
                {countLoading ? (
                  <p className="text-sm text-gray-500">Loading…</p>
                ) : assemblyWise.length === 0 ? (
                  <p className="text-sm text-gray-500">No assembly breakdown yet (upload CSV with e_assemblyname).</p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-gray-200">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 bg-gray-50 text-left">
                          <th className="px-3 py-2 font-semibold text-gray-700">Assembly (AC)</th>
                          <th className="px-3 py-2 font-semibold text-gray-700 tabular-nums">Rows</th>
                        </tr>
                      </thead>
                      <tbody>
                        {assemblyWise.map((row, idx) => (
                          <tr key={`${row.assembly}-${idx}`} className="border-b border-gray-100 last:border-0">
                            <td className="px-3 py-2 text-gray-900">{row.assembly}</td>
                            <td className="px-3 py-2 tabular-nums text-gray-800">{row.count.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-violet-50 border border-violet-200 rounded-lg p-4 text-sm text-violet-900">
              <p className="font-medium mb-2">Expected columns (as in electoral roll export):</p>
              <p className="text-violet-800">
                <span className="font-mono text-xs">
                  e_first_name, e_middle_name, sex, age, vcardid, house_no, part_no, srno, boothid, familyid, full_name,
                  e_assemblyname
                </span>
              </p>
              <p className="mt-2 text-xs text-violet-700">
                Rows without EPIC (vcardid) are not uploaded and are automatically skipped.
                If the same EPIC appears again, the existing row is updated. Uploading does not delete previous data.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                CSV Files (up to {MAX_FILES_PER_BATCH} at once)
              </label>
              <input
                type="file"
                accept=".csv,text/csv"
                multiple
                onChange={(e) => handleFileUpload(e.target.files)}
                disabled={loading}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-all"
              />
              {fileNames.length > 0 && (
                <p className="text-xs text-gray-500 mt-2">
                  Selected ({fileNames.length}): {fileNames.slice(0, 6).join(', ')}
                  {fileNames.length > 6 ? ` +${fileNames.length - 6} more` : ''}
                </p>
              )}
            </div>

            {progressText && (
              <div className="flex items-center gap-2 text-violet-800 bg-violet-50 border border-violet-200 rounded-lg px-4 py-3 text-sm">
                <Upload className="h-4 w-4" />
                <span>{progressText}</span>
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm">
                <AlertCircle className="h-4 w-4" />
                <span>{error}</span>
              </div>
            )}

            {success && (
              <div className="flex items-center gap-2 text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm">
                <CheckCircle className="h-4 w-4" />
                <span>{success}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
