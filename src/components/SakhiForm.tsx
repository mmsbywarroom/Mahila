import { useEffect, useState, useRef } from 'react';
import { authUrl, authHeadersJson, uploadUrl, apiBearerToken, parseJsonResponse } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { buildLocationFromUser, type LocationData } from '../lib/profileHelpers';
import { validateIndianMobile10, validateAadhaar12 } from '../lib/validation';
import { ArrowLeft, Upload, CheckCircle, Search, Lock, Loader2 } from 'lucide-react';

interface SakhiFormProps {
  onBack: () => void;
  onSuccess: () => void;
}

export const VOTER_FIELD_LABELS: Record<string, string> = {
  e_first_name: 'First name',
  guardian_relation: 'Relationship',
  e_middle_name: 'Father / Husband (roll)',
  sex: 'Sex',
  age: 'Age',
  vcardid: 'EPIC',
  boothid: 'Booth No.',
  part_no: 'Part no.',
  srno: 'Serial no.',
  e_assemblyname: 'Halka',
  mobile_number: 'Mobile Number',
  dob: 'DOB',
  aadhaar_number: 'Aadhaar Number',
};

export const VOTER_EDITABLE_KEYS = [
  'e_first_name',
  'guardian_relation',
  'e_middle_name',
  'sex',
  'age',
  'vcardid',
  'boothid',
  'part_no',
  'srno',
  'e_assemblyname',
  'mobile_number',
  'dob',
  'aadhaar_number',
] as const;

/** Manual “Without EPIC” form: EPIC first, then booth; sex fixed Female; DOB -> age (from DOB). */
const WITHOUT_EPIC_FORM_KEYS = [
  'vcardid',
  'boothid',
  'e_first_name',
  'e_middle_name',
  'sex',
  'dob',
  'age',
  'srno',
  'e_assemblyname',
  'mobile_number',
  'aadhaar_number',
] as const satisfies readonly (typeof VOTER_EDITABLE_KEYS)[number][];

/** After successful EPIC match: shown read-only at top, not repeated in form */
const LOCKED_ROLL_KEYS = [
  'e_first_name',
  'sex',
  'age',
  'vcardid',
  'boothid',
  'part_no',
  'srno',
  'e_assemblyname',
] as const;

/** Fields always edited in the form section below (first name is read-only above when matched) */
const FORM_KEYS_EDIT = ['e_middle_name', 'mobile_number', 'dob', 'aadhaar_number'] as const;

function emptyVoterRecord(): Record<string, string> {
  return Object.fromEntries(VOTER_EDITABLE_KEYS.map((k) => [k, '']));
}

/** Normalize voter roll / free-text DOB to YYYY-MM-DD for `<input type="date" />` */
function normalizeDobForInput(raw: string): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) {
    const dd = m[1].padStart(2, '0');
    const mm = m[2].padStart(2, '0');
    return `${m[3]}-${mm}-${dd}`;
  }
  return '';
}

/** Roll `sex` indicates male — Sakhi entries must be female only. */
function isRollSexMale(raw: string): boolean {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return false;
  const isFemale =
    s === 'f' ||
    s === 'female' ||
    s.includes('महिला') ||
    s.includes('स्त्री');
  if (isFemale) return false;
  return (
    s === 'm' ||
    s === 'male' ||
    /^m[\s./_-]*$/i.test(String(raw ?? '').trim()) ||
    /\bmale\b/i.test(s) ||
    s.includes('पुरुष')
  );
}

/** Age in full years from YYYY-MM-DD (used when DOB drives age in manual / without-EPIC flow). */
function ageFromIsoDob(iso: string): string {
  const s = normalizeDobForInput(iso);
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const birth = new Date(`${s}T12:00:00`);
  if (Number.isNaN(birth.getTime())) return '';
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age -= 1;
  if (age < 0 || age > 120) return '';
  return String(age);
}

function dobFromAgeYears(ageStr: string): string {
  const ageNum = parseInt(String(ageStr).replace(/\D/g, ''), 10);
  if (Number.isNaN(ageNum) || ageNum < 1 || ageNum > 120) return '';
  const y = new Date().getFullYear() - ageNum;
  return `${y}-01-01`;
}

function normalizeOcrTextInput(text: string): string {
  const t = String(text ?? '').trim();
  if (!t) return '';
  const fenced = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : t;
}

