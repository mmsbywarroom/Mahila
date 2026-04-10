import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { authHeadersJson, authUrl, parseJsonResponse } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

interface AssemblyReportProps {
  onBack?: () => void;
}

export default function AssemblyReport({ onBack }: AssemblyReportProps) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState<{
    summary: {
      assembly_name: string;
      no_of_booth: number;
      voters: number;
      no_of_sakhi_added: number;
    };
    boothWise: Array<{
      booth_no: string;
      no_of_voter: number;
      no_of_sakhi_required: number;
      no_of_sakhi_added: number;
    }>;
  } | null>(null);
  const [districtRows, setDistrictRows] = useState<
    Array<{
      district: string;
      assembly: string;
      total_booths: number;
      total_votes: number;
      required_sakhi: number;
      added_sakhi: number;
    }>
  >([]);
  const [reportKind, setReportKind] = useState<'district' | 'zone' | 'assembly' | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError('');
      setReportKind(null);
      try {
        const response = await fetch(authUrl('assembly-report'), {
          method: 'POST',
          headers: authHeadersJson(),
          body: JSON.stringify({ userId: user.id }),
        });
        const json = await parseJsonResponse(response);
        if (!response.ok || !json?.success) {
          throw new Error(json?.message || 'Failed to load report');
        }
        if (!cancelled) {
          const applyDistrictRows = (kind: 'district' | 'zone', rawRows: unknown[]) => {
            setReportKind(kind);
            setDistrictRows(
              rawRows.map((r: any) => ({
                district: String(r?.district ?? ''),
                assembly: String(r?.assembly ?? ''),
                total_booths: Number(r?.total_booths ?? 0),
                total_votes: Number(r?.total_votes ?? 0),
                required_sakhi: Number(r?.required_sakhi ?? 0),
                added_sakhi: Number(r?.added_sakhi ?? 0),
              }))
            );
            setData(null);
          };

          // Prefer explicit scope; assembly shape wins over a stray `rows` field.
          if (json?.scope === 'district') {
            applyDistrictRows('district', Array.isArray(json.rows) ? json.rows : []);
          } else if (json?.scope === 'zone') {
            applyDistrictRows('zone', Array.isArray(json.rows) ? json.rows : []);
          } else if (
            json?.summary &&
            typeof json.summary === 'object' &&
            Array.isArray(json.boothWise)
          ) {
            setReportKind('assembly');
            setData({
              summary: json.summary,
              boothWise: json.boothWise,
            });
            setDistrictRows([]);
          } else if (Array.isArray(json?.rows)) {
            applyDistrictRows('district', json.rows);
          } else {
            setReportKind(null);
            setData(null);
            setDistrictRows([]);
            setError('Report response was incomplete. Try again or contact support.');
          }
        }
      } catch (e) {
        if (!cancelled) {
          setData(null);
          setDistrictRows([]);
          setReportKind(null);
          setError(e instanceof Error ? e.message : 'Failed to load report');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50">
      <div className="max-w-6xl mx-auto p-4 py-8">
        <div className="bg-white rounded-2xl shadow-xl p-8">
          <div className="flex items-center gap-4 mb-6">
            {onBack && (
              <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                <ArrowLeft className="h-6 w-6 text-gray-600" />
              </button>
            )}
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Assembly Report</h1>
              <p className="text-gray-600">Booth-wise voters, required sakhi, and added sakhi</p>
            </div>
          </div>

          {loading ? (
            <p className="text-sm text-gray-500">Loading report…</p>
          ) : error ? (
            <p className="text-sm text-red-700">{error}</p>
          ) : (reportKind === 'district' || reportKind === 'zone') && districtRows.length === 0 ? (
            <p className="text-sm text-gray-600">
              {reportKind === 'zone'
                ? 'No assemblies were found for your zone. Ensure Incharge CSV has Zone and AC Name rows for this zone, and that voter summary (materialized view) is refreshed after uploads.'
                : 'No assemblies were found for your district. Ensure Incharge Management lists your district with AC names, and voter summary is refreshed after voter uploads.'}
            </p>
          ) : districtRows.length > 0 ? (
            <>
              <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-3 py-2 text-gray-600">District</th>
                      <th className="text-left px-3 py-2 text-gray-600">Assembly (AC)</th>
                      <th className="text-right px-3 py-2 text-gray-600">Total Booths</th>
                      <th className="text-right px-3 py-2 text-gray-600">Total Votes</th>
                      <th className="text-right px-3 py-2 text-gray-600">Required Sakhi</th>
                      <th className="text-right px-3 py-2 text-gray-600">Added Sakhi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {districtRows.map((row) => (
                      <tr
                        key={`${row.district}|${row.assembly}`}
                        className="border-b border-gray-100 last:border-b-0"
                      >
                        <td className="px-3 py-2 text-gray-900">{row.district || '—'}</td>
                        <td className="px-3 py-2 text-gray-900">{row.assembly}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{row.total_booths}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{row.total_votes}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{row.required_sakhi}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{row.added_sakhi}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : data?.summary ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                <div className="rounded-lg border border-gray-200 bg-white p-3">
                  <p className="text-xs text-gray-500 uppercase">Assembly Name</p>
                  <p className="text-sm font-semibold text-gray-900">{data.summary.assembly_name}</p>
                </div>
                <div className="rounded-lg border border-gray-200 bg-white p-3">
                  <p className="text-xs text-gray-500 uppercase">No of Booth</p>
                  <p className="text-xl font-bold text-gray-900 tabular-nums">{data.summary.no_of_booth}</p>
                </div>
                <div className="rounded-lg border border-gray-200 bg-white p-3">
                  <p className="text-xs text-gray-500 uppercase">Voters</p>
                  <p className="text-xl font-bold text-gray-900 tabular-nums">{data.summary.voters}</p>
                </div>
                <div className="rounded-lg border border-gray-200 bg-white p-3">
                  <p className="text-xs text-gray-500 uppercase">No of Sakhi Added</p>
                  <p className="text-xl font-bold text-gray-900 tabular-nums">{data.summary.no_of_sakhi_added}</p>
                </div>
              </div>

              <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-3 py-2 text-gray-600">Booth No</th>
                      <th className="text-right px-3 py-2 text-gray-600">No of voter</th>
                      <th className="text-right px-3 py-2 text-gray-600">No of sakhi required</th>
                      <th className="text-right px-3 py-2 text-gray-600">No of sakhi added</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.boothWise ?? []).length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-3 py-4 text-center text-gray-500">No booth data</td>
                      </tr>
                    ) : (
                      (data.boothWise ?? []).map((row) => (
                        <tr key={row.booth_no} className="border-b border-gray-100 last:border-b-0">
                          <td className="px-3 py-2 text-gray-900">{row.booth_no}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{row.no_of_voter}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{row.no_of_sakhi_required}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{row.no_of_sakhi_added}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
