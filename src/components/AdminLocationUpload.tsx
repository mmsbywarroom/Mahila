import { useState } from 'react';
import { authUrl, authHeadersJson, parseJsonResponse } from '../lib/api';
import { ArrowLeft, Upload, CheckCircle, AlertCircle } from 'lucide-react';

interface AdminLocationUploadProps {
  onBack?: () => void;
  embedded?: boolean;
}

interface LocationRow {
  state: string;
  district: string;
  assembly: string;
  halka: string;
  village: string;
  booth_number: string;
}

const ADMIN_USER_ID = 'admin';
const ADMIN_PASSWORD = 'admin@123';
const CHUNK_SIZE = 1000;

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"' && inQuotes && nextChar === '"') {
      current += '"';
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  result.push(current.trim());
  return result;
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[\s/_-]+/g, '');
}

function toLocationRows(csvText: string): LocationRow[] {
  const lines = csvText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]).map(normalizeHeader);

  const zoneIdx = headers.findIndex((h) => h === 'zone');
  const districtIdx = headers.findIndex((h) => h === 'district');
  const assemblyIdx = headers.findIndex((h) => h === 'acname' || h === 'assembly');
  const blockIdx = headers.findIndex((h) => h === 'blocknumber' || h === 'halka');
  const villageIdx = headers.findIndex((h) => h === 'villagewardname' || h === 'village');

  if ([zoneIdx, districtIdx, assemblyIdx, blockIdx, villageIdx].some((i) => i < 0)) {
    throw new Error('CSV headers invalid. Required: Zone, District, AC Name, Block Number, Village/Ward Name');
  }

  return lines.slice(1).map((line) => {
    const cols = parseCsvLine(line);
    return {
      state: cols[zoneIdx] || '',
      district: cols[districtIdx] || '',
      assembly: cols[assemblyIdx] || '',
      halka: cols[blockIdx] || '',
      village: cols[villageIdx] || '',
      booth_number: '',
    };
  }).filter((row) => row.state && row.district && row.assembly && row.halka && row.village);
}

export default function AdminLocationUpload({ onBack, embedded }: AdminLocationUploadProps) {
  const [fileName, setFileName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [progressText, setProgressText] = useState('');

  const handleFileUpload = async (file: File | null) => {
    if (!file) return;

    setFileName(file.name);
    setError('');
    setSuccess('');
    setProgressText('');
    setLoading(true);

    try {
      const csvText = await file.text();
      const rows = toLocationRows(csvText);

      if (rows.length === 0) {
        throw new Error('No valid rows found in CSV.');
      }

      const totalChunks = Math.ceil(rows.length / CHUNK_SIZE);

      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
        const chunk = rows.slice(chunkIndex * CHUNK_SIZE, (chunkIndex + 1) * CHUNK_SIZE);
        setProgressText(`Uploading chunk ${chunkIndex + 1}/${totalChunks}...`);

        const response = await fetch(authUrl('admin-upload-locations'), {
          method: 'POST',
          headers: authHeadersJson(),
          body: JSON.stringify({
            userId: ADMIN_USER_ID,
            password: ADMIN_PASSWORD,
            rows: chunk,
            clearExisting: chunkIndex === 0,
          }),
        });

        const data = await parseJsonResponse(response);
        if (!response.ok || !data.success) {
          throw new Error(data.message || 'CSV upload failed');
        }
      }

      setSuccess(`${rows.length} rows uploaded successfully.`);
      setProgressText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      setProgressText('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={embedded ? 'w-full' : 'min-h-screen bg-gradient-to-br from-orange-50 to-amber-50'}>
      <div className={`${embedded ? 'max-w-full' : 'max-w-3xl'} mx-auto ${embedded ? '' : 'p-4 py-8'}`}>
        <div className="bg-white rounded-2xl shadow-xl p-8">
          <div className="flex items-center gap-4 mb-8">
            {onBack && (
              <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                <ArrowLeft className="h-6 w-6 text-gray-600" />
              </button>
            )}
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Admin CSV Upload</h1>
              <p className="text-gray-600">Upload Zone, District, AC, Block, Village list</p>
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
              Required headers: <span className="font-semibold">Zone, District, AC Name, Block Number, Village/Ward Name</span>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">CSV File</label>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => handleFileUpload(e.target.files?.[0] ?? null)}
                disabled={loading}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all"
              />
              {fileName && <p className="text-xs text-gray-500 mt-2">Selected: {fileName}</p>}
            </div>

            {progressText && (
              <div className="flex items-center gap-2 text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm">
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
