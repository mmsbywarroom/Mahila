import { useState, useEffect } from 'react';
import { authUrl, authHeadersJson, parseJsonResponse } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { ArrowLeft, ArrowRight, Search } from 'lucide-react';

interface LocationData {
  state: string;
  district: string;
  assembly: string;
  halka: string;
  village: string;
  booth_number: string;
}

interface LocationSelectionProps {
  onNext: (location: LocationData) => void;
  onBack: () => void;
  /** Single-page flow: no Next button; selecting a row notifies parent immediately */
  embedded?: boolean;
}

export default function LocationSelection({ onNext, onBack, embedded }: LocationSelectionProps) {
  const { user } = useAuth();
  const [locations, setLocations] = useState<LocationData[]>([]);
  const [selectedLocation, setSelectedLocation] = useState<LocationData>({
    state: '',
    district: '',
    assembly: '',
    halka: '',
    village: '',
    booth_number: '',
  });
  const [searchText, setSearchText] = useState('');
  const [showResults, setShowResults] = useState(false);

  useEffect(() => {
    loadLocations();
  }, [user?.preferred_assembly]);

  const loadLocations = async () => {
    const preferredAssembly = user?.preferred_assembly;
    const pageSize = 1000;
    let from = 0;
    let hasMore = true;
    const allRows: LocationData[] = [];

    while (hasMore) {
      const response = await fetch(authUrl('list-locations'), {
        method: 'POST',
        headers: authHeadersJson(),
        body: JSON.stringify({
          userId: user?.id,
          preferred_assembly: preferredAssembly || undefined,
          from,
          pageSize,
        }),
      });
      const json = await parseJsonResponse(response);
      if (!response.ok || !json?.success || !Array.isArray(json.data)) {
        break;
      }
      const data = json.data as LocationData[];
      allRows.push(...data);
      hasMore = data.length === pageSize;
      from += pageSize;
    }

    setLocations(allRows);
  };

  const buildLabel = (l: LocationData) =>
    `${l.state} | ${l.district} | ${l.assembly} | ${l.halka} | ${l.village}${l.booth_number ? ` | ${l.booth_number}` : ''}`;

  const normalize = (value: string) => value.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();

  const matchesLocation = (location: LocationData, query: string) => {
    const tokens = normalize(query).split(' ').filter(Boolean);
    if (tokens.length === 0) return true;

    const fields = [
      location.state,
      location.district,
      location.assembly,
      location.halka,
      location.village,
      location.booth_number || '',
    ].map(normalize);

    return tokens.every((token) => fields.some((field) => field.includes(token)));
  };

  const filteredLocations = (searchText
    ? locations.filter((l) => matchesLocation(l, searchText))
    : locations
  ).slice(0, 10);

  const handleSelectLocation = (location: LocationData) => {
    setSelectedLocation(location);
    setSearchText(buildLabel(location));
    setShowResults(false);
    if (embedded) {
      onNext(location);
    }
  };

  const handleNext = () => {
    if (selectedLocation.state && selectedLocation.district && selectedLocation.assembly &&
        selectedLocation.halka && selectedLocation.village) {
      onNext(selectedLocation);
    }
  };

  const isComplete = selectedLocation.state && selectedLocation.district &&
    selectedLocation.assembly && selectedLocation.halka && selectedLocation.village;

  const shell = (
    <>
          {embedded && (
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Location</h2>
            <p className="text-sm text-gray-600">Search and pick one row — neeche EPIC aur form khulega</p>
          </div>
          )}

          <div className="space-y-6">
            <div className="relative">
              <label className="block text-sm font-medium text-gray-700 mb-2">Search Location (single select)</label>
              <Search className="absolute left-3 top-11 h-5 w-5 text-gray-400" />
              <input
                type="text"
                value={searchText}
                onChange={(e) => {
                  setSearchText(e.target.value);
                  setShowResults(true);
                }}
                onFocus={() => setShowResults(true)}
                placeholder="Type Zone / District / AC / Block / Village"
                className="w-full pl-11 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all"
              />

              {showResults && filteredLocations.length > 0 && (
                <div className="absolute z-20 mt-2 w-full max-h-72 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg">
                  {filteredLocations.map((location, index) => (
                    <button
                      key={`${location.state}-${location.district}-${location.assembly}-${location.halka}-${location.village}-${index}`}
                      onClick={() => handleSelectLocation(location)}
                      className="w-full text-left px-4 py-3 hover:bg-orange-50 border-b border-gray-100 last:border-b-0"
                    >
                      <p className="text-sm text-gray-900">{buildLabel(location)}</p>
                    </button>
                  ))}
                </div>
              )}

              {showResults && filteredLocations.length === 0 && searchText.trim().length > 0 && (
                <div className="absolute z-20 mt-2 w-full bg-white border border-gray-200 rounded-lg shadow-lg px-4 py-3 text-sm text-gray-500">
                  No matching location found
                </div>
              )}
            </div>

            {!embedded && (
            <button
              onClick={handleNext}
              disabled={!isComplete}
              className="w-full bg-orange-600 hover:bg-orange-700 text-white font-semibold py-3 rounded-lg transition-all transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none flex items-center justify-center gap-2"
            >
              <span>Next</span>
              <ArrowRight className="h-5 w-5" />
            </button>
            )}
          </div>
    </>
  );

  if (embedded) {
    return <div className="space-y-4">{shell}</div>;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50">
      <div className="max-w-4xl mx-auto p-4 py-8">
        <div className="bg-white rounded-2xl shadow-xl p-8">
          <div className="flex items-center gap-4 mb-8">
            <button
              onClick={onBack}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <ArrowLeft className="h-6 w-6 text-gray-600" />
            </button>
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Location Selection</h1>
              <p className="text-gray-600">Select the location details</p>
            </div>
          </div>
          {shell}
        </div>
      </div>
    </div>
  );
}
