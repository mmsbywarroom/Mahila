import { useEffect, useMemo, useState } from 'react';
import { BarChart3, RefreshCw } from 'lucide-react';
import { authHeadersJson, authUrl, parseJsonResponse } from '../lib/api';

interface AdminAssemblyReportProps {
  embedded?: boolean;
  /** Opens without login; uses public-assembly-dashboard (aggregate data only). */
  publicView?: boolean;
}

type ReportRow = {
  zone: string;
  district: string;
  assembly: string;
  total_booths: number;
  booth_detail_received: number;
  booth_detail_received_pct: number;
  approx_sakhi_required: number;
  dob_received: number;
  age_55_plus: number;
  epic_received: number;
  aadhaar_received: number;
  total_votes: number;
  required_sakhi: number;
  added_sakhi: number;
  with_epic_added: number;
  without_epic_added: number;
};

const PUBLIC_HIDDEN_ASSEMBLIES = new Set(
  [
    'Kotkapura',
    'Batala',
    'Adampur',
    'Moga',
    'Patiala Rural',
    'Dirba',
    'Sunam',
    'Malout',
    'Anandpur Sahib',
  ].map((x) => x.trim().toLowerCase())
);

function pct(numerator: number, denominator: number): string {
  if (!denominator || denominator <= 0) return '0%';
  return `${((numerator * 100) / denominator).toFixed(1)}%`;
}