function tryParseJsonLike(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

export default function SakhiForm({ onBack, onSuccess }: SakhiFormProps) {
  const { user } = useAuth();
  const [location, setLocation] = useState<LocationData | null>(null);
  const [epicInput, setEpicInput] = useState('');
  const [voterFields, setVoterFields] = useState<Record<string, string>>(emptyVoterRecord);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupMessage, setLookupMessage] = useState('');
  /** true when EPIC lookup returned a voter — roll fields shown read-only above */
  const [lookupMatchedRoll, setLookupMatchedRoll] = useState(false);
  /** Male voter matched by EPIC — show roll read-only but block submission */
  const [maleEpicBlock, setMaleEpicBlock] = useState(false);
  /** User chose entry without EPIC search — manual voter form (no upload step) */
  const [withoutEpicMode, setWithoutEpicMode] = useState(false);
  const [files, setFiles] = useState({
    aadhaarFront: null as File | null,
    aadhaarBack: null as File | null,
    voterId: null as File | null,
  });
  const [livePhoto, setLivePhoto] = useState<string | null>(null);
  const [livePhotoFile, setLivePhotoFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [ocrPreview, setOcrPreview] = useState<{ label: string; text: string }[]>([]);
  const [ocrRawByLabel, setOcrRawByLabel] = useState<Record<string, { label: string; text: string; raw: unknown }>>({});
  const [preUploadedUrls, setPreUploadedUrls] = useState<{
    aadhaarFront?: string | null;
    aadhaarBack?: string | null;
    voterId?: string | null;
  }>({});
  /** Physical collection — both must be Yes to submit */
  const [documentsCollectedAadhaar, setDocumentsCollectedAadhaar] = useState<'yes' | 'no' | ''>('');
  const [documentsCollectedVoter, setDocumentsCollectedVoter] = useState<'yes' | 'no' | ''>('');

  /** Show voter roll + form after EPIC match, without-EPIC manual flow, or male-EPIC read-only preview */
  const showVoterForm = lookupMatchedRoll || withoutEpicMode || maleEpicBlock;
  const allowFirstNameEditOnMatchedRoll =
    lookupMatchedRoll && !(voterFields.e_first_name || '').trim();
  const editableFormKeys: readonly (typeof VOTER_EDITABLE_KEYS)[number][] = lookupMatchedRoll
    ? (allowFirstNameEditOnMatchedRoll
        ? (['e_first_name', ...FORM_KEYS_EDIT] as const)
        : FORM_KEYS_EDIT)
    : withoutEpicMode
      ? [...WITHOUT_EPIC_FORM_KEYS]
      : VOTER_EDITABLE_KEYS;

  const photoInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!user) return;
    setLocation(buildLocationFromUser(user));
  }, [user]);

  /** Without-EPIC manual form: Halka (`e_assemblyname`) = user’s AC / assembly from login profile. */
  useEffect(() => {
    if (!withoutEpicMode || !location?.assembly?.trim()) return;
    const asm = location.assembly.trim();
    setVoterFields((prev) => {
      const next = { ...prev };
      if (!next.e_assemblyname?.trim()) next.e_assemblyname = asm;
      // Without-EPIC flow is for female entries only.
      next.sex = 'Female';
      return next;
    });
  }, [withoutEpicMode, location?.assembly]);

  const lookupVoterByEpic = async () => {
    const epicRaw = epicInput;
    const epic = epicRaw.trim();
    if (!epic || !location) {
      if (!location) {
        setLookupMessage('Your profile must have an assembly (AC) assigned.');
      }
      return;
    }
    setLookupLoading(true);
    setLookupMessage('');
    setError('');
    setMaleEpicBlock(false);
    try {
      const response = await fetch(authUrl('lookup-voter'), {
        method: 'POST',
        headers: authHeadersJson(),
        body: JSON.stringify({
          epic,
          assembly: location.assembly,
        }),
      });
      const data = await parseJsonResponse(response);
      if (!response.ok || !data?.success) {
        throw new Error(data?.message || 'Lookup failed');
      }
      if (!data.voter) {
        setLookupMatchedRoll(false);
        setMaleEpicBlock(false);
        setWithoutEpicMode(false);
        setLookupMessage(
          'No voter record for this EPIC in the list. Use “Without EPIC number” to enter details manually.'
        );
        return;
      }
      if (data.alreadySubmitted) {
        setLookupMatchedRoll(false);
        setMaleEpicBlock(false);
        setWithoutEpicMode(false);
        setLookupMessage(
          `A submission already exists for this EPIC / Voter ID (Booth: ${String(data.submittedBooth || '—')}).`
        );
        return;
      }
      const row = data.voter as Record<string, unknown>;
      const sexFromRoll = String(row.sex ?? '').trim();
      const next: Record<string, string> = { ...emptyVoterRecord() };
      VOTER_EDITABLE_KEYS.forEach((k) => {
        const v = row[k];
        next[k] = v === null || v === undefined ? '' : String(v);
      });
      if (!next.e_first_name.trim()) {
        next.e_first_name = String(row.full_name ?? row.e_first_name ?? '').trim();
      }
      next.mobile_number = voterFields.mobile_number || next.mobile_number || '';
      next.aadhaar_number = voterFields.aadhaar_number || next.aadhaar_number || '';
      let d = normalizeDobForInput(String(next.dob ?? ''));
      if (!d) d = dobFromAgeYears(String(next.age ?? '')) || '';
      next.dob = d;
      setVoterFields(next);
      if (isRollSexMale(sexFromRoll)) {
        setLookupMatchedRoll(false);
        setWithoutEpicMode(false);
        setMaleEpicBlock(true);
        setLookupMessage('');
        setError('This is a male EPIC number. Kindly search a female EPIC number.');
        return;
      }
      setMaleEpicBlock(false);
      setLookupMatchedRoll(true);
      setWithoutEpicMode(false);
      setLookupMessage('');
    } catch (e) {
      setLookupMatchedRoll(false);
      setMaleEpicBlock(false);
      setWithoutEpicMode(false);
      setLookupMessage(
        e instanceof Error ? e.message : 'Lookup failed. Try again or use “Without EPIC number”.'
      );
    } finally {
      setLookupLoading(false);
    }
  };

  const updateVoterField = (key: string, value: string) => {
    setVoterFields((prev) => ({ ...prev, [key]: value }));
  };

  const setDobAndComputedAge = (isoDate: string) => {
    setVoterFields((prev) => ({
      ...prev,
      dob: isoDate,
      age: ageFromIsoDob(isoDate),
    }));
  };

  const startWithoutEpic = () => {
    setWithoutEpicMode(true);
    setLookupMatchedRoll(false);
    setMaleEpicBlock(false);
    const ac = location?.assembly?.trim() ?? '';
    setVoterFields({ ...emptyVoterRecord(), sex: 'Female', e_assemblyname: ac });
    setEpicInput('');
    setLookupMessage('');
    setError('');
    setFiles((f) => ({ ...f, voterId: null }));
    setPreUploadedUrls((p) => ({ ...p, voterId: null }));
    setOcrPreview((prev) => prev.filter((x) => x.label !== 'voter_id'));
    setOcrRawByLabel((prev) => {
      const next = { ...prev };
      delete next.voter_id;
      return next;
    });
  };

  const handleFileChange = (field: keyof typeof files, file: File | null) => {
    setFiles({ ...files, [field]: file });
  };

  const uploadFile = async (file: File, path: string): Promise<string | null> => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('path', path);
    const response = await fetch(uploadUrl(), {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiBearerToken()}` },
      body: formData,
    });
    const data = await parseJsonResponse(response);
    if (!response.ok || !data?.success || !data?.url) return null;
    return data.url as string;
  };

  const readOCR = async (imageUrl: string, label: string) => {
    const response = await fetch(authUrl('ocr-extract'), {
      method: 'POST',
      headers: authHeadersJson(),
      body: JSON.stringify({
        userId: 'admin',
        password: 'admin@123',
        imageUrl,
        docType: label,
      }),
    });

    const data = await parseJsonResponse(response);
    if (!response.ok || !data?.success) {
      throw new Error(data?.message || data?.raw?.error?.message || 'OCR request failed');
    }
    return {
      label,
      text: data?.extractedText || JSON.stringify(data?.raw || {}, null, 2) || 'No text extracted',
      raw: data?.raw || null,
    };
  };

  const extractAadhaarFrontFields = (text: string) => {
    const normalized = text.replace(/\r/g, '');
    const lines = normalized.split('\n').map((l) => l.trim()).filter(Boolean);

    const aadhaarMatch = normalized.match(/\b\d{4}\s?\d{4}\s?\d{4}\b/);
    const dobMatch = normalized.match(/\b(?:DOB|DoB|Year of Birth)\s*[:\-]?\s*(\d{2}\/\d{2}\/\d{4}|\d{4})/i)
      || normalized.match(/\b(\d{2}\/\d{2}\/\d{4})\b/);

    let name = '';
    for (const line of lines) {
      if (
        /government of india|भारत सरकार|male|female|year of birth|dob|aadhaar|आधार|vid/i.test(line)
      ) {
        continue;
      }
      if (/[a-zA-Z\u0900-\u097F]/.test(line) && line.length > 2 && line.length < 60) {
        name = line;
        break;
      }
    }

    let guardian = '';
    const guardianLine = lines.find((l) => /(S\/O|D\/O|W\/O|C\/O|पिता|पति|husband|father)/i.test(l));
    if (guardianLine) {
      guardian = guardianLine.replace(/^(S\/O|D\/O|W\/O|C\/O|पिता|पति|husband|father)\s*[:\-]?\s*/i, '').trim();
    }

    return {
      name,
      dob: dobMatch ? dobMatch[1] || dobMatch[0] : '',
      aadhaarNumber: aadhaarMatch ? aadhaarMatch[0].replace(/\s+/g, ' ').trim() : '',
      guardian,
    };
  };

  const extractAadhaarBackAddress = (text: string) => {
    const normalized = text.replace(/\r/g, '');
    const addressStart = normalized.search(/address|पता/i);
    const source = addressStart >= 0 ? normalized.slice(addressStart) : normalized;
    const lines = source.split('\n').map((l) => l.trim()).filter(Boolean);

    const usefulLines = lines.filter(
      (line) =>
        !/^\d{4}\s?\d{4}\s?\d{4}$/.test(line) &&
        !/^VID[:\s]/i.test(line) &&
        !/uidai|help|www\.|government|aadhaar|आधार/i.test(line)
    );

    const addressOnly = usefulLines.filter(
      (line) =>
        /address|पता|s\/o|d\/o|w\/o|house|h\.?no|street|road|lane|village|ward|district|state|pin|po|ps|\d{6}/i.test(line)
    );

    const finalLines = (addressOnly.length > 0 ? addressOnly : usefulLines)
      .filter((line) => !/^address[:\s-]*$/i.test(line))
      .slice(0, 7);

    let address = finalLines.join(', ');
    if (!address) {
      const fallback = normalized
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 3)
        .filter((l) => !/vid|uidai|help@|www\.|government|आधार|aadhaar/i.test(l))
        .filter((l) => /[a-zA-Z\u0900-\u097F]/.test(l))
        .slice(0, 5);
      address = fallback.join(', ');
    }

    return address;
  };

  const extractVoterFields = (text: string) => {
    const cleanedInput = normalizeOcrTextInput(text);
    const asJson = tryParseJsonLike(cleanedInput);
    if (asJson) {
      const get = (...keys: string[]): string => {
        for (const k of keys) {
          const v = asJson[k];
          if (v !== null && v !== undefined && String(v).trim() !== '') return String(v).trim();
        }
        return '';
      };
      const epicRaw = get('vcardid', 'epic', 'epic_number', 'voter_id');
      const relationRaw = get('guardian_relation', 'relation');
      const sexRaw = get('sex', 'gender');
      const sexOut = sexRaw
        ? /^(m|male)$/i.test(sexRaw) || /पुरुष/i.test(sexRaw)
          ? 'M'
          : /^(f|female)$/i.test(sexRaw) || /महिला|स्त्री/i.test(sexRaw)
            ? 'F'
            : sexRaw.slice(0, 1).toUpperCase()
        : '';
      return {
        epicNumber: epicRaw ? epicRaw.toUpperCase() : '',
        name: get('e_first_name', 'first_name', 'name', 'full_name'),
        guardian: get('e_middle_name', 'guardian', 'father_name', 'husband_name'),
        sex: sexOut,
        dob: get('dob', 'date_of_birth'),
        mobile: get('mobile_number', 'mobile', 'phone'),
        aadhaarNumber: get('aadhaar_number', 'aadhaar', 'aadhar'),
        relationHint:
          /father/i.test(relationRaw) ? 'father' : /husband/i.test(relationRaw) ? 'husband' : '',
      };
    }

    const normalized = cleanedInput.replace(/\r/g, '\n');
    const lines = normalized.split('\n').map((l) => l.trim()).filter(Boolean);
    const fullOneLine = normalized.replace(/\s+/g, ' ');

    const epicMatch = normalized.match(/\b[A-Z]{3}\d{7}\b/i);
    const mobileMatch = normalized.match(/\b[6-9]\d{9}\b/);
    const aadhaarMatch = normalized.match(/\b\d{4}\s?\d{4}\s?\d{4}\b/);
    const dobMatch =
      normalized.match(/\b(?:DOB|Date of Birth|जन्म तिथि)\s*[:\-]?\s*(\d{2}[\/.-]\d{2}[\/.-]\d{4})/i) ||
      normalized.match(/\b(\d{2}[\/.-]\d{2}[\/.-]\d{4})\b/) ||
      normalized.match(/\b(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{4})\b/);
    const sexMatch =
      normalized.match(/\b(male|female|पुरुष|महिला|स्त्री|M\/F|लिंग)\b/i);

    const pickEnglishName = (raw: string): string => {
      let v = raw.replace(/^[:\s\-|]+/, '').trim();
      const latin = v.match(/[A-Za-z][A-Za-z0-9\s.'-]{0,79}/);
      if (latin) v = latin[0].trim();
      return v.replace(/\s+/g, ' ').trim();
    };

    const isValidPersonName = (s: string): boolean => {
      const t = s.trim();
      if (t.length < 3 || t.length > 80) return false;
      const up = t.toUpperCase();
      const deny = new Set([
        'PIC',
        'EPIC',
        'ID',
        'UID',
        'NAME',
        'CARD',
        'VOTER',
        'INDIA',
        'SEX',
        'AGE',
        'DOB',
        'MALE',
        'FEMALE',
        'ELECTION',
        'COMMISSION',
        'IDENTITY',
        'PHOTO',
        'YEAR',
        'OLD',
      ]);
      if (deny.has(up)) return false;
      if (/^(PIC|EPIC|UID|ID)$/i.test(t)) return false;
      if (!/[A-Za-z]{2,}/.test(t)) return false;
      return true;
    };

    let name = '';
    let guardian = '';
    let relationHint: '' | 'father' | 'husband' = '';

    // --- Same-line (new PVC + many old cards): "ELECTOR'S NAME : RINKPAL KAUR" / HUSBAND'S NAME : ...
    /** Matches ASCII or curly apostrophe between letters (e.g. ELECTOR'S) */
    const electorApost = "(?:'|\u2019)";
    const electorInline =
      fullOneLine.match(
        new RegExp(
          `ELECTOR${electorApost}?S\\s*NAME\\s*[:\\-–—|.]+\\s*([A-Za-z][A-Za-z0-9\\s.'-]{2,70}?)(?=\\s+(?:FATHER|HUSBAND|SEX|AGE|DATE|ELECTOR|EPIC|ਪਿਤਾ|ਪਤੀ)|$)`,
          'i'
        )
      ) ||
      fullOneLine.match(
        new RegExp(`ELECTOR${electorApost}?S\\s*NAME\\s*[:\\-–—|]+\\s*([A-Za-z][A-Za-z0-9\\s.'-]{2,70})`, 'i')
      );
    if (electorInline) {
      const cand = pickEnglishName(electorInline[1]);
      if (isValidPersonName(cand)) name = cand;
    }

    /** OCR often drops apostrophe/colon — try several shapes for "HUSBAND'S NAME" / "FATHER'S NAME" */
    const tryGuardianInline = (full: string): { g: string; rel: 'father' | 'husband' } | null => {
      const patterns: RegExp[] = [
        // Standard: HUSBAND'S NAME : VALUE
        new RegExp(
          `HUSBAND${electorApost}?S\\s*NAME\\s*[:\\-–—|.]+\\s*([A-Za-z][A-Za-z0-9\\s.'-]{2,70})`,
          'i'
        ),
        // No colon — space only after NAME (common OCR)
        new RegExp(
          `HUSBAND${electorApost}?S\\s*NAME\\s+([A-Za-z][A-Za-z0-9\\s.'-]{2,70}?)(?=\\s+(?:FATHER|SEX|AGE|DATE|ELECTOR|EPIC|ਪਿਤਾ|ਪਤੀ)|$)`,
          'i'
        ),
        // Missing apostrophe: "HUSBANDS NAME" or "HUSBAND S NAME"
        /HUSBANDS?\s+NAME\s*[:\s\-–—|.]*\s*([A-Za-z][A-Za-z0-9\s.'-]{2,70}?)(?=\s+(?:FATHER|SEX|AGE|EPIC|ELECTOR)|$)/i,
        /NAME\s+OF\s+HUSBAND\s*[:\s\-–—|.]*\s*([A-Za-z][A-Za-z0-9\s.'-]{2,70})/i,
      ];
      const fatherPatterns: RegExp[] = [
        new RegExp(`FATHER${electorApost}?S\\s*NAME\\s*[:\\-–—|.]+\\s*([A-Za-z][A-Za-z0-9\\s.'-]{2,70})`, 'i'),
        new RegExp(
          `FATHER${electorApost}?S\\s*NAME\\s+([A-Za-z][A-Za-z0-9\\s.'-]{2,70}?)(?=\\s+(?:HUSBAND|SEX|AGE|DATE|ELECTOR|EPIC|ਪਿਤਾ|ਪਤੀ)|$)`,
          'i'
        ),
        /FATHERS?\s+NAME\s*[:\s\-–—|.]*\s*([A-Za-z][A-Za-z0-9\s.'-]{2,70}?)(?=\s+(?:HUSBAND|SEX|AGE|EPIC|ELECTOR)|$)/i,
        /NAME\s+OF\s+FATHER\s*[:\s\-–—|.]*\s*([A-Za-z][A-Za-z0-9\s.'-]{2,70})/i,
      ];
      for (const re of patterns) {
        const m = full.match(re);
        if (m) {
          const g = pickEnglishName(m[1]);
          if (isValidPersonName(g)) return { g, rel: 'husband' };
        }
      }
      for (const re of fatherPatterns) {
        const m = full.match(re);
        if (m) {
          const g = pickEnglishName(m[1]);
          if (isValidPersonName(g)) return { g, rel: 'father' };
        }
      }
      return null;
    };

    const husbandInline = fullOneLine.match(
      new RegExp(
        `HUSBAND${electorApost}?S\\s*NAME\\s*[:\\-–—|.]+\\s*([A-Za-z][A-Za-z0-9\\s.'-]{2,70}?)(?=\\s+(?:FATHER|SEX|AGE|DATE|ELECTOR|EPIC|ਪਿਤਾ|$)|$)`,
        'i'
      )
    );
    const fatherInline = fullOneLine.match(
      new RegExp(
        `FATHER${electorApost}?S\\s*NAME\\s*[:\\-–—|.]+\\s*([A-Za-z][A-Za-z0-9\\s.'-]{2,70}?)(?=\\s+(?:HUSBAND|SEX|AGE|DATE|ELECTOR|EPIC|ਪਤੀ|$)|$)`,
        'i'
      )
    );

    if (husbandInline) {
      const g = pickEnglishName(husbandInline[1]);
      if (isValidPersonName(g)) {
        guardian = g;
        relationHint = 'husband';
      }
    }
    if (!guardian && fatherInline) {
      const g = pickEnglishName(fatherInline[1]);
      if (isValidPersonName(g)) {
        guardian = g;
        relationHint = 'father';
      }
    }

    // --- Multi-line: label on one line, English name on next line (older laminated cards)
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const next = lines[i + 1] || '';
      const next2 = lines[i + 2] || '';

      const sameLineElector = line.match(
        new RegExp(`ELECTOR${electorApost}?S\\s*NAME\\s*[:\\-–—|.]+\\s*([A-Za-z][A-Za-z0-9\\s.'-]{2,70})`, 'i')
      );
      if (sameLineElector && !name) {
        const cand = pickEnglishName(sameLineElector[1]);
        if (isValidPersonName(cand)) name = cand;
      }

      if (
        !name &&
        new RegExp(`ELECTOR${electorApost}?S\\s*NAME|मतदाता|ਚੋਣਕਾਰ|ਵੋਟਰ`, 'i').test(line) &&
        !sameLineElector
      ) {
        for (const candLine of [next, next2]) {
          if (!candLine) continue;
          if (/^(FATHER|HUSBAND|ELECTOR|SEX|AGE|EPIC)/i.test(candLine)) continue;
          const cand = pickEnglishName(candLine);
          if (isValidPersonName(cand)) {
            name = cand;
            break;
          }
        }
      }

      const sameHusband = line.match(
        new RegExp(`HUSBAND${electorApost}?S\\s*NAME\\s*[:\\-–—|.]+\\s*([A-Za-z][A-Za-z0-9\\s.'-]{2,70})`, 'i')
      );
      const sameFather = line.match(
        new RegExp(`FATHER${electorApost}?S\\s*NAME\\s*[:\\-–—|.]+\\s*([A-Za-z][A-Za-z0-9\\s.'-]{2,70})`, 'i')
      );
      if (!guardian && sameHusband) {
        const g = pickEnglishName(sameHusband[1]);
        if (isValidPersonName(g)) {
          guardian = g;
          relationHint = 'husband';
        }
      } else if (!guardian && sameFather) {
        const g = pickEnglishName(sameFather[1]);
        if (isValidPersonName(g)) {
          guardian = g;
          relationHint = 'father';
        }
      }

      if (
        !guardian &&
        new RegExp(`HUSBAND${electorApost}?S\\s*NAME|ਪਤੀ|पति`, 'i').test(line) &&
        !sameHusband
      ) {
        for (const candLine of [next, next2]) {
          if (!candLine) continue;
          if (/^(FATHER|ELECTOR|SEX|AGE|EPIC|HUSBAND)/i.test(candLine)) continue;
          const g = pickEnglishName(candLine);
          if (isValidPersonName(g)) {
            guardian = g;
            relationHint = 'husband';
            break;
          }
        }
      }

      if (
        !guardian &&
        new RegExp(`FATHER${electorApost}?S\\s*NAME|पिता|ਪਿਤਾ`, 'i').test(line) &&
        !sameFather &&
        relationHint !== 'husband'
      ) {
        for (const candLine of [next, next2]) {
          if (!candLine) continue;
          if (/^(HUSBAND|ELECTOR|SEX|AGE|EPIC|FATHER)/i.test(candLine)) continue;
          const g = pickEnglishName(candLine);
          if (isValidPersonName(g)) {
            guardian = g;
            relationHint = 'father';
            break;
          }
        }
      }
    }

    if (!guardian) {
      const relaxed = tryGuardianInline(fullOneLine);
      if (relaxed) {
        guardian = relaxed.g;
        relationHint = relaxed.rel;
      }
    }

    // --- Last-resort name: line with 2+ capital words, not a label (avoid "PIC" from watermarks)
    if (!name) {
      for (const line of lines) {
        if (/ELECTION|COMMISSION|IDENTITY|CARD|PHOTO|EPIC|BARCODE|ਭਾਰਤ|ਨਿਰਵਾਚਨ/i.test(line)) continue;
        if (!/[A-Za-z]{3,}/.test(line)) continue;
        const m = line.match(/\b([A-Z][A-Z]+(?:\s+[A-Z][A-Z]+)+)\b/);
        if (m && isValidPersonName(m[1])) {
          name = m[1].trim();
          break;
        }
      }
    }

    let sexOut = '';
    if (sexMatch) {
      const s = sexMatch[0].replace(/^लिंग\s*\/?\s*/i, '').toLowerCase();
      if (s.startsWith('m') || s.includes('पुरुष')) sexOut = 'M';
      else if (s.startsWith('f') || s.includes('महिला') || s.includes('स्त्री')) sexOut = 'F';
      else sexOut = sexMatch[0].slice(0, 1).toUpperCase();
    }

    const guardianClean = guardian
      .replace(/\s+(SEX|AGE|EPIC|ELECTOR|DOB|MALE|FEMALE|YEAR)\s*$/i, '')
      .trim();

    return {
      epicNumber: epicMatch ? epicMatch[0].toUpperCase() : '',
      name,
      guardian: guardianClean,
      sex: sexOut,
      dob: dobMatch ? dobMatch[1] || dobMatch[0] : '',
      mobile: mobileMatch ? mobileMatch[0] : '',
      aadhaarNumber: aadhaarMatch ? aadhaarMatch[0].replace(/\s+/g, ' ').trim() : '',
      relationHint,
    };
  };

  const applyVoterIdOcrToVoterFields = (rawText: string) => {
    const data = extractVoterFields(rawText);
    setVoterFields((prev) => {
      const next = { ...prev };
      if (data.name.trim()) next.e_first_name = data.name.trim();
      if (data.guardian.trim()) next.e_middle_name = data.guardian.trim();
      if (data.epicNumber) next.vcardid = data.epicNumber;
      const dobIso = normalizeDobForInput(data.dob);
      if (dobIso) next.dob = dobIso;
      if (data.sex) next.sex = data.sex;
      if (data.mobile) next.mobile_number = data.mobile.replace(/\D/g, '').slice(0, 10);
      if (data.aadhaarNumber) next.aadhaar_number = data.aadhaarNumber.replace(/\D/g, '').slice(0, 12);
      if (data.relationHint === 'father' || data.relationHint === 'husband') {
        next.guardian_relation = data.relationHint;
      }
      return next;
    });
  };

  const formatPreviewForLabel = (label: string, text: string) => {
    if (label === 'aadhaar_front') {
      const data = extractAadhaarFrontFields(text);
      return [
        `Name: ${data.name || '-'}`,
        `DOB: ${data.dob || '-'}`,
        `Aadhaar Number: ${data.aadhaarNumber || '-'}`,
        `Father/Husband: ${data.guardian || '-'}`,
      ].join('\n');
    }

    if (label === 'aadhaar_back') {
      const address = extractAadhaarBackAddress(text);
      return `Address: ${address || '-'}`;
    }

    if (label === 'voter_id') {
      const data = extractVoterFields(text);
      return [
        `EPIC Number: ${data.epicNumber || '-'}`,
        `Name: ${data.name || '-'}`,
        `Father/Husband: ${data.guardian || '-'}`,
        `Relationship: ${data.relationHint || '-'}`,
        `Sex: ${data.sex || '-'}`,
        `Date of Birth: ${data.dob || '-'}`,
        `Mobile: ${data.mobile || '-'}`,
        `Aadhaar: ${data.aadhaarNumber || '-'}`,
      ].join('\n');
    }

    return text;
  };

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        if (typeof result !== 'string') {
          reject(new Error('Unable to read file'));
          return;
        }
        const base64 = result.includes(',') ? result.split(',')[1] : result;
        resolve(base64);
      };
      reader.onerror = () => reject(new Error('Unable to read file'));
      reader.readAsDataURL(file);
    });

  const readOCRFromFile = async (file: File, label: string) => {
    const imageBase64 = await fileToBase64(file);
    const response = await fetch(authUrl('ocr-extract'), {
      method: 'POST',
      headers: authHeadersJson(),
      body: JSON.stringify({
        userId: 'admin',
        password: 'admin@123',
        imageUrl: '',
        imageBase64,
        docType: label,
      }),
    });

    const data = await parseJsonResponse(response);
    if (!response.ok || !data?.success) {
      throw new Error(data?.message || data?.raw?.error?.message || 'OCR request failed');
    }
    return {
      label,
      text: data?.extractedText || JSON.stringify(data?.raw || {}, null, 2) || 'No text extracted',
      raw: data?.raw || null,
    };
  };

  const runInstantOCRForFile = async (
    field: keyof typeof files,
    file: File | null,
    uploadPath: string,
    label: string
  ) => {
    handleFileChange(field, file);
    if (!file) return;

    setError('');
    setOcrLoading(true);
    try {
      const ocrItem = await readOCRFromFile(file, label);
      if (label === 'voter_id' && withoutEpicMode) {
        applyVoterIdOcrToVoterFields(ocrItem.text);
      }
      const formattedText = formatPreviewForLabel(label, ocrItem.text);
      setOcrRawByLabel((prev) => ({ ...prev, [label]: ocrItem }));
      setOcrPreview((prev) => {
        const filtered = prev.filter((item) => item.label !== label);
        return [...filtered, { label, text: formattedText }];
      });

      const uploadedUrl = await uploadFile(file, uploadPath);
      if (uploadedUrl) {
        setPreUploadedUrls((prev) => ({ ...prev, [field]: uploadedUrl }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'OCR read failed. Please try again.');
    } finally {
      setOcrLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (maleEpicBlock) {
      setError('This is a male EPIC number. Kindly search a female EPIC number.');
      return;
    }
    if (!location) {
      setError('Your account does not have an assembly (AC) assigned. Please contact the administrator.');
      return;
    }
    const mobile = (voterFields.mobile_number || '').replace(/\D/g, '').slice(0, 10);
    const aadhaarDigits = (voterFields.aadhaar_number || '').replace(/\D/g, '').slice(0, 12);
    const manualBoothNumber = String(voterFields.boothid || '').trim();
    const sakhiName = (voterFields.e_first_name || '').trim();
    const guardianName = (voterFields.e_middle_name || '').trim();
    const rel = voterFields.guardian_relation;
    if (!sakhiName || !mobile || !guardianName) {
      setError('First name, Father/Husband name, and Mobile number are required.');
      return;
    }
    if (rel !== 'father' && rel !== 'husband') {
      setError('Please select Father or Husband under Relationship.');
      return;
    }
    if (withoutEpicMode && !manualBoothNumber) {
      setError('Booth No. is required in Without EPIC mode.');
      return;
    }

    const sexRaw = String(voterFields.sex || '').trim().toLowerCase();
    const isFemale =
      sexRaw === 'f' ||
      sexRaw === 'female' ||
      sexRaw.includes('महिला') ||
      sexRaw.includes('स्त्री');
    if (!isFemale) {
      setError('Submission is allowed only for Female (F) entries. If sex is M/Male, submission is blocked.');
      return;
    }

    const mobileErr = validateIndianMobile10(mobile);
    if (mobileErr) {
      setError(mobileErr);
      return;
    }

    const aadhaarErr = validateAadhaar12(aadhaarDigits);
    if (aadhaarErr) {
      setError(aadhaarErr);
      return;
    }

    if (documentsCollectedAadhaar === '' || documentsCollectedVoter === '') {
      setError('Please select Yes or No for both Aadhaar card and Voter ID card collection.');
      return;
    }
    if (documentsCollectedAadhaar !== 'yes' || documentsCollectedVoter !== 'yes') {
      setError(
        'Submission is only allowed when both are Yes — Aadhaar and Voter ID must have been collected in person.'
      );
      return;
    }

    setLoading(true);
    setError('');

    try {
      let aadhaarFrontUrl = null;
      let aadhaarBackUrl = null;
      let voterIdUrl = null;
      let livePhotoUrl = null;

      if (preUploadedUrls.aadhaarFront) {
        aadhaarFrontUrl = preUploadedUrls.aadhaarFront;
      } else if (files.aadhaarFront) {
        aadhaarFrontUrl = await uploadFile(files.aadhaarFront, 'aadhaar');
      }
      if (preUploadedUrls.aadhaarBack) {
        aadhaarBackUrl = preUploadedUrls.aadhaarBack;
      } else if (files.aadhaarBack) {
        aadhaarBackUrl = await uploadFile(files.aadhaarBack, 'aadhaar');
      }
      if (preUploadedUrls.voterId) {
        voterIdUrl = preUploadedUrls.voterId;
      } else if (files.voterId) {
        voterIdUrl = await uploadFile(files.voterId, 'voter-id');
      }

      if (livePhotoFile) {
        livePhotoUrl = await uploadFile(livePhotoFile, 'live-photos');
      } else if (livePhoto) {
        const blob = await (await fetch(livePhoto)).blob();
        const file = new File([blob], 'live-photo.jpg', { type: 'image/jpeg' });
        livePhotoUrl = await uploadFile(file, 'live-photos');
      }

      const ocrItems: { label: string; text: string; raw: unknown }[] = [];

      if (ocrRawByLabel.aadhaar_front) {
        ocrItems.push(ocrRawByLabel.aadhaar_front);
      } else if (aadhaarFrontUrl) {
        ocrItems.push(await readOCR(aadhaarFrontUrl, 'aadhaar_front'));
      }

      if (ocrRawByLabel.aadhaar_back) {
        ocrItems.push(ocrRawByLabel.aadhaar_back);
      } else if (aadhaarBackUrl) {
        ocrItems.push(await readOCR(aadhaarBackUrl, 'aadhaar_back'));
      }

      if (ocrRawByLabel.voter_id) {
        ocrItems.push(ocrRawByLabel.voter_id);
      } else if (voterIdUrl) {
        ocrItems.push(await readOCR(voterIdUrl, 'voter_id'));
      }

      if (ocrRawByLabel.live_photo) {
        ocrItems.push(ocrRawByLabel.live_photo);
      } else if (livePhotoUrl) {
        ocrItems.push(await readOCR(livePhotoUrl, 'live_photo'));
      }

      if (VOTER_EDITABLE_KEYS.some((k) => (voterFields[k] || '').trim() !== '')) {
        ocrItems.push({
          label: 'voter_lookup',
          text: JSON.stringify(voterFields),
          raw: null,
        });
      }
      const compactOcrData = ocrItems.map((item) => ({
        label: item.label,
        text: item.text,
      }));

      const response = await fetch(authUrl('create-submission'), {
        method: 'POST',
        headers: authHeadersJson(),
        body: JSON.stringify({
          userId: user?.id,
          sakhi_name: sakhiName,
          sakhi_mobile: mobile,
          aadhaar_number: aadhaarDigits,
          father_name: guardianName,
          husband_name: guardianName,
          state: location!.state,
          district: location!.district,
          assembly: location!.assembly,
          halka: location!.halka,
          village: location!.village,
          booth_number: withoutEpicMode ? manualBoothNumber : location!.booth_number,
          aadhaar_front_url: aadhaarFrontUrl,
          aadhaar_back_url: aadhaarBackUrl,
          voter_id_url: voterIdUrl,
          live_photo_url: livePhotoUrl,
          ocr_data: compactOcrData,
          documents_collected_aadhaar: documentsCollectedAadhaar,
          documents_collected_voter: documentsCollectedVoter,
          submitted_with_epic: lookupMatchedRoll,
        }),
      });

      const saveData = await parseJsonResponse(response);
      if (!response.ok || !saveData?.success) {
        throw new Error(saveData?.message || 'Submission save failed');
      }

      setSuccess(true);
      setTimeout(() => {
        onSuccess();
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit form. Please try again.');
      setOcrLoading(false);
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50 flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md text-center">
          <CheckCircle className="h-20 w-20 text-green-600 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Submission Successful!</h2>
          <p className="text-gray-600">Your entry has been recorded successfully.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50">
      <div className="max-w-5xl mx-auto p-4 py-8">
        <div className="bg-white rounded-2xl shadow-xl p-8">
          <div className="flex items-center gap-4 mb-6">
            <button
              onClick={onBack}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <ArrowLeft className="h-6 w-6 text-gray-600" />
            </button>
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Sakhi Registration</h1>
              <p className="text-gray-600">EPIC, voter details, and documents — zone / district / AC from your profile</p>
            </div>
          </div>

          <div className="space-y-6">
            {!location && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900 text-sm">
                <p className="font-semibold mb-1">Assembly (AC) not set on your profile</p>
                <p>New entries require an assigned AC. Please contact your administrator.</p>
              </div>
            )}

            {location && (
              <>
                <div className="w-fit max-w-full">
                  <div className="rounded-lg border border-orange-200 bg-orange-50/90 p-3">
                    <p className="text-xs font-semibold text-orange-900 uppercase tracking-wide mb-2">Your area (login profile)</p>
                    <p className="text-sm text-gray-800 flex flex-wrap gap-x-4 gap-y-1">
                      <span><span className="font-semibold">Zone:</span> {location.state}</span>
                      <span><span className="font-semibold">District:</span> {location.district}</span>
                      <span><span className="font-semibold">AC:</span> {location.assembly}</span>
                    </p>
                  </div>
                </div>

                <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-3">
                  <p className="text-sm text-gray-700 font-medium mb-2">Enter EPIC no. or voter no.</p>
                  <form
                    className="flex gap-2 items-stretch"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!lookupLoading) void lookupVoterByEpic();
                    }}
                  >
                    <input
                      type="text"
                      value={epicInput}
                      onChange={(e) => setEpicInput(e.target.value)}
                      autoComplete="off"
                      aria-label="EPIC or voter number"
                      placeholder="EPIC no. or voter no."
                      className="min-w-0 flex-1 px-3 py-2 text-sm border border-blue-200 rounded-md bg-white"
                    />
                    <button
                      type="submit"
                      disabled={lookupLoading}
                      aria-label="Search voter"
                      className="inline-flex shrink-0 items-center justify-center px-3 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                    >
                      {lookupLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      ) : (
                        <Search className="h-4 w-4" aria-hidden />
                      )}
                    </button>
                  </form>
                  {lookupMessage && (
                    <p className={`text-sm mt-2 ${/no voter|failed|error|lookup/i.test(lookupMessage) && !lookupMessage.includes('found') ? 'text-amber-800' : 'text-green-800'}`}>
                      {lookupMessage}
                    </p>
                  )}
                </div>

                {error && !showVoterForm && (
                  <div className="bg-red-50 text-red-600 px-4 py-3 rounded-lg text-sm border border-red-100">
                    {error}
                  </div>
                )}

                {!lookupMatchedRoll && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3 shadow-sm">
                    <button
                      type="button"
                      onClick={startWithoutEpic}
                      className="w-full sm:w-auto px-4 py-2.5 rounded-lg border-2 border-slate-300 bg-white text-slate-800 text-sm font-medium hover:bg-slate-100 hover:border-slate-400 transition-colors"
                    >
                      Without EPIC number
                    </button>
                  </div>
                )}

                {showVoterForm && (
                  <>
                <div className="grid grid-cols-1 gap-6 items-start">
                  <div className="space-y-4 rounded-xl border border-violet-200 bg-violet-50/40 p-4">
                    <h3 className="text-md font-semibold text-gray-900">Voter roll details</h3>

                    {(lookupMatchedRoll || maleEpicBlock) && (
                      <div
                        className={`rounded-2xl border p-3 shadow-sm ${
                          maleEpicBlock
                            ? 'border-amber-300 bg-gradient-to-br from-amber-50/80 via-white to-slate-50/50'
                            : 'border-slate-200 bg-gradient-to-br from-slate-50 via-white to-indigo-50/50'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-200/80 text-slate-700">
                            <Lock className="h-4 w-4" aria-hidden />
                          </span>
                          <div>
                            <p className="text-sm font-semibold text-slate-900">Electoral roll (read-only)</p>
                            <p className="text-xs text-slate-600">
                              {maleEpicBlock
                                ? 'Roll data for this EPIC — for verification only'
                                : 'From voter list — cannot be edited after a match'}
                            </p>
                            {allowFirstNameEditOnMatchedRoll && (
                              <p className="text-xs text-amber-700 mt-1">
                                First name is blank in the voter roll. Please add it manually below.
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="grid grid-flow-col auto-cols-[minmax(110px,1fr)] gap-2 overflow-x-auto pb-1">
                          {LOCKED_ROLL_KEYS.map((key) => (
                            <div
                              key={key}
                              className="rounded-xl border border-slate-200/80 bg-white/90 px-2.5 py-2 shadow-sm"
                            >
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-0.5">
                                {VOTER_FIELD_LABELS[key]}
                              </p>
                              <p className="text-sm font-medium text-slate-900 leading-tight break-words">
                                {(voterFields[key] || '').trim() || '—'}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {maleEpicBlock && error ? (
                      <div
                        className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
                        role="alert"
                      >
                        {error}
                      </div>
                    ) : null}

                    {!maleEpicBlock && (
                    <div>
                      <p className="text-xs font-semibold text-gray-700 mb-2">
                        {lookupMatchedRoll
                          ? 'Complete or edit below'
                          : withoutEpicMode
                            ? 'Enter voter details below (manual entry)'
                            : 'Enter all details below'}
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {editableFormKeys
                          .filter((k) => k !== 'guardian_relation')
                          .map((key) => {
                          if (key === 'age' && withoutEpicMode) {
                            return (
                              <label key={key} className="block text-sm">
                                <span className="text-gray-600 text-xs">{VOTER_FIELD_LABELS.age}</span>
                                <input
                                  type="text"
                                  readOnly
                                  value={voterFields.age || ''}
                                  className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-sm text-gray-800"
                                  placeholder="From DOB"
                                />
                              </label>
                            );
                          }
                          if (key === 'dob') {
                            return (
                              <label key={key} className="block text-sm">
                                <span className="text-gray-600 text-xs">{VOTER_FIELD_LABELS.dob}</span>
                                <input
                                  type="date"
                                  value={normalizeDobForInput(voterFields.dob || '') || voterFields.dob || ''}
                                  onChange={(e) =>
                                    withoutEpicMode
                                      ? setDobAndComputedAge(e.target.value)
                                      : updateVoterField('dob', e.target.value)
                                  }
                                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-sm"
                                />
                              </label>
                            );
                          }
                          if (key === 'mobile_number') {
                            return (
                              <label key={key} className="block text-sm">
                                <span className="text-gray-600 text-xs">{VOTER_FIELD_LABELS.mobile_number}</span>
                                <div className="mt-1 flex rounded-lg border border-gray-300 bg-white overflow-hidden focus-within:ring-2 focus-within:ring-orange-500 focus-within:border-orange-400">
                                  <span className="shrink-0 px-3 py-2 bg-gray-100 text-gray-700 text-sm border-r border-gray-300 select-none">
                                    +91
                                  </span>
                                  <input
                                    type="tel"
                                    inputMode="numeric"
                                    autoComplete="tel-national"
                                    value={voterFields.mobile_number || ''}
                                    onChange={(e) =>
                                      updateVoterField('mobile_number', e.target.value.replace(/\D/g, '').slice(0, 10))
                                    }
                                    className="min-w-0 flex-1 px-3 py-2 border-0 bg-white text-sm focus:ring-0"
                                    maxLength={10}
                                    aria-label="Mobile number 10 digits"
                                  />
                                </div>
                              </label>
                            );
                          }
                          if (key === 'sex' && withoutEpicMode) {
                            return (
                              <label key={key} className="block text-sm">
                                <span className="text-gray-600 text-xs">{VOTER_FIELD_LABELS.sex}</span>
                                <input
                                  type="text"
                                  readOnly
                                  value="Female"
                                  className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-sm text-gray-800"
                                />
                              </label>
                            );
                          }
                          if (key === 'aadhaar_number') {
                            return (
                              <label key={key} className="block text-sm">
                                <span className="text-gray-600 text-xs">{VOTER_FIELD_LABELS.aadhaar_number}</span>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  value={voterFields.aadhaar_number || ''}
                                  onChange={(e) =>
                                    updateVoterField('aadhaar_number', e.target.value.replace(/\D/g, '').slice(0, 12))
                                  }
                                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-sm"
                                  placeholder="12 digit Aadhaar number"
                                  maxLength={12}
                                />
                              </label>
                            );
                          }
                          if (key === 'e_assemblyname') {
                            return (
                              <label key={key} className="block text-sm">
                                <span className="text-gray-600 text-xs">{VOTER_FIELD_LABELS.e_assemblyname}</span>
                                <input
                                  type="text"
                                  value={voterFields.e_assemblyname || ''}
                                  readOnly
                                  className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-sm text-gray-800"
                                />
                              </label>
                            );
                          }
                          if (key === 'e_middle_name') {
                            return (
                              <div key="e_middle_name_block" className="sm:col-span-2">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                  <label className="block text-sm">
                                    <span className="text-gray-600 text-xs">{VOTER_FIELD_LABELS.e_middle_name}</span>
                                    <input
                                      type="text"
                                      value={voterFields.e_middle_name || ''}
                                      onChange={(e) => updateVoterField('e_middle_name', e.target.value)}
                                      className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-sm"
                                    />
                                  </label>
                                  <label className="block text-sm">
                                    <span className="text-gray-600 text-xs">{VOTER_FIELD_LABELS.guardian_relation}</span>
                                    <select
                                      value={voterFields.guardian_relation || ''}
                                      onChange={(e) => updateVoterField('guardian_relation', e.target.value)}
                                      className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-sm"
                                    >
                                      <option value="">Select…</option>
                                      <option value="father">Father</option>
                                      <option value="husband">Husband</option>
                                    </select>
                                  </label>
                                </div>
                              </div>
                            );
                          }
                          return (
                            <label key={key} className="block text-sm">
                              <span className="text-gray-600 text-xs">
                                {VOTER_FIELD_LABELS[key] ?? key}
                                {withoutEpicMode && key === 'boothid' ? ' *' : ''}
                              </span>
                              <input
                                type="text"
                                value={voterFields[key] || ''}
                                onChange={(e) => updateVoterField(key, e.target.value)}
                                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-sm"
                                placeholder={key === 'e_first_name' ? 'First name' : ''}
                                required={withoutEpicMode && key === 'boothid'}
                              />
                            </label>
                          );
                        })}
                      </div>
                    </div>
                    )}
                  </div>
                </div>

            {!maleEpicBlock && (ocrLoading || ocrPreview.length > 0) && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h4 className="text-sm font-semibold text-blue-900 mb-2">OCR Preview</h4>
                {ocrLoading && <p className="text-sm text-blue-700">Reading uploaded documents...</p>}
                {!ocrLoading && ocrPreview.length > 0 && (
                  <div className="space-y-3">
                    {ocrPreview.map((item) => (
                      <div key={item.label} className="bg-white rounded border border-blue-100 p-3">
                        <p className="text-xs font-semibold text-gray-600 uppercase mb-1">{item.label}</p>
                        <p className="text-sm text-gray-800 whitespace-pre-wrap break-words">{item.text || 'No text extracted'}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {!maleEpicBlock && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-4">
              <div>
                <label className="block text-sm text-gray-800">
                  <span className="font-medium">
                    Have you physically collected the applicant&apos;s <strong>Aadhaar card</strong>?{' '}
                    <span className="text-red-600">*</span>
                  </span>
                  <select
                    value={documentsCollectedAadhaar}
                    onChange={(e) =>
                      setDocumentsCollectedAadhaar(
                        e.target.value === 'yes' ? 'yes' : e.target.value === 'no' ? 'no' : ''
                      )
                    }
                    className="mt-2 w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-sm"
                  >
                    <option value="">Select…</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </label>
              </div>
              <div>
                <label className="block text-sm text-gray-800">
                  <span className="font-medium">
                    Have you physically collected the applicant&apos;s <strong>Voter ID card</strong>?{' '}
                    <span className="text-red-600">*</span>
                  </span>
                  <select
                    value={documentsCollectedVoter}
                    onChange={(e) =>
                      setDocumentsCollectedVoter(
                        e.target.value === 'yes' ? 'yes' : e.target.value === 'no' ? 'no' : ''
                      )
                    }
                    className="mt-2 w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-sm"
                  >
                    <option value="">Select…</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </label>
              </div>
              <p className="text-xs text-gray-500">
                Submit is allowed only when <strong>both</strong> are <strong>Yes</strong> (each document collected in
                person).
              </p>
            </div>
            )}

            {error && !maleEpicBlock && (
              <div className="bg-red-50 text-red-600 px-4 py-3 rounded-lg text-sm border border-red-100">
                {error}
              </div>
            )}

            {!maleEpicBlock && (
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="w-full bg-orange-600 hover:bg-orange-700 text-white font-semibold py-3 rounded-lg transition-all transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
            >
              {loading ? 'Submitting...' : 'Submit'}
            </button>
            )}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