function parseOptionalNum(s: string): number | null {
  const t = s.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export default function AdminAssemblyReport({ embedded, publicView }: AdminAssemblyReportProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [rows, setRows] = useState<ReportRow[]>([]);

  /** Column filters — numeric columns: single exact value (empty = no filter) */
  const [fZone, setFZone] = useState('');
  const [fDistrict, setFDistrict] = useState('');
  const [fAssembly, setFAssembly] = useState('');
  const [fBooth, setFBooth] = useState('');
  const [fSakhiPct, setFSakhiPct] = useState('');
  const [fReq, setFReq] = useState('');
  const [fAdded, setFAdded] = useState('');

  const filteredRows = useMemo(() => {
    const asm = fAssembly.trim().toLowerCase();
    const zn = fZone.trim().toLowerCase();
    const dt = fDistrict.trim().toLowerCase();
    const b = parseOptionalNum(fBooth);
    const p = parseOptionalNum(fSakhiPct);
    const r = parseOptionalNum(fReq);
    const a = parseOptionalNum(fAdded);

    return rows.filter((row) => {
      if (zn && !row.zone.toLowerCase().includes(zn)) return false;
      if (dt && !row.district.toLowerCase().includes(dt)) return false;
      if (asm && !row.assembly.toLowerCase().includes(asm)) return false;
      if (b !== null && row.total_booths !== b) return false;
      if (r !== null && row.required_sakhi !== r) return false;
      if (a !== null && row.added_sakhi !== a) return false;
      if (p !== null) {
        const rowPct = Number((((row.added_sakhi * 100) / Math.max(row.approx_sakhi_required, 1))).toFixed(1));
        if (rowPct !== p) return false;
      }
      return true;
    });
  }, [rows, fZone, fDistrict, fAssembly, fBooth, fSakhiPct, fReq, fAdded]);

  const totals = useMemo(
    () =>
      filteredRows.reduce(
        (acc, row) => {
          acc.totalBooths += row.total_booths;
          acc.boothDetail += row.booth_detail_received;
          acc.totalVotes += row.total_votes;
          acc.dob += row.dob_received;
          acc.age55 += row.age_55_plus;
          acc.epic += row.epic_received;
          acc.aadhaar += row.aadhaar_received;
          acc.withEpic += row.with_epic_added;
          acc.withoutEpic += row.without_epic_added;
          acc.requiredSakhi += row.required_sakhi;
          acc.addedSakhi += row.added_sakhi;
          return acc;
        },
        {
          totalBooths: 0,
          boothDetail: 0,
          totalVotes: 0,
          dob: 0,
          age55: 0,
          epic: 0,
          aadhaar: 0,
          withEpic: 0,
          withoutEpic: 0,
          requiredSakhi: 0,
          addedSakhi: 0,
        }
      ),
    [filteredRows]
  );

  const rankedRows = useMemo(
    () =>
      [...filteredRows].sort((a, b) => {
        if (b.added_sakhi !== a.added_sakhi) return b.added_sakhi - a.added_sakhi;
        if (b.epic_received !== a.epic_received) return b.epic_received - a.epic_received;
        return a.assembly.localeCompare(b.assembly);
      }),
    [filteredRows]
  );

  const clearFilters = () => {
    setFZone('');
    setFDistrict('');
    setFAssembly('');
    setFBooth('');
    setFSakhiPct('');
    setFReq('');
    setFAdded('');
  };

  const hasActiveFilters =
    fZone.trim() !== '' ||
    fDistrict.trim() !== '' ||
    fAssembly.trim() !== '' ||
    fBooth.trim() !== '' ||
    fSakhiPct.trim() !== '' ||
    fReq.trim() !== '' ||
    fAdded.trim() !== '';

  const loadReport = async (forceRefresh = false) => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(
        authUrl(publicView ? 'public-assembly-dashboard' : 'admin-assembly-dashboard'),
        {
          method: 'POST',
          headers: authHeadersJson(),
          body: JSON.stringify(
            publicView ? { forceRefresh } : { userId: 'admin', password: 'admin@123', forceRefresh }
          ),
        }
      );
      const data = await parseJsonResponse(response);
      if (!response.ok || !data?.success) {
        throw new Error(data?.message || 'Failed to load assembly report');
      }
      const normalized: ReportRow[] = (Array.isArray(data.rows) ? data.rows : []).map((r) => ({
        zone: String(r?.zone ?? '').trim() || '—',
        district: String(r?.district ?? '').trim() || '—',
        assembly: String(r?.assembly ?? '').trim(),
        total_booths: Number(r?.total_booths ?? 0),
        booth_detail_received: Number(r?.booth_detail_received ?? 0),
        booth_detail_received_pct: Number(r?.booth_detail_received_pct ?? 0),
        approx_sakhi_required: Number(r?.approx_sakhi_required ?? 0),
        dob_received: Number(r?.dob_received ?? 0),
        age_55_plus: Number(r?.age_55_plus ?? 0),
        epic_received: Number(r?.epic_received ?? 0),
        aadhaar_received: Number(r?.aadhaar_received ?? 0),
        total_votes: Number(r?.total_votes ?? 0),
        required_sakhi: Number(r?.required_sakhi ?? 0),
        added_sakhi: Number(r?.added_sakhi ?? 0),
        with_epic_added: Number(r?.with_epic_added ?? 0),
        without_epic_added: Number(r?.without_epic_added ?? 0),
      }));
      const visibleRows =
        publicView
          ? normalized.filter((row) => !PUBLIC_HIDDEN_ASSEMBLIES.has(row.assembly.trim().toLowerCase()))
          : normalized;
      setRows(visibleRows);
    } catch (e) {
      setRows([]);
      setError(e instanceof Error ? e.message : 'Failed to load assembly report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadReport();
  }, []);

  return (
    <div className={embedded ? 'w-full' : 'min-h-screen bg-gradient-to-br from-orange-50 to-amber-50'}>
      <div className={`${embedded ? 'max-w-full' : 'max-w-6xl'} mx-auto ${embedded ? '' : 'p-4 py-8'}`}>
        <div className="bg-white rounded-2xl shadow-xl p-8">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
            <div className="flex items-center gap-3">
              <div className="bg-indigo-100 p-3 rounded-xl">
                <BarChart3 className="h-7 w-7 text-indigo-700" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-gray-900">Assembly Report</h1>
                <p className="text-gray-600">Assembly-wise booths, votes, required sakhi and added sakhi</p>
                {publicView ? (
                  <p className="text-xs text-indigo-700 mt-1">
                    Public page — anyone with this link can view aggregated assembly statistics (no login).
                  </p>
                ) : null}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void loadReport(true)}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <p className="text-xs text-gray-500">
              {hasActiveFilters ? (
                <>
                  Showing <span className="font-semibold text-gray-800">{filteredRows.length}</span> of{' '}
                  {rows.length} assemblies (totals below match filters).
                </>
              ) : (
                <>
                  <span className="font-semibold text-gray-800">{rows.length}</span> assemblies
                </>
              )}
            </p>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="text-xs font-medium text-indigo-700 hover:text-indigo-900 underline"
              >
                Clear all filters
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-2 gap-3 mb-4">
            <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3">
              <p className="text-xs uppercase text-gray-500">Total Booth</p>
              <p className="text-xl font-bold tabular-nums text-gray-900">{totals.totalBooths.toLocaleString()}</p>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <p className="text-xs uppercase text-gray-500">Sakhi Details Received</p>
              <p className="text-xl font-bold tabular-nums text-gray-900">{totals.addedSakhi.toLocaleString()}</p>
            </div>
          </div>

          {loading ? (
            <p className="text-sm text-gray-500">Loading report...</p>
          ) : error ? (
            <p className="text-sm text-red-700">{error}</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border-2 border-indigo-200">
              <table className="min-w-[1400px] text-xs border-collapse">
                <thead className="bg-indigo-50 border-b-2 border-indigo-200">
                  <tr>
                    <th className="px-2 py-2 text-left font-semibold text-gray-700 border border-indigo-200">Sr. No</th>
                    <th className="px-2 py-2 text-left font-semibold text-gray-700 border border-indigo-200">Zone</th>
                    <th className="px-2 py-2 text-left font-semibold text-gray-700 border border-indigo-200">District</th>
                    <th className="px-2 py-2 text-left font-semibold text-gray-700 border border-indigo-200">Halka</th>
                    <th className="px-2 py-2 text-right font-semibold text-gray-700 border border-indigo-200">Total Booth</th>
                    <th className="px-2 py-2 text-right font-semibold text-gray-700 border border-indigo-200">Approx Sakhi Reqd.</th>
                    <th className="px-2 py-2 text-right font-semibold text-gray-700 border border-indigo-200">Total Sakhi Details</th>
                    <th className="px-2 py-2 text-right font-semibold text-gray-700 border border-indigo-200">With EPIC</th>
                    <th className="px-2 py-2 text-right font-semibold text-gray-700 border border-indigo-200">Without EPIC</th>
                    <th className="px-2 py-2 text-right font-semibold text-gray-700 border border-indigo-200">% Sakhi Received</th>
                    <th className="px-2 py-2 text-right font-semibold text-gray-700 border border-indigo-200">55+ Age Sakhi</th>
                    <th className="px-2 py-2 text-right font-semibold text-gray-700 border border-indigo-200">EPIC Received</th>
                    <th className="px-2 py-2 text-right font-semibold text-gray-700 border border-indigo-200">Aadhaar Received</th>
                  </tr>
                  <tr className="bg-white border-b border-indigo-200">
                    <th className="px-2 py-2 align-top border border-indigo-100">
                      <span className="text-[10px] text-gray-400">Filter</span>
                    </th>
                    <th className="px-2 py-2 align-top border border-indigo-100">
                      <input
                        type="search"
                        value={fZone}
                        onChange={(e) => setFZone(e.target.value)}
                        placeholder="Zone…"
                        className="w-full min-w-[7rem] rounded border border-gray-300 px-2 py-1 text-xs"
                      />
                    </th>
                    <th className="px-2 py-2 align-top border border-indigo-100">
                      <input
                        type="search"
                        value={fDistrict}
                        onChange={(e) => setFDistrict(e.target.value)}
                        placeholder="District…"
                        className="w-full min-w-[7rem] rounded border border-gray-300 px-2 py-1 text-xs"
                      />
                    </th>
                    <th className="px-2 py-2 align-top border border-indigo-100">
                      <input
                        type="search"
                        value={fAssembly}
                        onChange={(e) => setFAssembly(e.target.value)}
                        placeholder="Halka…"
                        className="w-full min-w-[8rem] rounded border border-gray-300 px-2 py-1 text-xs"
                      />
                    </th>
                    <th className="px-2 py-2 align-top border border-indigo-100">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={fBooth}
                        onChange={(e) => setFBooth(e.target.value.replace(/[^\d]/g, ''))}
                        placeholder="Exact no."
                        className="w-full max-w-[6rem] ml-auto block rounded border border-gray-300 px-2 py-1 text-xs font-normal text-right tabular-nums"
                        aria-label="Filter by total booth (exact number)"
                      />
                    </th>
                    <th className="px-2 py-2 align-top border border-indigo-100">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={fReq}
                        onChange={(e) => setFReq(e.target.value.replace(/[^\d]/g, ''))}
                        placeholder="Req no."
                        className="w-full max-w-[7rem] ml-auto block rounded border border-gray-300 px-2 py-1 text-xs font-normal text-right tabular-nums"
                        aria-label="Filter by approx sakhi required (exact number)"
                      />
                    </th>
                    <th className="px-2 py-2 align-top border border-indigo-100">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={fAdded}
                        onChange={(e) => setFAdded(e.target.value.replace(/[^\d]/g, ''))}
                        placeholder="Added no."
                        className="w-full max-w-[7rem] ml-auto block rounded border border-gray-300 px-2 py-1 text-xs font-normal text-right tabular-nums"
                        aria-label="Filter by total sakhi details (exact number)"
                      />
                    </th>
                    <th className="px-2 py-2 border border-indigo-100"></th>
                    <th className="px-2 py-2 border border-indigo-100"></th>
                    <th className="px-2 py-2 align-top border border-indigo-100">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={fSakhiPct}
                        onChange={(e) => setFSakhiPct(e.target.value.replace(/[^\d.]/g, ''))}
                        placeholder="%"
                        className="w-full max-w-[7rem] ml-auto block rounded border border-gray-300 px-2 py-1 text-xs font-normal text-right tabular-nums"
                        aria-label="Filter by % sakhi received (exact 1 decimal)"
                      />
                    </th>
                    <th className="px-2 py-2 border border-indigo-100"></th>
                    <th className="px-2 py-2 border border-indigo-100"></th>
                    <th className="px-2 py-2 border border-indigo-100"></th>
                    <th className="px-2 py-2 border border-indigo-100"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={13} className="px-3 py-6 text-center text-gray-500">
                        No assembly data found.
                      </td>
                    </tr>
                  ) : filteredRows.length === 0 ? (
                    <tr>
                      <td colSpan={13} className="px-3 py-6 text-center text-gray-500">
                        No rows match the current filters.
                      </td>
                    </tr>
                  ) : (
                    rankedRows.map((row, idx) => (
                      <tr
                        key={`${row.assembly}-${idx}`}
                        className={`border-b border-indigo-100 last:border-b-0 ${idx % 2 === 0 ? 'bg-white' : 'bg-indigo-50/30'}`}
                      >
                        <td className="px-2 py-1.5 text-gray-900 border border-indigo-100">{idx + 1}</td>
                        <td className="px-2 py-1.5 text-gray-800 border border-indigo-100">{row.zone}</td>
                        <td className="px-2 py-1.5 text-gray-800 border border-indigo-100">{row.district}</td>
                        <td className="px-2 py-1.5 text-gray-900 font-medium border border-indigo-100">{row.assembly}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums border border-indigo-100">{row.total_booths.toLocaleString()}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums border border-indigo-100">{row.approx_sakhi_required.toLocaleString()}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums border border-indigo-100">{row.added_sakhi.toLocaleString()}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums border border-indigo-100">{row.with_epic_added.toLocaleString()}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums border border-indigo-100">{row.without_epic_added.toLocaleString()}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums border border-indigo-100 font-semibold text-emerald-700">
                          {pct(row.added_sakhi, row.approx_sakhi_required)}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums border border-indigo-100">{row.age_55_plus.toLocaleString()}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums border border-indigo-100">{row.epic_received.toLocaleString()}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums border border-indigo-100">{row.aadhaar_received.toLocaleString()}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
