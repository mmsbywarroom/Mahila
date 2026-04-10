// @ts-nocheck — large legacy handler; pg-backed client mirrors Supabase JS surface
import type { Pool } from "pg";
import { createPgSupabaseClient } from "./supabaseCompat.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const ASSEMBLY_DASHBOARD_CACHE_TTL_MS = 60_000;
let assemblyDashboardCache: { rows: unknown[]; expiresAt: number } | null = null;
let assemblyDashboardInFlight: Promise<unknown[]> | null = null;

interface SendOTPRequest {
  name: string;
  mobile: string;
  preferred_assembly?: string;
}

interface VerifyOTPRequest {
  mobile: string;
  otp: string;
}

interface AdminSubmissionsRequest {
  userId: string;
  password: string;
  assembly?: string;
}

interface AdminUploadLocationsRequest {
  userId: string;
  password: string;
  clearExisting?: boolean;
  rows: {
    state: string;
    district: string;
    assembly: string;
    halka: string;
    village: string;
    booth_number?: string;
  }[];
}

interface AdminUploadVotersRequest {
  userId: string;
  password: string;
  rows: Array<{
    e_first_name?: string;
    e_middle_name?: string;
    sex?: string;
    age?: number | null;
    vcardid?: string;
    house_no?: string;
    part_no?: string;
    srno?: string;
    boothid?: string;
    familyid?: string;
    full_name?: string;
    e_assemblyname?: string;
  }>;
}

interface OCRExtractRequest {
  userId: string;
  password: string;
  imageUrl: string;
  imageBase64?: string;
  docType?: string;
}

interface CreateSubmissionRequest {
  userId: string;
  sakhi_name: string;
  sakhi_mobile: string;
  father_name: string;
  husband_name: string;
  state: string;
  district: string;
  assembly: string;
  halka: string;
  village: string;
  booth_number?: string;
  aadhaar_front_url?: string | null;
  aadhaar_back_url?: string | null;
  voter_id_url?: string | null;
  live_photo_url?: string | null;
  ocr_data?: unknown;
  /** 12-digit Aadhaar — validated server-side */
  aadhaar_number?: string | null;
  /** Legacy single field; still accepted if split fields omitted */
  documents_collected_consent?: string | null;
  /** Physical collection — each yes/no; both must be yes to submit */
  documents_collected_aadhaar?: string | null;
  documents_collected_voter?: string | null;
  /** true = EPIC/roll lookup path; false = without EPIC (voter ID upload) */
  submitted_with_epic?: boolean;
}

interface SoftDeleteSubmissionRequest {
  userId: string;
  password?: string;
  submissionId: string;
}

interface UpdateSubmissionRequest {
  userId: string;
  password?: string;
  submissionId: string;
  sakhi_name?: string;
  sakhi_mobile?: string;
  father_name?: string;
  husband_name?: string;
  state?: string;
  district?: string;
  assembly?: string;
  halka?: string;
  village?: string;
  booth_number?: string;
  status?: string;
  /** Non-admin only: patch ocr_data voter_lookup (EPIC / roll fields) */
  voter_lookup?: Record<string, unknown>;
}

const VOTER_LOOKUP_EDITABLE_KEYS = new Set([
  "e_first_name",
  "guardian_relation",
  "e_middle_name",
  "sex",
  "age",
  "vcardid",
  "boothid",
  "part_no",
  "srno",
  "e_assemblyname",
  "mobile_number",
  "dob",
  "aadhaar_number",
]);

function mergeVoterLookupIntoOcr(ocrData: unknown, patch: Record<string, unknown>): unknown {
  const sanitized: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (!VOTER_LOOKUP_EDITABLE_KEYS.has(k)) continue;
    sanitized[k] = typeof v === "string" ? v : v == null ? "" : String(v);
  }
  const arr = Array.isArray(ocrData) ? [...ocrData] : [];
  const idx = arr.findIndex(
    (x) => x && typeof x === "object" && (x as { label?: string }).label === "voter_lookup"
  );
  let obj: Record<string, unknown> = {};
  if (idx >= 0) {
    const text = String((arr[idx] as { text?: string }).text ?? "");
    try {
      const p = JSON.parse(text);
      if (p && typeof p === "object" && !Array.isArray(p)) obj = { ...(p as Record<string, unknown>) };
    } catch {
      obj = {};
    }
  }
  Object.assign(obj, sanitized);
  const newItem = { label: "voter_lookup", text: JSON.stringify(obj) };
  if (idx >= 0) arr[idx] = newItem;
  else arr.push(newItem);
  return arr;
}

interface LookupVoterRequest {
  epic: string;
  assembly?: string;
}

interface UserSubmissionsRequest {
  userId: string;
}

interface SubmissionStatsRequest {
  userId: string;
  password?: string;
}

interface AssemblyReportRequest {
  userId: string;
}

interface LocationCountRequest {
  state: string;
  district: string;
  assembly: string;
  halka: string;
  village: string;
}

interface AdminCreateUserRequest {
  userId: string;
  password: string;
  /** Optional: when provided, update this specific user id (used by Edit Incharge). */
  targetUserId?: string;
  name: string;
  mobile: string;
  preferred_assembly: string;
  profile_data?: Record<string, unknown>;
}

interface AdminUploadUsersRequest {
  userId: string;
  password: string;
  users: Array<{
    name: string;
    mobile: string;
    preferred_assembly: string;
    profile_data?: Record<string, unknown>;
  }>;
}

interface AdminListInchargesRequest {
  userId: string;
  password: string;
  search?: string;
  /** Exact match on Designation / designation in profile; omit or "All Designations" for no filter */
  designation?: string;
  limit?: number;
  offset?: number;
}

interface AdminDeleteUserRequest {
  userId: string;
  password: string;
  targetUserId: string;
}

interface AdminBulkDeleteInchargesRequest {
  userId: string;
  password: string;
}

interface AdminOfflineSakhiValidateRequest {
  userId: string;
  password: string;
  rows: Array<Record<string, unknown>>;
}

interface AdminOfflineSakhiReportSaveRequest {
  userId: string;
  password: string;
  fileName?: string;
  summary: { ok: number; mismatch: number; not_found: number; total: number };
  csvHeaders: string[];
  results: unknown[];
}

interface AdminOfflineSakhiReportLatestRequest {
  userId: string;
  password: string;
}

interface AdminOfflineSakhiReportClearRequest {
  userId: string;
  password: string;
}

interface AdminOfflineSakhiReportSaveBeginRequest {
  userId: string;
  password: string;
  fileName?: string;
  summary: { ok: number; mismatch: number; not_found: number; total: number };
  csvHeaders: string[];
}

interface AdminOfflineSakhiReportSaveRowsRequest {
  userId: string;
  password: string;
  reportId: string;
  rows: Array<{
    rowIndex: number;
    status: string;
    epic: string;
    mismatchedFields: string[];
    csv: Record<string, unknown>;
    roll: Record<string, unknown> | null;
    extraCells?: Record<number, string> | null;
  }>;
}

interface AdminOfflineSakhiReportSaveAbortRequest {
  userId: string;
  password: string;
  reportId: string;
}

interface AdminOfflineSakhiImportSubmissionsRowsRequest {
  userId: string;
  password: string;
  /** Always "Googleform" for this import */
  sourceName?: string;
  /** Chunked rows from Offline Sakhi report */
  rows: Array<{
    epic: string;
    applicantName: string;
    mobile: string;
    fatherName: string;
    dob: string;
    gender: string;
    aadhaar: string;
    district: string;
    halka: string;
    booth: string;
  }>;
}

function normalizeGenderForDb(s: unknown): string {
  const t = String(s ?? "").trim();
  if (!t) return "";
  const low = t.toLowerCase();
  if (low.startsWith("f")) return "Female";
  if (low.startsWith("m")) return "Male";
  return t;
}

function normEpicOffline(s: unknown): string {
  return String(s ?? "").replace(/\s/g, "").toUpperCase();
}

function normTextOffline(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function digitsOnlyOffline(s: unknown): string {
  return String(s ?? "").replace(/\D/g, "");
}

function genderBucketOffline(raw: string): "f" | "m" | "?" {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s || s === "na" || s === "n/a" || s === "-") return "?";
  if (s === "f" || s === "female" || s.includes("महिला") || s.includes("स्त्री")) return "f";
  if (
    s === "m" ||
    s === "male" ||
    s.includes("पुरुष") ||
    /^m[\s./_-]*$/i.test(String(raw ?? "").trim())
  ) {
    return "m";
  }
  return "?";
}

function halkaMatchesOffline(csv: string, roll: string): boolean {
  const c = normTextOffline(csv);
  const r = normTextOffline(roll);
  if (!c && !r) return true;
  if (!c || !r) return false;
  return c === r || c.includes(r) || r.includes(c);
}

function ageFullYearsFromDateOffline(birth: Date): number {
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const md = today.getMonth() - birth.getMonth();
  if (md < 0 || (md === 0 && today.getDate() < birth.getDate())) age -= 1;
  return age;
}

function ageFromCsvDobOffline(s: string): number | null {
  const t = String(s).trim();
  if (!t || /^na$/i.test(t)) return null;
  let m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) {
    const d = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10) - 1;
    const y = parseInt(m[3], 10);
    const bd = new Date(y, mo, d);
    if (Number.isNaN(bd.getTime())) return null;
    return ageFullYearsFromDateOffline(bd);
  }
  m = t.match(/^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/);
  if (m) {
    const y = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10) - 1;
    const d = parseInt(m[3], 10);
    const bd = new Date(y, mo, d);
    if (Number.isNaN(bd.getTime())) return null;
    return ageFullYearsFromDateOffline(bd);
  }
  return null;
}

function namesMatchOffline(csv: string, roll: string): boolean {
  const c = normTextOffline(csv);
  const r = normTextOffline(roll);
  if (!c && !r) return true;
  if (!c || !r) return false;
  if (c === r) return true;
  return c.includes(r) || r.includes(c);
}

function boothMatchOffline(csvBooth: unknown, dbBooth: unknown): boolean {
  const a = digitsOnlyOffline(csvBooth);
  const b = digitsOnlyOffline(dbBooth);
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a === b;
}

function validateIndianMobile10Edge(digits: string): string | null {
  const d = digits.replace(/\D/g, "");
  if (d.length !== 10) return "Mobile number must be exactly 10 digits.";
  if (!/^[6-9]\d{9}$/.test(d)) return "Mobile must start with 6, 7, 8, or 9.";
  if (/^(\d)\1{9}$/.test(d)) return "Invalid mobile number.";
  const banned = new Set(["1234567890", "9876543210", "0123456789", "9988776655", "9090909090", "9898989898"]);
  if (banned.has(d)) return "Invalid mobile number.";
  const roll = "012345678901234567890";
  if (roll.includes(d) || "98765432109876543210".includes(d)) return "Invalid mobile number.";
  return null;
}

function validateAadhaar12Edge(digits: string): string | null {
  const d = digits.replace(/\D/g, "");
  if (d.length !== 12) return "Aadhaar must be exactly 12 digits.";
  if (!/^\d{12}$/.test(d)) return "Invalid Aadhaar.";
  if (/^(\d)\1{11}$/.test(d)) return "Invalid Aadhaar.";
  const long = "012345678901234567890123456789012345678901234567890";
  if (long.includes(d)) return "Invalid Aadhaar.";
  return null;
}

const encoder = new TextEncoder();

function toBase64Url(input: string | Uint8Array) {
  const bytes = typeof input === "string" ? encoder.encode(input) : input;
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function pemToArrayBuffer(pem: string) {
  const cleaned = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s+/g, "");
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function createGoogleAccessToken(serviceAccountKeyJson: string) {
  const key = JSON.parse(serviceAccountKeyJson);
  const now = Math.floor(Date.now() / 1000);

  const header = toBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = toBase64Url(
    JSON.stringify({
      iss: key.client_email,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      aud: key.token_uri,
      exp: now + 3600,
      iat: now,
    })
  );

  const unsignedToken = `${header}.${payload}`;
  const privateKeyBuffer = pemToArrayBuffer(key.private_key);
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    privateKeyBuffer,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    encoder.encode(unsignedToken)
  );
  const signedJwt = `${unsignedToken}.${toBase64Url(new Uint8Array(signature))}`;

  const tokenResponse = await fetch(key.token_uri, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: signedJwt,
    }),
  });

  const tokenData = await tokenResponse.json();
  if (!tokenResponse.ok || !tokenData?.access_token) {
    throw new Error(tokenData?.error_description || tokenData?.error || "Failed to get Google access token");
  }

  return tokenData.access_token as string;
}

async function fetchImageAsBase64(imageUrl: string) {
  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) {
    throw new Error(`Image fetch failed with status ${imageResponse.status}`);
  }
  const bytes = new Uint8Array(await imageResponse.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export async function handleAuthRequest(req: Request, pool: Pool): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabase = createPgSupabaseClient(pool);

    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    if (action === "send-otp") {
      const { name, mobile, preferred_assembly }: SendOTPRequest = await req.json();

      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const otpCreatedAt = new Date().toISOString();

      const { data: existingUser } = await supabase
        .from("users")
        .select("id")
        .eq("mobile", mobile)
        .maybeSingle();

      if (existingUser) {
        await supabase
          .from("users")
          .update({ otp, otp_created_at: otpCreatedAt, is_verified: false, preferred_assembly: preferred_assembly ?? null })
          .eq("mobile", mobile);
      } else {
        await supabase
          .from("users")
          .insert({
            name,
            mobile,
            otp,
            otp_created_at: otpCreatedAt,
            is_verified: false,
            preferred_assembly: preferred_assembly ?? null,
          });
      }

      const payload: Record<string, unknown> = {
        success: true,
        message: "OTP sent successfully",
        otpDelivery: "ui",
        otp,
      };

      return new Response(JSON.stringify(payload), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      });
    }

    if (action === "send-otp-login") {
      const { mobile }: { mobile: string } = await req.json();
      if (!mobile) {
        return new Response(
          JSON.stringify({ success: false, message: "Mobile is required" }),
          {
            status: 400,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }

      const { data: existingUser } = await supabase
        .from("users")
        .select("id")
        .eq("mobile", mobile)
        .maybeSingle();

      if (!existingUser) {
        return new Response(
          JSON.stringify({ success: false, message: "Mobile not registered" }),
          {
            status: 404,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }

      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const otpCreatedAt = new Date().toISOString();

      await supabase
        .from("users")
        .update({ otp, otp_created_at: otpCreatedAt, is_verified: false })
        .eq("mobile", mobile);

      const payload: Record<string, unknown> = {
        success: true,
        message: "OTP sent successfully",
        otpDelivery: "ui",
        otp,
      };

      return new Response(JSON.stringify(payload), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      });
    }

    if (action === "verify-otp") {
      const { mobile, otp }: VerifyOTPRequest = await req.json();

      const { data: user } = await supabase
        .from("users")
        .select("*")
        .eq("mobile", mobile)
        .maybeSingle();

      if (!user) {
        return new Response(
          JSON.stringify({ success: false, message: "User not found" }),
          {
            status: 404,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }

      if (user.otp !== otp) {
        return new Response(
          JSON.stringify({ success: false, message: "Invalid OTP" }),
          {
            status: 400,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }

      const otpAge = Date.now() - new Date(user.otp_created_at).getTime();
      if (otpAge > 10 * 60 * 1000) {
        return new Response(
          JSON.stringify({ success: false, message: "OTP expired" }),
          {
            status: 400,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }

      await supabase
        .from("users")
        .update({ is_verified: true, otp: null })
        .eq("mobile", mobile);

      const verifiedUser = { ...(user as Record<string, unknown>), is_verified: true, otp: null };

      return new Response(
        JSON.stringify({ success: true, user: verifiedUser, message: "OTP verified successfully" }),
        {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    if (action === "admin-submissions") {
      const { userId, password }: AdminSubmissionsRequest = await req.json();

      if (userId !== "admin" || password !== "admin@123") {
        return new Response(
          JSON.stringify({ success: false, message: "Invalid admin credentials" }),
          {
            status: 401,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }

      const adminSubmissionsSqlFull = `SELECT s.id,
          s.user_id,
          s.sakhi_name,
          s.sakhi_mobile,
          s.father_name,
          s.husband_name,
          s.state,
          s.district,
          s.assembly,
          s.halka,
          s.village,
          s.booth_number,
          s.aadhaar_front_url,
          s.aadhaar_back_url,
          s.voter_id_url,
          s.live_photo_url,
          s.ocr_data,
          s.status,
          s.created_at,
          s.source_name,
          s.documents_collected_consent,
          s.documents_collected_aadhaar,
          s.documents_collected_voter,
          s.submitted_with_epic,
          u.name AS user_name,
          u.mobile AS user_mobile,
          COALESCE(
            NULLIF(trim(both FROM COALESCE(u.profile_data->>'Wing Name', '')), ''),
            NULLIF(trim(both FROM COALESCE(u.profile_data->>'Wing', '')), '')
          ) AS submitter_wing
        FROM submissions s
        LEFT JOIN users u ON u.id = s.user_id
        WHERE s.deleted_at IS NULL
        ORDER BY s.created_at DESC`;

      /** DBs without newer migrations (no consent / EPIC-mode columns) */
      const adminSubmissionsSqlLegacy = `SELECT s.id,
          s.user_id,
          s.sakhi_name,
          s.sakhi_mobile,
          s.father_name,
          s.husband_name,
          s.state,
          s.district,
          s.assembly,
          s.halka,
          s.village,
          s.booth_number,
          s.aadhaar_front_url,
          s.aadhaar_back_url,
          s.voter_id_url,
          s.live_photo_url,
          s.ocr_data,
          s.status,
          s.created_at,
          NULL::text AS source_name,
          u.name AS user_name,
          u.mobile AS user_mobile,
          COALESCE(
            NULLIF(trim(both FROM COALESCE(u.profile_data->>'Wing Name', '')), ''),
            NULLIF(trim(both FROM COALESCE(u.profile_data->>'Wing', '')), '')
          ) AS submitter_wing
        FROM submissions s
        LEFT JOIN users u ON u.id = s.user_id
        WHERE s.deleted_at IS NULL
        ORDER BY s.created_at DESC`;

      let subRes;
      try {
        subRes = await pool.query(adminSubmissionsSqlFull);
      } catch (e: unknown) {
        const err = e as { code?: string; message?: string };
        const missingCol =
          err?.code === "42703" || /column .* does not exist/i.test(String(err?.message ?? ""));
        if (missingCol) {
          subRes = await pool.query(adminSubmissionsSqlLegacy);
        } else {
          throw e;
        }
      }
      const data = subRes.rows;

      const submissions = (data || []).map((item: Record<string, unknown>) => ({
        id: item.id,
        user_id: item.user_id,
        sakhi_name: item.sakhi_name,
        sakhi_mobile: item.sakhi_mobile,
        father_name: item.father_name,
        husband_name: item.husband_name,
        state: item.state,
        district: item.district,
        assembly: item.assembly,
        halka: item.halka,
        village: item.village,
        booth_number: item.booth_number,
        aadhaar_front_url: item.aadhaar_front_url,
        aadhaar_back_url: item.aadhaar_back_url,
        voter_id_url: item.voter_id_url,
        live_photo_url: item.live_photo_url,
        ocr_data: item.ocr_data ?? null,
        status: item.status,
        created_at: item.created_at,
        source_name: item.source_name ?? null,
        documents_collected_consent: item.documents_collected_consent ?? null,
        documents_collected_aadhaar: item.documents_collected_aadhaar ?? null,
        documents_collected_voter: item.documents_collected_voter ?? null,
        submitted_with_epic: item.submitted_with_epic,
        user_name: item.user_name ?? null,
        user_mobile: item.user_mobile ?? null,
        submitter_wing: item.submitter_wing ?? null,
      }));

      return new Response(
        JSON.stringify({ success: true, submissions }),
        {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    if (action === "admin-booth-clusters") {
      const { userId, password, assembly }: AdminSubmissionsRequest = await req.json();

      if (userId !== "admin" || password !== "admin@123") {
        return new Response(
          JSON.stringify({ success: false, message: "Invalid admin credentials" }),
          {
            status: 401,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }

      const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();
      const toNumber = (v: unknown) => {
        const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
        return Number.isFinite(n) ? n : null;
      };

      type VoterRow = {
        e_assemblyname: string | null;
        boothid: string | null;
        vcardid: string | null;
        srno: string | null;
      };

      const votersAll: VoterRow[] = [];
      const pageSize = 1000;
      let from = 0;
      while (true) {
        let q = supabase
          .from("voters")
          .select("e_assemblyname, boothid, vcardid, srno")
          .range(from, from + pageSize - 1);
        if (assembly) q = q.ilike("e_assemblyname", assembly.trim());
        const { data, error } = await q;
        if (error) {
          return new Response(
            JSON.stringify({ success: false, message: error.message }),
            {
              status: 500,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
              },
            }
          );
        }
        const rows = (data ?? []) as VoterRow[];
        votersAll.push(...rows);
        if (rows.length < pageSize) break;
        from += pageSize;
      }

      const { data: submissionsRaw, error: subError } = await supabase
        .from("submissions")
        .select("id, sakhi_name, sakhi_mobile, assembly, booth_number, ocr_data, created_at")
        .is("deleted_at", null);
      if (subError) {
        return new Response(
          JSON.stringify({ success: false, message: subError.message }),
          {
            status: 500,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }

      type SakhiItem = {
        id: string;
        sakhi_name: string;
        sakhi_mobile: string;
        epic: string;
        boothid: string;
        created_at: string;
      };

      const sakhiByAssembly = new Map<string, SakhiItem[]>();
      for (const s of submissionsRaw ?? []) {
        const asm = String((s as any).assembly ?? "").trim();
        if (!asm) continue;
        if (assembly && norm(asm) !== norm(assembly)) continue;
        const ocr = (s as any).ocr_data;
        let voterLookup: Record<string, unknown> = {};
        if (Array.isArray(ocr)) {
          const item = ocr.find((x: any) => x?.label === "voter_lookup");
          if (item?.text) {
            try {
              voterLookup = JSON.parse(String(item.text));
            } catch {
              voterLookup = {};
            }
          }
        }
        const epic = String(voterLookup.vcardid ?? "").trim();
        const boothid = String(voterLookup.boothid ?? (s as any).booth_number ?? "").trim();
        const sakhi: SakhiItem = {
          id: String((s as any).id),
          sakhi_name: String((s as any).sakhi_name ?? ""),
          sakhi_mobile: String((s as any).sakhi_mobile ?? ""),
          epic,
          boothid,
          created_at: String((s as any).created_at ?? ""),
        };
        const key = norm(asm);
        const arr = sakhiByAssembly.get(key) ?? [];
        arr.push(sakhi);
        sakhiByAssembly.set(key, arr);
      }

      const votersByAssemblyBooth = new Map<string, VoterRow[]>();
      for (const v of votersAll) {
        const asm = String(v.e_assemblyname ?? "").trim();
        const booth = String(v.boothid ?? "").trim();
        if (!asm || !booth) continue;
        const key = `${norm(asm)}::${norm(booth)}`;
        const arr = votersByAssemblyBooth.get(key) ?? [];
        arr.push(v);
        votersByAssemblyBooth.set(key, arr);
      }

      const assemblyMap = new Map<
        string,
        {
          assembly: string;
          booths: Array<{
            boothid: string;
            total_unique_votes: number;
            clusters: Array<{
              cluster_no: number;
              range_start: number;
              range_end: number;
              sakhi_count: number;
              sakhis: Array<{ name: string; epic: string; mobile: string }>;
            }>;
          }>;
        }
      >();

      for (const [asmBoothKey, voters] of votersByAssemblyBooth.entries()) {
        const [asmKey, boothKey] = asmBoothKey.split("::");
        const first = voters[0];
        const assemblyName = String(first.e_assemblyname ?? "");
        const boothName = String(first.boothid ?? "");

        const uniqueByEpic = new Map<string, VoterRow>();
        voters.forEach((v) => {
          const epic = String(v.vcardid ?? "").trim();
          const k = epic ? norm(epic) : `${norm(v.srno)}::${Math.random()}`;
          if (!uniqueByEpic.has(k)) uniqueByEpic.set(k, v);
        });
        const uniqueVoters = Array.from(uniqueByEpic.values()).sort((a, b) => {
          const an = toNumber(a.srno);
          const bn = toNumber(b.srno);
          if (an !== null && bn !== null) return an - bn;
          if (an !== null) return -1;
          if (bn !== null) return 1;
          return String(a.vcardid ?? "").localeCompare(String(b.vcardid ?? ""));
        });

        const epicToCluster = new Map<string, number>();
        uniqueVoters.forEach((v, idx) => {
          const epic = String(v.vcardid ?? "").trim();
          if (!epic) return;
          const clusterNo = Math.floor(idx / 100) + 1;
          epicToCluster.set(norm(epic), clusterNo);
        });

        const asmSakhis = sakhiByAssembly.get(asmKey) ?? [];
        const boothSakhis = asmSakhis.filter((s) => norm(s.boothid) === boothKey);
        const clusterMap = new Map<number, Array<{ name: string; epic: string; mobile: string }>>();
        boothSakhis.forEach((s) => {
          const cNo = epicToCluster.get(norm(s.epic));
          if (!cNo) return;
          const arr = clusterMap.get(cNo) ?? [];
          arr.push({ name: s.sakhi_name, epic: s.epic, mobile: s.sakhi_mobile });
          clusterMap.set(cNo, arr);
        });

        const clusterCount = Math.max(1, Math.ceil(uniqueVoters.length / 100));
        const clusters = Array.from({ length: clusterCount }, (_, i) => {
          const clusterNo = i + 1;
          const start = i * 100 + 1;
          const end = Math.min((i + 1) * 100, uniqueVoters.length);
          const sakhis = clusterMap.get(clusterNo) ?? [];
          return {
            cluster_no: clusterNo,
            range_start: start,
            range_end: end,
            sakhi_count: sakhis.length,
            sakhis,
          };
        });

        const asmObj = assemblyMap.get(asmKey) ?? { assembly: assemblyName, booths: [] };
        asmObj.booths.push({
          boothid: boothName,
          total_unique_votes: uniqueVoters.length,
          clusters,
        });
        assemblyMap.set(asmKey, asmObj);
      }

      const assemblies = Array.from(assemblyMap.values()).map((a) => {
        a.booths.sort((x, y) => x.boothid.localeCompare(y.boothid, undefined, { numeric: true }));
        const totalVotes = a.booths.reduce((sum, b) => sum + b.total_unique_votes, 0);
        return {
          assembly: a.assembly,
          total_unique_booths: a.booths.length,
          total_unique_votes: totalVotes,
          booths: a.booths,
        };
      });
      assemblies.sort((a, b) => a.assembly.localeCompare(b.assembly));

      return new Response(
        JSON.stringify({ success: true, assemblies }),
        {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    if (action === "admin-assembly-dashboard" || action === "public-assembly-dashboard") {
      let body: { userId?: string; password?: string; forceRefresh?: boolean } = {};
      try {
        body = (await req.json()) as { userId?: string; password?: string };
      } catch {
        body = {};
      }

      if (action === "admin-assembly-dashboard") {
        if (body.userId !== "admin" || body.password !== "admin@123") {
          return new Response(
            JSON.stringify({ success: false, message: "Invalid admin credentials" }),
            {
              status: 401,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
              },
            }
          );
        }
      }

      const cached = assemblyDashboardCache;
      if (!body.forceRefresh && cached && cached.expiresAt > Date.now()) {
        return new Response(
          JSON.stringify({ success: true, rows: cached.rows }),
          {
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }

      const loadRows = async (): Promise<unknown[]> => {

      // Fast path: use materialized voter summary (if present) instead of scanning raw voters.
      const { data: voterSummaryJson, error: voterSummaryErr } = await supabase.rpc(
        "admin_voter_assembly_list",
        {
          p_filter: null,
          p_limit: 5000,
        }
      );
      if (voterSummaryErr) {
        return new Response(
          JSON.stringify({ success: false, message: voterSummaryErr.message }),
          {
            status: 500,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }

      const voterRowsRaw = Array.isArray(voterSummaryJson)
        ? voterSummaryJson
        : [];

      const [inchargeAgg, locationAgg, boothVotesAgg, subRows] = await Promise.all([
        pool.query(
          `SELECT
             trim(coalesce(u.preferred_assembly, u.profile_data->>'AC Name', '')) AS assembly,
             MIN(NULLIF(trim(coalesce(u.profile_data->>'Zone', '')), '')) AS zone,
             MIN(NULLIF(trim(coalesce(u.profile_data->>'District', '')), '')) AS district
           FROM users u
           WHERE trim(coalesce(u.preferred_assembly, u.profile_data->>'AC Name', '')) <> ''
           GROUP BY trim(coalesce(u.preferred_assembly, u.profile_data->>'AC Name', ''))`
        ),
        pool.query(
          `SELECT
             trim(assembly) AS assembly,
             MIN(NULLIF(trim(state), '')) AS zone,
             MIN(NULLIF(trim(district), '')) AS district
           FROM locations
           WHERE assembly IS NOT NULL
             AND btrim(assembly) <> ''
           GROUP BY trim(assembly)`
        ),
        pool.query(
          `WITH booth_votes AS (
             SELECT
               trim(e_assemblyname) AS assembly,
               trim(boothid) AS booth,
               COUNT(*)::int AS votes
             FROM voters
             WHERE e_assemblyname IS NOT NULL
               AND btrim(e_assemblyname) <> ''
               AND boothid IS NOT NULL
               AND btrim(boothid) <> ''
             GROUP BY trim(e_assemblyname), trim(boothid)
           )
           SELECT
             assembly,
             SUM(CEIL(votes / 100.0))::int AS approx_sakhi_required
           FROM booth_votes
           GROUP BY assembly`
        ),
        pool.query(
          `SELECT
             COALESCE(NULLIF(trim(assembly), ''), 'Unassigned') AS assembly,
             booth_number,
             epic,
             aadhaar_number,
             dob,
             submitted_with_epic,
             ocr_data
           FROM submissions
           WHERE deleted_at IS NULL`
        ),
      ]);

      const byAssembly = new Map<
        string,
        {
          zone: string;
          district: string;
          assembly: string;
          total_booths: number;
          total_votes: number;
          added_sakhi: number;
          with_epic_added: number;
          without_epic_added: number;
          booth_received_set: Set<string>;
          dob_received: number;
          age_55_plus: number;
          epic_received: number;
          aadhaar_received: number;
        }
      >();

      voterRowsRaw.forEach((row: any) => {
        const assembly = String(row?.assembly ?? "").trim();
        if (!assembly) return;
        byAssembly.set(assembly.toLowerCase(), {
          zone: "",
          district: "",
          assembly,
          total_booths: Number(row?.booth_count ?? 0),
          total_votes: Number(row?.vote_count ?? 0),
          added_sakhi: 0,
          with_epic_added: 0,
          without_epic_added: 0,
          booth_received_set: new Set<string>(),
          dob_received: 0,
          age_55_plus: 0,
          epic_received: 0,
          aadhaar_received: 0,
        });
      });

      const sanitizeZone = (value: unknown): string => {
        const zone = String(value ?? "").trim();
        // Some user profiles contain comma-separated multi-zone text; not a valid single report zone.
        if (zone.includes(",")) return "";
        return zone;
      };
      const inferZoneFromDistrict = (districtRaw: unknown): string => {
        const district = String(districtRaw ?? "").trim().toLowerCase();
        // Fallbacks for known district->zone mapping where profile/location zone is missing/invalid.
        if (district === "moga") return "Malwa Central";
        return "";
      };

      // Prefer incharge/user mapping for zone+district.
      (inchargeAgg.rows ?? []).forEach((row: any) => {
        const assembly = String(row?.assembly ?? "").trim();
        if (!assembly) return;
        const key = assembly.toLowerCase();
        const prev = byAssembly.get(key);
        const zone = sanitizeZone(row?.zone);
        const district = String(row?.district ?? "").trim();
        if (prev) {
          prev.zone = zone || prev.zone;
          prev.district = district || prev.district;
          return;
        }
        byAssembly.set(key, {
          zone,
          district,
          assembly,
          total_booths: 0,
          total_votes: 0,
          added_sakhi: 0,
          with_epic_added: 0,
          without_epic_added: 0,
          booth_received_set: new Set<string>(),
          dob_received: 0,
          age_55_plus: 0,
          epic_received: 0,
          aadhaar_received: 0,
        });
      });

      // Fallback from locations only if still missing.
      (locationAgg.rows ?? []).forEach((row: any) => {
        const assembly = String(row?.assembly ?? "").trim();
        if (!assembly) return;
        const key = assembly.toLowerCase();
        const prev = byAssembly.get(key);
        const zone = String(row?.zone ?? "").trim();
        const district = String(row?.district ?? "").trim();
        if (prev) {
          if (!prev.zone) prev.zone = zone;
          if (!prev.district) prev.district = district;
          return;
        }
        byAssembly.set(key, {
          zone,
          district,
          assembly,
          total_booths: 0,
          total_votes: 0,
          added_sakhi: 0,
          booth_received_set: new Set<string>(),
          dob_received: 0,
          age_55_plus: 0,
          epic_received: 0,
          aadhaar_received: 0,
        });
      });

      // Final fallback: derive zone from district for assemblies still missing zone.
      byAssembly.forEach((agg) => {
        if (agg.zone) return;
        const inferred = inferZoneFromDistrict(agg.district);
        if (inferred) agg.zone = inferred;
      });

      const ageFromDob = (raw: string): number | null => {
        const t = String(raw || "").trim();
        if (!t) return null;
        const d = new Date(t);
        if (Number.isNaN(d.getTime())) return null;
        const now = new Date();
        let age = now.getFullYear() - d.getFullYear();
        const m = now.getMonth() - d.getMonth();
        if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
        return age >= 0 && age <= 120 ? age : null;
      };

      (subRows.rows ?? []).forEach((row: any) => {
        const assembly = String(row?.assembly ?? "").trim();
        if (!assembly) return;
        const key = assembly.toLowerCase();
        if (!byAssembly.has(key)) {
          byAssembly.set(key, {
            zone: "",
            district: "",
            assembly,
            total_booths: 0,
            total_votes: 0,
            added_sakhi: 0,
            with_epic_added: 0,
            without_epic_added: 0,
            booth_received_set: new Set<string>(),
            dob_received: 0,
            age_55_plus: 0,
            epic_received: 0,
            aadhaar_received: 0,
          });
        }
        const agg = byAssembly.get(key)!;

        agg.added_sakhi += 1;
        if (row?.submitted_with_epic === true) agg.with_epic_added += 1;
        else if (row?.submitted_with_epic === false) agg.without_epic_added += 1;

        const ocr = Array.isArray(row?.ocr_data) ? row.ocr_data : [];
        const voterLookup = ocr.find((x: any) => x?.label === "voter_lookup");
        let lookup: Record<string, unknown> = {};
        try {
          const parsed = JSON.parse(String(voterLookup?.text ?? "{}"));
          if (parsed && typeof parsed === "object") lookup = parsed as Record<string, unknown>;
        } catch {
          lookup = {};
        }

        const booth = String(row?.booth_number ?? lookup.boothid ?? "").trim();
        if (booth) agg.booth_received_set.add(booth);

        const epic = String(row?.epic ?? lookup.vcardid ?? "").trim();
        if (epic) agg.epic_received += 1;

        const aadhaar = String(row?.aadhaar_number ?? lookup.aadhaar_number ?? "").replace(/\D/g, "").slice(0, 12);
        if (aadhaar.length === 12) agg.aadhaar_received += 1;

        const dobRaw = String(row?.dob ?? lookup.dob ?? "").trim();
        if (dobRaw) agg.dob_received += 1;
        const age = ageFromDob(dobRaw);
        if (age !== null && age >= 55) agg.age_55_plus += 1;
      });

      const reqByAssembly = new Map<string, number>();
      (boothVotesAgg.rows ?? []).forEach((row: any) => {
        const assembly = String(row?.assembly ?? "").trim();
        if (!assembly) return;
        const key = assembly.toLowerCase();
        reqByAssembly.set(key, Number(row?.approx_sakhi_required ?? 0));
      });

      const rows = [...byAssembly.values()]
        .map((r) => {
          const requiredSakhi = reqByAssembly.get(r.assembly.toLowerCase()) ?? 0;
          return {
            zone: r.zone || "—",
            district: r.district || "—",
            assembly: r.assembly,
            total_booths: r.total_booths,
            booth_detail_received: r.booth_received_set.size,
            booth_detail_received_pct:
              r.total_booths > 0 ? Number(((r.booth_received_set.size * 100) / r.total_booths).toFixed(1)) : 0,
            approx_sakhi_required: requiredSakhi,
            total_votes: r.total_votes,
            required_sakhi: requiredSakhi,
            added_sakhi: r.added_sakhi,
            with_epic_added: r.with_epic_added,
            without_epic_added: r.without_epic_added,
            dob_received: r.dob_received,
            age_55_plus: r.age_55_plus,
            epic_received: r.epic_received,
            aadhaar_received: r.aadhaar_received,
          };
        })
        // Hide orphan assemblies that have no voter/submission footprint in the report.
        .filter(
          (r) =>
            r.total_booths > 0 ||
            r.total_votes > 0 ||
            r.required_sakhi > 0 ||
            r.added_sakhi > 0 ||
            r.booth_detail_received > 0
        )
        .sort((a, b) => a.assembly.localeCompare(b.assembly));

      return rows;
      };

      if (!assemblyDashboardInFlight) {
        assemblyDashboardInFlight = loadRows().finally(() => {
          assemblyDashboardInFlight = null;
        });
      }

      const rows = await assemblyDashboardInFlight;
      assemblyDashboardCache = {
        rows,
        expiresAt: Date.now() + ASSEMBLY_DASHBOARD_CACHE_TTL_MS,
      };

      return new Response(
        JSON.stringify({ success: true, rows }),
        {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    if (action === "admin-sakhi-analytics") {
      const body = (await req.json()) as { userId?: string; password?: string };
      if (body?.userId !== "admin" || body?.password !== "admin@123") {
        return new Response(
          JSON.stringify({ success: false, message: "Invalid admin credentials" }),
          {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const wingExpr = `COALESCE(
          NULLIF(TRIM(COALESCE(u.profile_data->>'Wing Name', '')), ''),
          NULLIF(TRIM(COALESCE(u.profile_data->>'Wing', '')), ''),
          '—'
        )`;

      const [totalRes, byUserRes, byWingRes, byAssemblyRes, byUserAsmRes] = await Promise.all([
        pool.query(`SELECT COUNT(*)::bigint AS c FROM submissions WHERE deleted_at IS NULL`),
        pool.query(
          `SELECT
            u.id::text AS user_id,
            COALESCE(NULLIF(TRIM(u.name), ''), '—') AS name,
            COALESCE(NULLIF(TRIM(u.mobile), ''), '—') AS mobile,
            ${wingExpr} AS wing,
            COUNT(*)::bigint AS total_sakhi
          FROM submissions s
          INNER JOIN users u ON u.id = s.user_id
          WHERE s.deleted_at IS NULL
          GROUP BY u.id, u.name, u.mobile, u.profile_data
          ORDER BY COUNT(*) DESC, COALESCE(NULLIF(TRIM(u.name), ''), '') ASC`
        ),
        pool.query(
          `SELECT
            COALESCE(
              NULLIF(TRIM(COALESCE(u.profile_data->>'Wing Name', '')), ''),
              NULLIF(TRIM(COALESCE(u.profile_data->>'Wing', '')), ''),
              '(No wing)'
            ) AS wing,
            COUNT(*)::bigint AS total_sakhi
          FROM submissions s
          INNER JOIN users u ON u.id = s.user_id
          WHERE s.deleted_at IS NULL
          GROUP BY 1
          ORDER BY COUNT(*) DESC, 1 ASC`
        ),
        pool.query(
          `SELECT
            TRIM(s.assembly) AS assembly,
            COUNT(*)::bigint AS total_sakhi
          FROM submissions s
          WHERE s.deleted_at IS NULL
            AND s.assembly IS NOT NULL
            AND btrim(s.assembly) <> ''
          GROUP BY TRIM(s.assembly)
          ORDER BY COUNT(*) DESC, TRIM(s.assembly) ASC`
        ),
        pool.query(
          `SELECT
            u.id::text AS user_id,
            COALESCE(NULLIF(TRIM(u.name), ''), '—') AS name,
            TRIM(s.assembly) AS assembly,
            COUNT(*)::bigint AS sakhi_count
          FROM submissions s
          INNER JOIN users u ON u.id = s.user_id
          WHERE s.deleted_at IS NULL
            AND s.assembly IS NOT NULL
            AND btrim(s.assembly) <> ''
          GROUP BY u.id, u.name, TRIM(s.assembly)
          ORDER BY COALESCE(NULLIF(TRIM(u.name), ''), '') ASC, TRIM(s.assembly) ASC`
        ),
      ]);

      const totalSubmissions = Number(totalRes.rows?.[0]?.c ?? 0);

      const byUser = (byUserRes.rows ?? []).map((r: Record<string, unknown>) => ({
        user_id: String(r.user_id ?? ""),
        name: String(r.name ?? ""),
        mobile: String(r.mobile ?? ""),
        wing: String(r.wing ?? "—"),
        total_sakhi: Number(r.total_sakhi ?? 0),
      }));

      const byWing = (byWingRes.rows ?? []).map((r: Record<string, unknown>) => ({
        wing: String(r.wing ?? ""),
        total_sakhi: Number(r.total_sakhi ?? 0),
      }));

      const byAssembly = (byAssemblyRes.rows ?? []).map((r: Record<string, unknown>) => ({
        assembly: String(r.assembly ?? ""),
        total_sakhi: Number(r.total_sakhi ?? 0),
      }));

      const byUserAssembly = (byUserAsmRes.rows ?? []).map((r: Record<string, unknown>) => ({
        user_id: String(r.user_id ?? ""),
        name: String(r.name ?? ""),
        assembly: String(r.assembly ?? ""),
        sakhi_count: Number(r.sakhi_count ?? 0),
      }));

      return new Response(
        JSON.stringify({
          success: true,
          totalSubmissions,
          byUser,
          byWing,
          byAssembly,
          byUserAssembly,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (action === "admin-upload-locations") {
      const { userId, password, clearExisting, rows }: AdminUploadLocationsRequest = await req.json();

      if (userId !== "admin" || password !== "admin@123") {
        return new Response(
          JSON.stringify({ success: false, message: "Invalid admin credentials" }),
          {
            status: 401,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }

      if (!Array.isArray(rows) || rows.length === 0) {
        return new Response(
          JSON.stringify({ success: false, message: "No rows provided" }),
          {
            status: 400,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }

      if (clearExisting) {
        const { error: deleteError } = await supabase.from("locations").delete().neq("id", "00000000-0000-0000-0000-000000000000");
        if (deleteError) {
          return new Response(
            JSON.stringify({ success: false, message: deleteError.message }),
            {
              status: 500,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
              },
            }
          );
        }
      }

      const cleanRows = rows
        .map((row) => ({
          state: row.state?.trim() ?? "",
          district: row.district?.trim() ?? "",
          assembly: row.assembly?.trim() ?? "",
          halka: row.halka?.trim() ?? "",
          village: row.village?.trim() ?? "",
          booth_number: row.booth_number?.trim() ?? "",
        }))
        .filter((row) => row.state && row.district && row.assembly && row.halka && row.village);

      const { error: insertError } = await supabase.from("locations").insert(cleanRows);
      if (insertError) {
        return new Response(
          JSON.stringify({ success: false, message: insertError.message }),
          {
            status: 500,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }

      return new Response(
        JSON.stringify({ success: true, inserted: cleanRows.length }),
        {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    if (action === "admin-upload-voters") {
      const { userId, password, rows }: AdminUploadVotersRequest = await req.json();

      if (userId !== "admin" || password !== "admin@123") {
        return new Response(
          JSON.stringify({ success: false, message: "Invalid admin credentials" }),
          {
            status: 401,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }

      if (!Array.isArray(rows) || rows.length === 0) {
        return new Response(
          JSON.stringify({ success: false, message: "No rows provided" }),
          {
            status: 400,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }

      const parseAge = (v: unknown): number | null => {
        if (v === null || v === undefined || v === "") return null;
        const n = Number(typeof v === "string" ? String(v).trim() : v);
        return Number.isFinite(n) ? Math.trunc(n) : null;
      };

      /** EPIC must be non-empty; stored uppercase trimmed to match unique index */
      const normalizeEpic = (v: unknown): string | null => {
        const s = String(v ?? "").trim();
        if (!s) return null;
        return s.toUpperCase();
      };

      const missingEpicCount = rows.reduce((n, row) => {
        return normalizeEpic(row.vcardid) ? n : n + 1;
      }, 0);

      type VoterRow = {
        e_first_name: string | null;
        e_middle_name: string | null;
        sex: string | null;
        age: number | null;
        vcardid: string;
        house_no: string | null;
        part_no: string | null;
        srno: string | null;
        boothid: string | null;
        familyid: string | null;
        full_name: string | null;
        e_assemblyname: string | null;
      };

      const mapped = rows
        .map((row) => {
          const vcardid = normalizeEpic(row.vcardid);
          return {
            e_first_name: String(row.e_first_name ?? "").trim() || null,
            e_middle_name: String(row.e_middle_name ?? "").trim() || null,
            sex: String(row.sex ?? "").trim() || null,
            age: parseAge(row.age),
            vcardid,
            house_no: String(row.house_no ?? "").trim() || null,
            part_no: String(row.part_no ?? "").trim() || null,
            srno: String(row.srno ?? "").trim() || null,
            boothid: String(row.boothid ?? "").trim() || null,
            familyid: String(row.familyid ?? "").trim() || null,
            full_name: String(row.full_name ?? "").trim() || null,
            e_assemblyname: String(row.e_assemblyname ?? "").trim() || null,
          };
        })
        .filter((row): row is VoterRow => row.vcardid !== null);

      if (mapped.length === 0) {
        return new Response(
          JSON.stringify({
            success: false,
            message: "No valid voter rows: EPIC (vcardid) is required in every row.",
            missingEpicCount,
          }),
          {
            status: 400,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }

      /** If duplicate EPIC appears in the same chunk, keep the last row to avoid ON CONFLICT double-hit. */
      const epicToRow = new Map<string, VoterRow>();
      for (const row of mapped) {
        epicToRow.set(row.vcardid, row);
      }
      const dedupedRows = [...epicToRow.values()];
      const duplicateEpicInChunkCount = mapped.length - dedupedRows.length;

      const { error: upsertError } = await supabase
        .from("voters")
        .upsert(dedupedRows, { onConflict: "vcardid" });

      if (upsertError) {
        const hint =
          String(upsertError.message).includes("unique or exclusion constraint") ||
          String(upsertError.message).includes("ON CONFLICT")
            ? " UNIQUE index on voters.vcardid is required in database — apply latest migration (idx_voters_vcardid)."
            : "";
        return new Response(
          JSON.stringify({ success: false, message: upsertError.message + hint }),
          {
            status: 500,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }

      const processedRows = dedupedRows.length;

      return new Response(
        JSON.stringify({
          success: true,
          processedRows,
          submittedWithEpic: mapped.length,
          dedupedInChunk: dedupedRows.length,
          duplicateEpicInChunkCount,
          missingEpicCount,
          note: "Same EPIC rows are updated (upsert), not skipped.",
        }),
        {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    if (action === "admin-voters-count") {
      const body = await req.json().catch(() => ({}));
      const userId = body?.userId as string | undefined;
      const password = body?.password as string | undefined;

      if (userId !== "admin" || password !== "admin@123") {
        return new Response(
          JSON.stringify({ success: false, message: "Invalid admin credentials" }),
          {
            status: 401,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }

      const { data: statsJson, error: rpcError } = await supabase.rpc("admin_voter_upload_stats");

      if (!rpcError && statsJson && typeof statsJson === "object") {
        const s = statsJson as {
          total?: unknown;
          assemblyWise?: unknown;
          boothDistinct?: unknown;
        };
        const total =
          typeof s.total === "number" ? s.total : Number(s.total ?? 0);
        const assemblyWise = Array.isArray(s.assemblyWise) ? s.assemblyWise : [];
        const boothDistinct =
          typeof s.boothDistinct === "number"
            ? s.boothDistinct
            : Number(s.boothDistinct ?? 0);

        return new Response(
          JSON.stringify({
            success: true,
            count: Number.isFinite(total) ? total : 0,
            assemblyWise,
            boothDistinct: Number.isFinite(boothDistinct) ? boothDistinct : 0,
          }),
          {
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }

      const { count, error: countError } = await supabase
        .from("voters")
        .select("*", { count: "exact", head: true });

      if (countError) {
        return new Response(
          JSON.stringify({
            success: false,
            message: rpcError?.message ?? countError.message,
          }),
          {
            status: 500,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          count: count ?? 0,
          assemblyWise: [],
          boothDistinct: null,
        }),
        {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    if (action === "admin-voter-summary-assemblies") {
      const body = await req.json().catch(() => ({}));
      if (body?.userId !== "admin" || body?.password !== "admin@123") {
        return new Response(
          JSON.stringify({ success: false, message: "Invalid admin credentials" }),
          {
            status: 401,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }
      const filter = typeof body?.filter === "string" ? body.filter : "";
      const limit = Math.min(Math.max(Number(body?.limit) || 200, 1), 500);
      const { data, error: rpcErr } = await supabase.rpc("admin_voter_assembly_list", {
        p_filter: filter,
        p_limit: limit,
      });
      if (rpcErr) {
        return new Response(
          JSON.stringify({ success: false, message: rpcErr.message }),
          {
            status: 500,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }
      return new Response(
        JSON.stringify({ success: true, assemblies: data ?? [] }),
        {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    if (action === "admin-voter-summary-booths") {
      const body = await req.json().catch(() => ({}));
      if (body?.userId !== "admin" || body?.password !== "admin@123") {
        return new Response(
          JSON.stringify({ success: false, message: "Invalid admin credentials" }),
          {
            status: 401,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }
      const assembly = String(body?.assembly ?? "").trim();
      if (!assembly) {
        return new Response(
          JSON.stringify({ success: false, message: "assembly is required" }),
          {
            status: 400,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }
      const limit = Math.min(Math.max(Number(body?.limit) || 100, 1), 500);
      const offset = Math.max(Number(body?.offset) || 0, 0);
      const { data, error: rpcErr } = await supabase.rpc("admin_voter_booths_page", {
        p_assembly: assembly,
        p_limit: limit,
        p_offset: offset,
      });
      if (rpcErr) {
        return new Response(
          JSON.stringify({ success: false, message: rpcErr.message }),
          {
            status: 500,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }
      return new Response(
        JSON.stringify({ success: true, ...(typeof data === "object" && data !== null ? data : { rows: [] }) }),
        {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    if (action === "admin-voter-summary-refresh") {
      const body = await req.json().catch(() => ({}));
      if (body?.userId !== "admin" || body?.password !== "admin@123") {
        return new Response(
          JSON.stringify({ success: false, message: "Invalid admin credentials" }),
          {
            status: 401,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }
      const { error: refErr } = await supabase.rpc("admin_refresh_voter_assembly_summary");
      if (refErr) {
        return new Response(
          JSON.stringify({ success: false, message: refErr.message }),
          {
            status: 500,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }
      return new Response(
        JSON.stringify({ success: true }),
        {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    if (action === "admin-create-user") {
      const payload: AdminCreateUserRequest = await req.json();
      if (payload.userId !== "admin" || payload.password !== "admin@123") {
        return new Response(
          JSON.stringify({ success: false, message: "Invalid admin credentials" }),
          {
            status: 401,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }

      if (!payload.name || !payload.mobile || !payload.preferred_assembly) {
        return new Response(
          JSON.stringify({ success: false, message: "Name, mobile, and assembly are required" }),
          {
            status: 400,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }

      const mobile = String(payload.mobile ?? "").replace(/\D/g, "").slice(0, 10);
      if (mobile.length !== 10) {
        return new Response(
          JSON.stringify({ success: false, message: "Contact number must be a 10-digit mobile" }),
          {
            status: 400,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }

      const targetUserId = String(payload.targetUserId ?? "").trim();
      if (targetUserId) {
        const { data: duplicateMobileUser } = await supabase
          .from("users")
          .select("id")
          .eq("mobile", mobile)
          .neq("id", targetUserId)
          .limit(1)
          .maybeSingle();
        if (duplicateMobileUser) {
          return new Response(
            JSON.stringify({ success: false, message: "This contact number is already used by another user" }),
            {
              status: 400,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
              },
            }
          );
        }

        const updateRow: Record<string, unknown> = {
          name: payload.name,
          mobile,
          preferred_assembly: payload.preferred_assembly,
        };
        if (payload.profile_data !== undefined) {
          updateRow.profile_data = payload.profile_data;
        }

        const { error: updateByIdError } = await supabase
          .from("users")
          .update(updateRow)
          .eq("id", targetUserId);

        if (updateByIdError) {
          return new Response(
            JSON.stringify({ success: false, message: updateByIdError.message }),
            {
              status: 400,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
              },
            }
          );
        }

        return new Response(
          JSON.stringify({ success: true }),
          {
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }

      const { data: existingUser } = await supabase
        .from("users")
        .select("id")
        .eq("mobile", mobile)
        .maybeSingle();

      if (existingUser) {
        const updateRow: Record<string, unknown> = {
          name: payload.name,
          preferred_assembly: payload.preferred_assembly,
        };
        if (payload.profile_data !== undefined) {
          updateRow.profile_data = payload.profile_data;
        }
        const { error: updateError } = await supabase
          .from("users")
          .update(updateRow)
          .eq("mobile", mobile);

        if (updateError) {
          return new Response(
            JSON.stringify({ success: false, message: updateError.message }),
            {
              status: 400,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
              },
            }
          );
        }
      } else {
        const insertRow: Record<string, unknown> = {
          name: payload.name,
          mobile,
          preferred_assembly: payload.preferred_assembly,
          is_verified: false,
        };
        if (payload.profile_data !== undefined) {
          insertRow.profile_data = payload.profile_data;
        }
        const { error: insertError } = await supabase
          .from("users")
          .insert(insertRow);

        if (insertError) {
          return new Response(
            JSON.stringify({ success: false, message: insertError.message }),
            {
              status: 400,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
              },
            }
          );
        }
      }

      return new Response(
        JSON.stringify({ success: true }),
        {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    if (action === "admin-upload-users") {
      const payload: AdminUploadUsersRequest = await req.json();
      if (payload.userId !== "admin" || payload.password !== "admin@123") {
        return new Response(
          JSON.stringify({ success: false, message: "Invalid admin credentials" }),
          {
            status: 401,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }

      if (!Array.isArray(payload.users) || payload.users.length === 0) {
        return new Response(
          JSON.stringify({ success: false, message: "No users provided" }),
          {
            status: 400,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }

      let created = 0;
      let updated = 0;
      let dedupedByMobile = 0;

      // Contact number is unique key for incharge upload. Deduplicate payload first.
      const mobileToRow = new Map<string, (typeof payload.users)[number]>();
      for (const row of payload.users) {
        const mobile = String(row?.mobile ?? "").replace(/\D/g, "").slice(0, 10);
        if (!mobile) continue;
        mobileToRow.set(mobile, { ...row, mobile });
      }
      dedupedByMobile = Math.max(0, payload.users.length - mobileToRow.size);

      const validRows = [...mobileToRow.values()].filter(
        (r) =>
          String(r.name ?? "").trim() &&
          r.mobile &&
          String(r.preferred_assembly ?? "").trim()
      );

      if (validRows.length === 0) {
        return new Response(
          JSON.stringify({ success: true, created: 0, updated: 0, dedupedByMobile }),
          {
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }

      const mobiles = validRows.map((r) => r.mobile);
      const preExisting = await pool.query<{ mobile: string }>(
        `SELECT mobile FROM users WHERE mobile = ANY($1::text[])`,
        [mobiles]
      );
      const existingSet = new Set(preExisting.rows.map((r) => r.mobile));
      created = validRows.filter((r) => !existingSet.has(r.mobile)).length;
      updated = validRows.filter((r) => existingSet.has(r.mobile)).length;

      const names = validRows.map((r) => String(r.name).trim());
      const assemblies = validRows.map((r) => String(r.preferred_assembly).trim());
      const profileTexts = validRows.map((r) => JSON.stringify(r.profile_data ?? {}));
      const verifiedArr = validRows.map(() => false);

      try {
        await pool.query(
          `
        INSERT INTO users (name, mobile, preferred_assembly, profile_data, is_verified)
        SELECT t.name, t.mobile, t.pref, t.prof::jsonb, t.ver
        FROM unnest(
          $1::text[],
          $2::text[],
          $3::text[],
          $4::text[],
          $5::boolean[]
        ) AS t(name, mobile, pref, prof, ver)
        ON CONFLICT (mobile) DO UPDATE SET
          name = EXCLUDED.name,
          preferred_assembly = EXCLUDED.preferred_assembly,
          profile_data = EXCLUDED.profile_data
        `,
          [names, mobiles, assemblies, profileTexts, verifiedArr]
        );
      } catch (e) {
        return new Response(
          JSON.stringify({
            success: false,
            message: e instanceof Error ? e.message : "Bulk upload failed",
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      return new Response(
        JSON.stringify({ success: true, created, updated, dedupedByMobile }),
        {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    if (action === "admin-list-incharges") {
      const payload: AdminListInchargesRequest = await req.json();
      if (payload.userId !== "admin" || payload.password !== "admin@123") {
        return new Response(
          JSON.stringify({ success: false, message: "Invalid admin credentials" }),
          {
            status: 401,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }

      const rawLimit = Number(payload.limit);
      const rawOffset = Number(payload.offset);
      const limit = Math.min(
        50000,
        Math.max(1, Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 50)
      );
      const offset = Math.max(0, Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0);
      const search = payload.search?.trim() || null;
      const des = payload.designation?.trim();
      const designation =
        des && des.toLowerCase() !== "all designations" ? des : null;

      const { data: pageRows, error: rpcErr } = await supabase.rpc("admin_list_incharges_page", {
        p_search: search,
        p_designation: designation,
        p_limit: limit,
        p_offset: offset,
      });

      if (rpcErr) {
        return new Response(JSON.stringify({ success: false, message: rpcErr.message }), {
          status: 500,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        });
      }

      const { data: statsRows, error: statsErr } = await supabase.rpc("admin_incharge_filtered_stats", {
        p_search: search,
        p_designation: designation,
      });

      let statsTotal = 0;
      let designationStats: Record<string, number> = {};
      if (!statsErr && statsRows && typeof statsRows === "object") {
        const sr = Array.isArray(statsRows) ? statsRows[0] : statsRows;
        const raw = sr as {
          by_designation?: Record<string, unknown>;
          total?: number | string;
        } | undefined;
        if (raw?.total != null) statsTotal = Number(raw.total) || 0;
        const bd = raw?.by_designation;
        if (bd && typeof bd === "object") {
          designationStats = Object.fromEntries(
            Object.entries(bd).map(([k, v]) => [k, Number(v) || 0])
          );
        }
      }

      const rows = Array.isArray(pageRows) ? pageRows : [];
      const first = rows[0] as { total_count?: number | string } | undefined;
      const total =
        rows.length > 0 && first?.total_count != null
          ? Number(first.total_count)
          : statsTotal;

      const incharges = rows.map((r: Record<string, unknown>) => ({
        id: r.id as string,
        name: r.name as string,
        mobile: r.mobile as string,
        preferred_assembly: (r.preferred_assembly as string | null) ?? null,
        profile_data: r.profile_data as Record<string, unknown> | null,
        is_verified: r.is_verified as boolean,
        created_at: r.created_at as string,
      }));

      return new Response(
        JSON.stringify({
          success: true,
          incharges,
          total,
          designationStats,
        }),
        {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    if (action === "admin-delete-user") {
      const payload: AdminDeleteUserRequest = await req.json();
      if (payload.userId !== "admin" || payload.password !== "admin@123") {
        return new Response(
          JSON.stringify({ success: false, message: "Invalid admin credentials" }),
          {
            status: 401,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }

      if (!payload.targetUserId?.trim()) {
        return new Response(
          JSON.stringify({ success: false, message: "targetUserId required" }),
          {
            status: 400,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }

      const { error: delError } = await supabase.from("users").delete().eq("id", payload.targetUserId.trim());

      if (delError) {
        return new Response(
          JSON.stringify({ success: false, message: delError.message }),
          {
            status: 500,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }

      return new Response(
        JSON.stringify({ success: true }),
        {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    if (action === "admin-bulk-delete-incharges") {
      const payload: AdminBulkDeleteInchargesRequest = await req.json();
      if (payload.userId !== "admin" || payload.password !== "admin@123") {
        return new Response(
          JSON.stringify({ success: false, message: "Invalid admin credentials" }),
          {
            status: 401,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }

      const pageSize = 1000;
      const idsToDelete: string[] = [];
      let from = 0;

      while (true) {
        const { data: page, error: fetchError } = await supabase
          .from("users")
          .select("id, profile_data")
          .not("profile_data", "is", null)
          .range(from, from + pageSize - 1);

        if (fetchError) {
          return new Response(
            JSON.stringify({ success: false, message: fetchError.message }),
            {
              status: 500,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
              },
            }
          );
        }

        if (!page?.length) break;

        for (const row of page) {
          const pd = row.profile_data as Record<string, unknown> | null;
          const des = pd?.Designation ?? pd?.designation;
          if (typeof des === "string" && des.trim().length > 0) {
            idsToDelete.push(row.id);
          }
        }

        if (page.length < pageSize) break;
        from += pageSize;
      }

      const chunkSize = 200;
      for (let i = 0; i < idsToDelete.length; i += chunkSize) {
        const chunk = idsToDelete.slice(i, i + chunkSize);
        const { error: delErr } = await supabase.from("users").delete().in("id", chunk);
        if (delErr) {
          return new Response(
            JSON.stringify({ success: false, message: delErr.message }),
            {
              status: 500,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
              },
            }
          );
        }
      }

      return new Response(
        JSON.stringify({ success: true, deleted: idsToDelete.length }),
        {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    if (action === "admin-offline-sakhi-validate") {
      const payload: AdminOfflineSakhiValidateRequest = await req.json();
      if (payload.userId !== "admin" || payload.password !== "admin@123") {
        return new Response(
          JSON.stringify({ success: false, message: "Invalid admin credentials" }),
          {
            status: 401,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }

      const rowsIn = Array.isArray(payload.rows) ? payload.rows : [];
      if (rowsIn.length === 0) {
        return new Response(
          JSON.stringify({ success: false, message: "No rows to validate" }),
          {
            status: 400,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }
      if (rowsIn.length > 8000) {
        return new Response(
          JSON.stringify({ success: false, message: "Maximum 8000 rows per upload" }),
          {
            status: 400,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }

      const epicKeys = rowsIn.map((r) => normEpicOffline(r.epic)).filter((k) => k.length > 0);
      const uniqueEpics = [...new Set(epicKeys)];

      let dbRows: Array<{
        vcardid: string | null;
        e_first_name: string | null;
        e_middle_name: string | null;
        sex: string | null;
        age: number | null;
        boothid: string | null;
        full_name: string | null;
        e_assemblyname: string | null;
      }> = [];

      if (uniqueEpics.length > 0) {
        try {
          const q = await pool.query(
            `SELECT vcardid, e_first_name, e_middle_name, sex, age, boothid, full_name, e_assemblyname
             FROM voters v
             WHERE upper(regexp_replace(btrim(coalesce(v.vcardid, '')), E'\\s+', '', 'g')) = ANY(
               SELECT upper(regexp_replace(btrim(coalesce(x, '')), E'\\s+', '', 'g')) FROM unnest($1::text[]) AS x
             )`,
            [uniqueEpics]
          );
          dbRows = q.rows ?? [];
        } catch (e) {
          return new Response(
            JSON.stringify({
              success: false,
              message: e instanceof Error ? e.message : "Voter lookup failed.",
            }),
            {
              status: 500,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
              },
            }
          );
        }
      }

      const dbByEpic = new Map<string, (typeof dbRows)[0]>();
      for (const vr of dbRows) {
        const k = normEpicOffline(vr.vcardid);
        if (k && !dbByEpic.has(k)) dbByEpic.set(k, vr);
      }

      type RowStatus = "ok" | "mismatch" | "not_found";
      const results: Array<{
        rowIndex: number;
        status: RowStatus;
        epic: string;
        mismatchedFields: string[];
        csv: Record<string, string>;
        roll: {
          full_name: string | null;
          father_or_husband: string | null;
          sex: string | null;
          age: number | null;
          halka: string | null;
          booth: string | null;
        } | null;
      }> = [];

      let ok = 0;
      let mismatch = 0;
      let notFound = 0;

      rowsIn.forEach((raw, rowIndex) => {
        const epic = String(raw.epic ?? "").trim();
        const epicKey = normEpicOffline(epic);
        const csv: Record<string, string> = {
          applicantName: String(raw.applicantName ?? ""),
          mobile: String(raw.mobile ?? ""),
          fatherName: String(raw.fatherName ?? ""),
          dob: String(raw.dob ?? ""),
          gender: String(raw.gender ?? ""),
          aadhaar: String(raw.aadhaar ?? ""),
          altMobile: String(raw.altMobile ?? ""),
          district: String(raw.district ?? ""),
          halka: String(raw.halka ?? ""),
          tehsil: String(raw.tehsil ?? ""),
          region: String(raw.region ?? ""),
          booth: String(raw.booth ?? ""),
        };

        if (!epicKey) {
          notFound += 1;
          results.push({
            rowIndex,
            status: "not_found",
            epic: epic || "(empty)",
            mismatchedFields: ["EPIC missing"],
            csv,
            roll: null,
          });
          return;
        }

        const db = dbByEpic.get(epicKey);
        if (!db) {
          notFound += 1;
          results.push({
            rowIndex,
            status: "not_found",
            epic,
            mismatchedFields: ["EPIC not in electoral roll"],
            csv,
            roll: null,
          });
          return;
        }

        const mismatchedFields: string[] = [];
        const rollName = String(db.full_name ?? db.e_first_name ?? "").trim();
        if (!namesMatchOffline(csv.applicantName, rollName)) {
          mismatchedFields.push("Name");
        }
        if (!namesMatchOffline(csv.fatherName, String(db.e_middle_name ?? ""))) {
          mismatchedFields.push("Father / husband name");
        }

        const gCsv = genderBucketOffline(csv.gender);
        const gDb = genderBucketOffline(String(db.sex ?? ""));
        if (gCsv !== "?" && gDb !== "?" && gCsv !== gDb) {
          mismatchedFields.push("Gender");
        }

        const csvAge = ageFromCsvDobOffline(csv.dob);
        const dbAge = db.age;
        if (csvAge !== null && dbAge !== null && dbAge !== undefined) {
          if (Math.abs(csvAge - Number(dbAge)) > 1) {
            mismatchedFields.push("Age / DOB");
          }
        } else if (csvAge !== null && (dbAge === null || dbAge === undefined)) {
          /* skip */
        }

        if (!halkaMatchesOffline(csv.halka, String(db.e_assemblyname ?? ""))) {
          mismatchedFields.push("Halka (vs roll AC/Halka)");
        }

        if (!boothMatchOffline(csv.booth, db.boothid)) {
          mismatchedFields.push("Booth number");
        }

        const status: RowStatus = mismatchedFields.length === 0 ? "ok" : "mismatch";
        if (status === "ok") ok += 1;
        else mismatch += 1;

        results.push({
          rowIndex,
          status,
          epic,
          mismatchedFields,
          csv,
          roll: {
            full_name: db.full_name ?? db.e_first_name ?? null,
            father_or_husband: db.e_middle_name ?? null,
            sex: db.sex ?? null,
            age: db.age ?? null,
            halka: db.e_assemblyname ?? null,
            booth: db.boothid ?? null,
          },
        });
      });

      return new Response(
        JSON.stringify({
          success: true,
          summary: { ok, mismatch, not_found: notFound, total: rowsIn.length },
          results,
        }),
        {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    if (action === "admin-offline-sakhi-report-save-begin") {
      const payload: AdminOfflineSakhiReportSaveBeginRequest = await req.json();
      if (payload.userId !== "admin" || payload.password !== "admin@123") {
        return new Response(
          JSON.stringify({ success: false, message: "Invalid admin credentials" }),
          {
            status: 401,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }
      const summary = payload.summary;
      const csvHeaders = payload.csvHeaders;
      if (!summary || typeof summary !== "object" || !Array.isArray(csvHeaders)) {
        return new Response(
          JSON.stringify({ success: false, message: "summary and csvHeaders[] required" }),
          {
            status: 400,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }
      const fileName = String(payload.fileName ?? "").slice(0, 512);
      try {
        const ins = await pool.query(
          `INSERT INTO offline_sakhi_reports (file_name, summary, csv_headers, results)
           VALUES ($1, $2::jsonb, $3::jsonb, '[]'::jsonb)
           RETURNING id`,
          [fileName, JSON.stringify(summary), JSON.stringify(csvHeaders)]
        );
        const reportId = ins.rows[0]?.id as string | undefined;
        if (!reportId) {
          return new Response(
            JSON.stringify({ success: false, message: "Insert did not return id" }),
            {
              status: 500,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
              },
            }
          );
        }
        return new Response(
          JSON.stringify({ success: true, reportId }),
          {
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/relation "offline_sakhi_reports" does not exist/i.test(msg)) {
          return new Response(
            JSON.stringify({
              success: false,
              message:
                "Table offline_sakhi_reports missing — run migration 20260411100000_offline_sakhi_reports.sql on the database.",
            }),
            {
              status: 500,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
              },
            }
          );
        }
        return new Response(
          JSON.stringify({ success: false, message: msg }),
          {
            status: 500,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }
    }

    if (action === "admin-offline-sakhi-report-save-rows") {
      const payload: AdminOfflineSakhiReportSaveRowsRequest = await req.json();
      if (payload.userId !== "admin" || payload.password !== "admin@123") {
        return new Response(
          JSON.stringify({ success: false, message: "Invalid admin credentials" }),
          {
            status: 401,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }
      const reportId = String(payload.reportId ?? "").trim();
      const rowsIn = payload.rows;
      if (!/^[0-9a-f-]{36}$/i.test(reportId)) {
        return new Response(
          JSON.stringify({ success: false, message: "reportId (uuid) required" }),
          {
            status: 400,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }
      if (!Array.isArray(rowsIn) || rowsIn.length === 0) {
        return new Response(
          JSON.stringify({ success: false, message: "rows[] required and non-empty" }),
          {
            status: 400,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }
      if (rowsIn.length > 150) {
        return new Response(
          JSON.stringify({ success: false, message: "Maximum 150 rows per chunk" }),
          {
            status: 400,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }
      let n = 1;
      const parts: string[] = [];
      const params: unknown[] = [];
      for (const r of rowsIn) {
        parts.push(
          `($${n++}::uuid, $${n++}::int, $${n++}::text, $${n++}::text, $${n++}::jsonb, $${n++}::jsonb, $${n++}::jsonb, $${n++}::jsonb)`
        );
        params.push(
          reportId,
          r.rowIndex,
          r.status,
          r.epic,
          JSON.stringify(Array.isArray(r.mismatchedFields) ? r.mismatchedFields : []),
          JSON.stringify(r.csv ?? {}),
          r.roll != null ? JSON.stringify(r.roll) : null,
          r.extraCells != null ? JSON.stringify(r.extraCells) : null
        );
      }
      try {
        await pool.query(
          `INSERT INTO offline_sakhi_report_rows (report_id, row_index, status, epic, mismatched_fields, csv, roll, extra_cells)
           VALUES ${parts.join(", ")}`,
          params
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/relation "offline_sakhi_report_rows" does not exist/i.test(msg)) {
          return new Response(
            JSON.stringify({
              success: false,
              message:
                "Table offline_sakhi_report_rows missing — run migration 20260412180000_offline_sakhi_report_rows.sql on the database.",
            }),
            {
              status: 500,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
              },
            }
          );
        }
        if (/duplicate key|unique constraint/i.test(msg)) {
          return new Response(
            JSON.stringify({
              success: false,
              message: "Duplicate row_index for this report — do not resend the same chunk.",
            }),
            {
              status: 409,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
              },
            }
          );
        }
        return new Response(
          JSON.stringify({ success: false, message: msg }),
          {
            status: 500,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }
      return new Response(
        JSON.stringify({ success: true }),
        {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    if (action === "admin-offline-sakhi-report-save-abort") {
      const payload: AdminOfflineSakhiReportSaveAbortRequest = await req.json();
      if (payload.userId !== "admin" || payload.password !== "admin@123") {
        return new Response(
          JSON.stringify({ success: false, message: "Invalid admin credentials" }),
          {
            status: 401,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }
      const reportId = String(payload.reportId ?? "").trim();
      if (!/^[0-9a-f-]{36}$/i.test(reportId)) {
        return new Response(
          JSON.stringify({ success: false, message: "reportId (uuid) required" }),
          {
            status: 400,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }
      try {
        await pool.query(`DELETE FROM offline_sakhi_reports WHERE id = $1::uuid`, [reportId]);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return new Response(
          JSON.stringify({ success: false, message: msg }),
          {
            status: 500,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }
      return new Response(
        JSON.stringify({ success: true }),
        {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    if (action === "admin-offline-sakhi-report-save") {
      const payload: AdminOfflineSakhiReportSaveRequest = await req.json();
      if (payload.userId !== "admin" || payload.password !== "admin@123") {
        return new Response(
          JSON.stringify({ success: false, message: "Invalid admin credentials" }),
          {
            status: 401,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }
      const summary = payload.summary;
      const csvHeaders = payload.csvHeaders;
      const results = payload.results;
      if (
        !summary ||
        typeof summary !== "object" ||
        !Array.isArray(csvHeaders) ||
        !Array.isArray(results)
      ) {
        return new Response(
          JSON.stringify({ success: false, message: "summary, csvHeaders[], and results[] required" }),
          {
            status: 400,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }
      if (results.length > 12000) {
        return new Response(
          JSON.stringify({ success: false, message: "Maximum 12000 rows per saved report" }),
          {
            status: 400,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }
      const fileName = String(payload.fileName ?? "").slice(0, 512);
      try {
        await pool.query(
          `INSERT INTO offline_sakhi_reports (file_name, summary, csv_headers, results)
           VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb)`,
          [fileName, JSON.stringify(summary), JSON.stringify(csvHeaders), JSON.stringify(results)]
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/relation "offline_sakhi_reports" does not exist/i.test(msg)) {
          return new Response(
            JSON.stringify({
              success: false,
              message:
                "Table offline_sakhi_reports missing — run migration 20260411100000_offline_sakhi_reports.sql on the database.",
            }),
            {
              status: 500,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
              },
            }
          );
        }
        return new Response(
          JSON.stringify({ success: false, message: msg }),
          {
            status: 500,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }
      return new Response(
        JSON.stringify({ success: true }),
        {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    if (action === "admin-offline-sakhi-import-submissions-rows") {
      const payload: AdminOfflineSakhiImportSubmissionsRowsRequest = await req.json();
      if (payload.userId !== "admin" || payload.password !== "admin@123") {
        return new Response(JSON.stringify({ success: false, message: "Invalid admin credentials" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const rows = payload.rows;
      if (!Array.isArray(rows) || rows.length === 0) {
        return new Response(JSON.stringify({ success: false, message: "rows[] required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (rows.length > 150) {
        return new Response(JSON.stringify({ success: false, message: "Maximum 150 rows per chunk" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const sourceName = String(payload.sourceName ?? "Googleform").slice(0, 64) || "Googleform";

      let inserted = 0;
      let skipped = 0;
      const errors: Array<{ epic: string; mobile: string; assembly: string; reason: string; message: string }> = [];
      const reasonSummary = new Map<string, number>();
      const assemblyStats = new Map<
        string,
        { assembly: string; inserted: number; skipped: number; reasons: Map<string, number> }
      >();
      const bumpReason = (reason: string) => {
        reasonSummary.set(reason, (reasonSummary.get(reason) ?? 0) + 1);
      };
      const ensureAsm = (assembly: string) => {
        const key = assembly.toLowerCase();
        const prev = assemblyStats.get(key);
        if (prev) return prev;
        const next = { assembly, inserted: 0, skipped: 0, reasons: new Map<string, number>() };
        assemblyStats.set(key, next);
        return next;
      };
      const markInserted = (assembly: string) => {
        const asm = ensureAsm(assembly);
        asm.inserted += 1;
      };
      const markSkipped = (assembly: string, reason: string) => {
        const asm = ensureAsm(assembly);
        asm.skipped += 1;
        asm.reasons.set(reason, (asm.reasons.get(reason) ?? 0) + 1);
        bumpReason(reason);
      };

      for (const r of rows) {
        const assembly = String(r.halka ?? "").trim() || "—";
        const epic = normEpicOffline(r.epic);
        const mobile = String(r.mobile ?? "").replace(/\D/g, "").slice(0, 10);
        const mobileErr = validateIndianMobile10Edge(mobile);
        if (mobileErr) {
          skipped += 1;
          markSkipped(assembly, "invalid_mobile");
          errors.push({ epic, mobile, assembly, reason: "invalid_mobile", message: mobileErr });
          continue;
        }

        // Avoid duplicates by mobile OR EPIC (active rows only).
        try {
          const dup = await pool.query(
            `SELECT 1
             FROM submissions s
             WHERE s.deleted_at IS NULL
               AND (s.sakhi_mobile = $1 OR ($2 <> '' AND coalesce(nullif(trim(s.epic),''),'') <> '' AND s.epic = $2))
             LIMIT 1`,
            [mobile, epic]
          );
          if ((dup.rowCount ?? 0) > 0) {
            skipped += 1;
            markSkipped(assembly, "duplicate_mobile_or_epic");
            errors.push({
              epic,
              mobile,
              assembly,
              reason: "duplicate_mobile_or_epic",
              message: "Duplicate found by mobile or EPIC in submissions.",
            });
            continue;
          }
        } catch (e) {
          // If columns missing (epic/source_name/aadhaar_number etc) return actionable error.
          const msg = e instanceof Error ? e.message : String(e);
          if (/column .* does not exist/i.test(msg)) {
            return new Response(
              JSON.stringify({
                success: false,
                message:
                  "Missing submissions import columns — run migration 20260413130000_submissions_googleform_fields.sql (and refresh).",
              }),
              { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
          return new Response(JSON.stringify({ success: false, message: msg }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const applicantName = String(r.applicantName ?? "").trim();
        const fatherName = String(r.fatherName ?? "").trim();
        const district = String(r.district ?? "").trim();
        if (!assembly) {
          skipped += 1;
          markSkipped("—", "invalid_assembly");
          errors.push({
            epic,
            mobile,
            assembly: "—",
            reason: "invalid_assembly",
            message: "Assembly/Halka is required.",
          });
          continue;
        }
        const booth = String(r.booth ?? "").trim();
        const dob = String(r.dob ?? "").trim();
        const gender = normalizeGenderForDb(r.gender);
        const aadhaarDigits = String(r.aadhaar ?? "").replace(/\D/g, "").slice(0, 12);

        // Required text columns in submissions schema
        const state = "Punjab";
        const halkaBlock = assembly;
        const village = "Googleform";

        const voterLookup = {
          vcardid: epic,
          e_first_name: applicantName,
          e_middle_name: fatherName,
          sex: gender,
          dob,
          aadhaar_number: aadhaarDigits,
          mobile_number: mobile,
          boothid: booth,
          e_assemblyname: assembly,
        };

        try {
          await pool.query(
            `INSERT INTO submissions (
               user_id, sakhi_name, sakhi_mobile, father_name, husband_name,
               state, district, assembly, halka, village, booth_number,
               ocr_data, status, source_name, epic, aadhaar_number, dob, gender, submitted_with_epic
             )
             VALUES (
               NULL, $1, $2, $3, $3,
               $4, $5, $6, $7, $8, $9,
               $10::jsonb, 'pending', $11, $12, $13, $14, $15, true
             )`,
            [
              applicantName || "—",
              mobile,
              fatherName || "—",
              state,
              district || "—",
              assembly,
              halkaBlock,
              village,
              booth || null,
              JSON.stringify([{ label: "voter_lookup", text: JSON.stringify(voterLookup) }]),
              sourceName,
              epic,
              aadhaarDigits || null,
              dob || null,
              gender || null,
            ]
          );
          inserted += 1;
          markInserted(assembly);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          skipped += 1;
          markSkipped(assembly, "insert_failed");
          errors.push({ epic, mobile, assembly, reason: "insert_failed", message: msg });
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          inserted,
          skipped,
          errors,
          reasonSummary: Object.fromEntries(reasonSummary),
          assemblyStats: [...assemblyStats.values()].map((a) => ({
            assembly: a.assembly,
            inserted: a.inserted,
            skipped: a.skipped,
            reasons: Object.fromEntries(a.reasons),
          })),
        }),
        {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (action === "admin-offline-sakhi-report-latest") {
      const payload: AdminOfflineSakhiReportLatestRequest = await req.json();
      if (payload.userId !== "admin" || payload.password !== "admin@123") {
        return new Response(
          JSON.stringify({ success: false, message: "Invalid admin credentials" }),
          {
            status: 401,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }
      try {
        const q = await pool.query(
          `SELECT id, created_at, file_name, summary, csv_headers, results
           FROM offline_sakhi_reports
           ORDER BY created_at DESC
           LIMIT 1`
        );
        const row = q.rows?.[0];
        if (!row) {
          return new Response(
            JSON.stringify({ success: true, report: null }),
            {
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
              },
            }
          );
        }
        let resultsOut: unknown = row.results;
        if (Array.isArray(row.results) && row.results.length === 0) {
          try {
            const rq = await pool.query(
              `SELECT row_index, status, epic, mismatched_fields, csv, roll, extra_cells
               FROM offline_sakhi_report_rows
               WHERE report_id = $1
               ORDER BY row_index ASC`,
              [row.id]
            );
            resultsOut = rq.rows.map((r) => {
              const mf = r.mismatched_fields;
              const mismatchedFields = Array.isArray(mf) ? mf.map((x: unknown) => String(x)) : [];
              return {
                rowIndex: r.row_index,
                status: r.status,
                epic: r.epic,
                mismatchedFields,
                csv: r.csv,
                roll: r.roll,
                extraCells: r.extra_cells ?? undefined,
              };
            });
          } catch (e2) {
            const msg2 = e2 instanceof Error ? e2.message : String(e2);
            if (/relation "offline_sakhi_report_rows" does not exist/i.test(msg2)) {
              resultsOut = [];
            } else {
              throw e2;
            }
          }
        }
        return new Response(
          JSON.stringify({
            success: true,
            report: {
              id: row.id,
              savedAt: row.created_at,
              fileName: row.file_name,
              summary: row.summary,
              csvHeaders: row.csv_headers,
              results: resultsOut,
            },
          }),
          {
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/relation "offline_sakhi_reports" does not exist/i.test(msg)) {
          return new Response(
            JSON.stringify({ success: true, report: null, message: "Report table not created yet." }),
            {
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
              },
            }
          );
        }
        return new Response(
          JSON.stringify({ success: false, message: msg }),
          {
            status: 500,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }
    }

    if (action === "admin-offline-sakhi-report-clear") {
      const payload: AdminOfflineSakhiReportClearRequest = await req.json();
      if (payload.userId !== "admin" || payload.password !== "admin@123") {
        return new Response(
          JSON.stringify({ success: false, message: "Invalid admin credentials" }),
          {
            status: 401,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }
      try {
        await pool.query(`DELETE FROM offline_sakhi_reports`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return new Response(
          JSON.stringify({ success: false, message: msg }),
          {
            status: 500,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }
      return new Response(
        JSON.stringify({ success: true }),
        {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    if (action === "ocr-extract") {
      const { userId, password, imageUrl, imageBase64, docType }: OCRExtractRequest = await req.json();

      if (userId !== "admin" || password !== "admin@123") {
        return new Response(
          JSON.stringify({ success: false, message: "Invalid admin credentials" }),
          {
            status: 401,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }

      const serviceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
      if (serviceAccountKey) {
        try {
          const accessToken = await createGoogleAccessToken(serviceAccountKey);
          let imageContent = imageBase64 || "";
          if (!imageContent) {
            imageContent = await fetchImageAsBase64(imageUrl);
          }

          const visionResponse = await fetch("https://vision.googleapis.com/v1/images:annotate", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              requests: [
                {
                  image: { content: imageContent },
                  features: [{ type: "TEXT_DETECTION" }],
                },
              ],
            }),
          });

          const visionResult = await visionResponse.json();
          const extractedText =
            visionResult?.responses?.[0]?.fullTextAnnotation?.text ??
            visionResult?.responses?.[0]?.textAnnotations?.[0]?.description ??
            "";

          return new Response(
            JSON.stringify({
              success: visionResponse.ok,
              status: visionResponse.status,
              extractedText,
              docType: docType ?? "document",
              raw: visionResult,
              message: visionResponse.ok
                ? "OCR success"
                : visionResult?.error?.message || "Google Vision OCR failed",
            }),
            {
              status: visionResponse.ok ? 200 : 400,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
              },
            }
          );
        } catch (ocrError) {
          return new Response(
            JSON.stringify({
              success: false,
              message: ocrError instanceof Error ? ocrError.message : "Google Vision OCR failed",
            }),
            {
              status: 500,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
              },
            }
          );
        }
      }

      const ocrApiUrl = process.env.OCR_API_URL;
      const sessionSecret = process.env.SESSION_SECRET;
      if (!ocrApiUrl || !sessionSecret) {
        return new Response(
          JSON.stringify({
            success: false,
            message: "Set GOOGLE_SERVICE_ACCOUNT_KEY (recommended) or OCR_API_URL + SESSION_SECRET in function env",
          }),
          {
            status: 500,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }

      const ocrResponse = await fetch(ocrApiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "SESSION_SECRET": sessionSecret,
        },
        body: JSON.stringify({
          image_url: imageUrl,
          image_base64: imageBase64,
          doc_type: docType ?? "document",
        }),
      });

      const ocrResult = await ocrResponse.json();
      const extractedText =
        ocrResult?.text ??
        ocrResult?.extracted_text ??
        ocrResult?.data?.text ??
        ocrResult?.result?.text ??
        "";

      return new Response(
        JSON.stringify({
          success: ocrResponse.ok,
          status: ocrResponse.status,
          extractedText,
          raw: ocrResult,
          message: ocrResponse.ok ? "OCR success" : ocrResult?.message || "OCR failed",
        }),
        {
          status: ocrResponse.ok ? 200 : 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    if (action === "lookup-voter") {
      const payload: LookupVoterRequest = await req.json();
      const epic = payload.epic?.trim();
      if (!epic) {
        return new Response(
          JSON.stringify({ success: false, message: "EPIC / vcardid required" }),
          {
            status: 400,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }

      const epicNorm = epic.toUpperCase();
      const assembly = payload.assembly?.trim();

      // Security/UX rule: lookup must stay within the user's assigned assembly.
      // If assembly is provided, do a strict assembly filter in SQL.
      let rows: any[] = [];
      let lookupError: { message: string } | null = null;
      if (assembly) {
        try {
          const q = await pool.query(
            `SELECT *
             FROM voters
             WHERE upper(trim(vcardid)) = upper(trim($1))
               AND trim(e_assemblyname) = trim($2)
             LIMIT 100`,
            [epicNorm, assembly]
          );
          rows = q.rows ?? [];
        } catch (e) {
          lookupError = { message: e instanceof Error ? e.message : String(e) };
        }
      } else {
        const out = await supabase
          .from("voters")
          .select("*")
          .eq("vcardid", epicNorm)
          .limit(100);
        rows = out.data ?? [];
        lookupError = out.error ? { message: out.error.message } : null;
      }

      if (lookupError) {
        return new Response(
          JSON.stringify({ success: false, message: lookupError.message }),
          {
            status: 500,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }

      if (!rows?.length) {
        return new Response(
          JSON.stringify({ success: true, voter: null }),
          {
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }
      const voter = rows[0];

      // Search-time duplicate signal: if this EPIC already exists in submissions, return flag + booth.
      // EPIC is stored inside ocr_data[voter_lookup].text JSON as vcardid.
      const dupRes = await pool.query(
        `SELECT
           s.id,
           s.booth_number,
           (
             SELECT trim((elem->>'text')::jsonb->>'boothid')
             FROM jsonb_array_elements(coalesce(s.ocr_data, '[]'::jsonb)) AS elem
             WHERE elem->>'label' = 'voter_lookup'
             LIMIT 1
           ) AS lookup_booth
         FROM submissions s
         WHERE s.deleted_at IS NULL
           AND EXISTS (
             SELECT 1
             FROM jsonb_array_elements(coalesce(s.ocr_data, '[]'::jsonb)) AS elem
             WHERE elem->>'label' = 'voter_lookup'
               AND upper(trim((elem->>'text')::jsonb->>'vcardid')) = upper(trim($1))
           )
         ORDER BY s.created_at DESC
         LIMIT 1`,
        [epicNorm]
      );
      const dupRow = dupRes.rows?.[0];
      const alreadySubmitted = Boolean(dupRow);
      const submittedBooth = alreadySubmitted
        ? String(dupRow.lookup_booth ?? dupRow.booth_number ?? "").trim() || "—"
        : "";

      return new Response(
        JSON.stringify({ success: true, voter, alreadySubmitted, submittedBooth }),
        {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    type UserDataScope =
      | { kind: "admin" }
      | { kind: "district"; district: string }
      | { kind: "zone"; zone: string }
      /** All submissions in this assembly (e.g. field team lead) */
      | { kind: "assembly"; assembly: string }
      /** Block Coordinator / Block President: submit for one AC; list & stats = own only; assembly report = whole AC */
      | { kind: "assembly_block"; assembly: string }
      | { kind: "self" };

    /** Designation must include "block" and coordinator or president (Punjab block-level roles). */
    const isBlockLevelDesignation = (designationRaw: string, preferredAssembly: string): boolean => {
      if (!String(preferredAssembly ?? "").trim()) return false;
      const d = String(designationRaw ?? "")
        .trim()
        .toLowerCase();
      if (!d.includes("block")) return false;
      return (
        d.includes("coordinator") ||
        d.includes("co-ordinator") ||
        d.includes("president")
      );
    };

    const resolveUserDataScope = async (userId: string, isAdmin: boolean): Promise<UserDataScope> => {
      if (isAdmin) return { kind: "admin" };

      const { data: userRow } = await supabase
        .from("users")
        .select("preferred_assembly,is_verified,profile_data")
        .eq("id", userId)
        .maybeSingle();

      const preferredAssembly =
        typeof userRow?.preferred_assembly === "string" ? userRow.preferred_assembly.trim() : "";
      const profileData =
        userRow?.profile_data && typeof userRow.profile_data === "object"
          ? (userRow.profile_data as Record<string, unknown>)
          : {};
      const designation = String(profileData.Designation ?? profileData.designation ?? "")
        .trim()
        .toLowerCase();
      const compact = designation.replace(/\s+/g, "");
      const district = String(profileData.District ?? profileData.district ?? "").trim();
      const zone = String(profileData.Zone ?? profileData.zone ?? "").trim();
      const verified = userRow?.is_verified === true;

      if (!verified) return { kind: "self" };

      const isDistrictIncharge =
        compact.includes("districtincharge") ||
        designation.includes("district incharge") ||
        (/\bdistrict\b/.test(designation) && /\bincharge\b/.test(designation));
      const isZoneIncharge =
        !isDistrictIncharge &&
        (compact.includes("zoneincharge") ||
          designation.includes("zone incharge") ||
          (/\bzone\b/.test(designation) && /\bincharge\b/.test(designation)));

      if (isDistrictIncharge && district) {
        return { kind: "district", district };
      }
      if (isZoneIncharge && zone) {
        return { kind: "zone", zone };
      }

      if (
        isBlockLevelDesignation(String(profileData.Designation ?? profileData.designation ?? ""), preferredAssembly)
      ) {
        return { kind: "assembly_block", assembly: preferredAssembly };
      }

      if (preferredAssembly) return { kind: "assembly", assembly: preferredAssembly };

      return { kind: "self" };
    };

    const inchargePairExistsForZone = async (
      zone: string,
      district: string,
      assembly: string
    ): Promise<boolean> => {
      const r = await pool.query(
        `SELECT 1
         FROM users u
         WHERE lower(trim(coalesce(u.profile_data->>'Zone',''))) = lower(trim($1::text))
           AND lower(trim(coalesce(u.profile_data->>'District',''))) = lower(trim($2::text))
           AND lower(trim(coalesce(u.preferred_assembly, u.profile_data->>'AC Name', ''))) = lower(trim($3::text))
         LIMIT 1`,
        [zone, district, assembly]
      );
      return (r.rowCount ?? 0) > 0;
    };

    if (action === "create-submission") {
      const payload: CreateSubmissionRequest = await req.json();

      if (!payload?.userId) {
        return new Response(
          JSON.stringify({ success: false, message: "Missing userId" }),
          {
            status: 400,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }

      const userScope = await resolveUserDataScope(String(payload.userId), false);
      const payloadDistrict = String(payload.district ?? "").trim();
      const payloadAssembly = String(payload.assembly ?? "").trim();

      if (userScope.kind === "assembly" || userScope.kind === "assembly_block") {
        if (!payloadAssembly || payloadAssembly.toLowerCase() !== userScope.assembly.toLowerCase()) {
          return new Response(
            JSON.stringify({
              success: false,
              message: `You can submit only for your assigned assembly (${userScope.assembly}).`,
            }),
            {
              status: 403,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }
      } else if (userScope.kind === "district") {
        if (!payloadDistrict || payloadDistrict.toLowerCase() !== userScope.district.toLowerCase()) {
          return new Response(
            JSON.stringify({
              success: false,
              message: `You can submit only within your assigned district (${userScope.district}).`,
            }),
            {
              status: 403,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }
      } else if (userScope.kind === "zone") {
        const ok = await inchargePairExistsForZone(
          userScope.zone,
          payloadDistrict,
          payloadAssembly
        );
        if (!ok) {
          return new Response(
            JSON.stringify({
              success: false,
              message: `Submission is not allowed for this district/assembly under your zone (${userScope.zone}).`,
            }),
            {
              status: 403,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }
      }

      const extractVoterLookupFromOcr = (
        ocrData: unknown
      ): { vcardid: string; boothid: string } => {
        if (!Array.isArray(ocrData)) return { vcardid: "", boothid: "" };
        const item = (ocrData as any[]).find((x) => x?.label === "voter_lookup");
        const text = item?.text;
        if (!text || typeof text !== "string") return { vcardid: "", boothid: "" };
        try {
          const parsed = JSON.parse(text);
          const vcardid = String(parsed?.vcardid ?? "").trim().toUpperCase();
          const boothid = String(parsed?.boothid ?? "").trim();
          return { vcardid, boothid };
        } catch {
          return { vcardid: "", boothid: "" };
        }
      };

      const mobileNorm = String(payload.sakhi_mobile ?? "")
        .replace(/\D/g, "")
        .slice(0, 10);
      const mobileErr = validateIndianMobile10Edge(mobileNorm);
      if (mobileErr) {
        return new Response(JSON.stringify({ success: false, message: mobileErr }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const aadhaarDigits = String(payload.aadhaar_number ?? "")
        .replace(/\D/g, "")
        .slice(0, 12);
      const aadhaarErr = validateAadhaar12Edge(aadhaarDigits);
      if (aadhaarErr) {
        return new Response(JSON.stringify({ success: false, message: aadhaarErr }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const aRaw = String(payload.documents_collected_aadhaar ?? "").trim().toLowerCase();
      const vRaw = String(payload.documents_collected_voter ?? "").trim().toLowerCase();
      const legacyRaw = String(payload.documents_collected_consent ?? "").trim().toLowerCase();

      let consentAadhaar: "yes" | "no";
      let consentVoter: "yes" | "no";
      if (aRaw || vRaw) {
        if (
          !aRaw ||
          !vRaw ||
          (aRaw !== "yes" && aRaw !== "no") ||
          (vRaw !== "yes" && vRaw !== "no")
        ) {
          return new Response(
            JSON.stringify({
              success: false,
              message:
                "Please select Yes or No for both: Aadhaar card collected in person, and Voter ID card collected in person.",
            }),
            {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }
        consentAadhaar = aRaw as "yes" | "no";
        consentVoter = vRaw as "yes" | "no";
      } else if (legacyRaw === "yes" || legacyRaw === "no") {
        consentAadhaar = legacyRaw as "yes" | "no";
        consentVoter = legacyRaw as "yes" | "no";
      } else {
        return new Response(
          JSON.stringify({
            success: false,
            message:
              "Please select Yes or No for physical collection of Aadhaar card and Voter ID card.",
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      if (consentAadhaar !== "yes" || consentVoter !== "yes") {
        return new Response(
          JSON.stringify({
            success: false,
            message:
              'Submission is only allowed when both are "Yes" — Aadhaar and Voter ID must have been collected in person.',
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const submittedWithEpic = payload.submitted_with_epic !== false;

      const { vcardid: epicNorm, boothid: epicBoothid } = extractVoterLookupFromOcr(payload.ocr_data);
      const ocrBooth = String(epicBoothid ?? "").trim();
      if (!submittedWithEpic && !ocrBooth) {
        return new Response(
          JSON.stringify({
            success: false,
            message: "Booth No. is required in Without EPIC mode.",
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      const requestedBooth = String(payload.booth_number ?? epicBoothid ?? "").trim() || "—";

      const { data: mobileTaken, error: rpcDupErr } = await supabase.rpc("submission_mobile_taken", {
        p_ten_digits: mobileNorm,
      });

      const mobileTakenBool =
        mobileTaken === true ||
        mobileTaken === "true" ||
        mobileTaken === "t" ||
        mobileTaken === "1" ||
        mobileTaken === 1;

      if (!rpcDupErr && mobileTakenBool) {
        const { data: existingRow } = await supabase
          .from("submissions")
          .select("id, booth_number")
          .eq("sakhi_mobile", mobileNorm)
          .is("deleted_at", null)
          .limit(1)
          .maybeSingle();

        return new Response(
          JSON.stringify({
            success: false,
            message: `A submission already exists for this mobile number (Booth: ${
              String((existingRow as any)?.booth_number ?? requestedBooth).trim() || "—"
            }). Please use a different number.`,
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      if (rpcDupErr) {
        const { data: existingRow } = await supabase
          .from("submissions")
          .select("id, booth_number")
          .eq("sakhi_mobile", mobileNorm)
          .is("deleted_at", null)
          .maybeSingle();
        if (existingRow) {
          return new Response(
            JSON.stringify({
              success: false,
              message: `A submission already exists for this mobile number (Booth: ${
                String((existingRow as any)?.booth_number ?? requestedBooth).trim() || "—"
              }). Please use a different number.`,
            }),
            {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        }
      }

      // Block duplicate submissions by voter id (EPIC / vcardid), derived from OCR voter_lookup.
      // This prevents the same EPIC from being submitted twice.
      if (epicNorm) {
        const { data: recentSubs } = await supabase
          .from("submissions")
          .select("id, booth_number, ocr_data")
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(500);

        if (Array.isArray(recentSubs)) {
          for (const s of recentSubs) {
            const ex = extractVoterLookupFromOcr((s as any).ocr_data);
            const exEpic = ex.vcardid;
            if (exEpic && exEpic === epicNorm) {
              const existingBooth = String((s as any).booth_number ?? "—").trim() || "—";
              console.error("Duplicate EPIC submission blocked", {
                epic: epicNorm,
                mobile: mobileNorm,
                requestedBooth,
                existingBooth,
              });

              return new Response(
                JSON.stringify({
                  success: false,
                  message: `A submission already exists for this EPIC / Voter ID (Booth: ${existingBooth}).`,
                }),
                {
                  status: 400,
                  headers: { ...corsHeaders, "Content-Type": "application/json" },
                }
              );
            }
          }
        }
      }

      const { error: insertError, data } = await supabase
        .from("submissions")
        .insert({
          user_id: payload.userId,
          sakhi_name: payload.sakhi_name,
          sakhi_mobile: mobileNorm,
          father_name: payload.father_name,
          husband_name: payload.husband_name,
          state: payload.state,
          district: payload.district,
          assembly: payload.assembly,
          halka: payload.halka,
          village: payload.village,
          booth_number: payload.booth_number ?? "",
          aadhaar_front_url: payload.aadhaar_front_url ?? null,
          aadhaar_back_url: payload.aadhaar_back_url ?? null,
          voter_id_url: payload.voter_id_url ?? null,
          live_photo_url: payload.live_photo_url ?? null,
          ocr_data: payload.ocr_data ?? null,
          documents_collected_consent: "yes",
          documents_collected_aadhaar: consentAadhaar,
          documents_collected_voter: consentVoter,
          submitted_with_epic: submittedWithEpic,
        })
        .select("id")
        .single();

      if (insertError) {
        const missingSplit =
          /documents_collected_aadhaar|documents_collected_voter|column .* does not exist/i.test(
            String(insertError.message ?? "")
          );
        if (missingSplit) {
          const { error: insertError2, data: data2 } = await supabase
            .from("submissions")
            .insert({
              user_id: payload.userId,
              sakhi_name: payload.sakhi_name,
              sakhi_mobile: mobileNorm,
              father_name: payload.father_name,
              husband_name: payload.husband_name,
              state: payload.state,
              district: payload.district,
              assembly: payload.assembly,
              halka: payload.halka,
              village: payload.village,
              booth_number: payload.booth_number ?? "",
              aadhaar_front_url: payload.aadhaar_front_url ?? null,
              aadhaar_back_url: payload.aadhaar_back_url ?? null,
              voter_id_url: payload.voter_id_url ?? null,
              live_photo_url: payload.live_photo_url ?? null,
              ocr_data: payload.ocr_data ?? null,
              documents_collected_consent: "yes",
              submitted_with_epic: submittedWithEpic,
            })
            .select("id")
            .single();
          if (insertError2) {
            return new Response(
              JSON.stringify({ success: false, message: insertError2.message }),
              {
                status: 400,
                headers: {
                  ...corsHeaders,
                  "Content-Type": "application/json",
                },
              }
            );
          }
          return new Response(
            JSON.stringify({ success: true, id: data2?.id }),
            {
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
              },
            }
          );
        }
        return new Response(
          JSON.stringify({ success: false, message: insertError.message }),
          {
            status: 400,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }

      return new Response(
        JSON.stringify({ success: true, id: data?.id }),
        {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    if (action === "user-submissions") {
      const { userId }: UserSubmissionsRequest = await req.json();

      if (!userId) {
        return new Response(
          JSON.stringify({ success: false, message: "Missing userId" }),
          {
            status: 400,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }

      const scope = await resolveUserDataScope(String(userId), false);

      if (scope.kind === "zone") {
        const zr = await pool.query(
          `SELECT s.*
           FROM submissions s
           WHERE s.deleted_at IS NULL
             AND EXISTS (
               SELECT 1
               FROM users u
               WHERE lower(trim(coalesce(u.profile_data->>'Zone',''))) = lower(trim($1::text))
                 AND lower(trim(s.district)) = lower(trim(coalesce(u.profile_data->>'District','')))
                 AND lower(trim(s.assembly)) = lower(trim(coalesce(u.preferred_assembly, u.profile_data->>'AC Name','')))
             )
           ORDER BY s.created_at DESC`,
          [scope.zone]
        );
        return new Response(
          JSON.stringify({ success: true, submissions: zr.rows ?? [] }),
          {
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }

      const submissionsQuery = supabase
        .from("submissions")
        .select("*")
        .is("deleted_at", null);

      const { data, error } =
        scope.kind === "district"
          ? await submissionsQuery.eq("district", scope.district).order("created_at", { ascending: false })
          : scope.kind === "assembly_block"
            ? await submissionsQuery
                .eq("user_id", userId)
                .eq("assembly", scope.assembly)
                .order("created_at", { ascending: false })
          : scope.kind === "assembly"
            ? await submissionsQuery.eq("assembly", scope.assembly).order("created_at", { ascending: false })
            : await submissionsQuery.eq("user_id", userId).order("created_at", { ascending: false });

      if (error) {
        return new Response(
          JSON.stringify({ success: false, message: error.message }),
          {
            status: 400,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }

      return new Response(
        JSON.stringify({ success: true, submissions: data || [] }),
        {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    if (action === "submission-stats") {
      const payload: SubmissionStatsRequest = await req.json();
      const userId = payload.userId;

      if (!userId) {
        return new Response(
          JSON.stringify({ success: false, message: "Missing userId" }),
          {
            status: 400,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }

      const isAdmin = userId === "admin" && payload.password === "admin@123";
      const scope = await resolveUserDataScope(String(userId), isAdmin);

      const totalRes = isAdmin
        ? await pool.query(`SELECT COUNT(*)::bigint AS total FROM submissions WHERE deleted_at IS NULL`)
        : await (async () => {
            if (scope.kind === "district") {
              return pool.query(
                `SELECT COUNT(*)::bigint AS total
                 FROM submissions
                 WHERE deleted_at IS NULL AND trim(district) = trim($1)`,
                [scope.district]
              );
            }
            if (scope.kind === "zone") {
              return pool.query(
                `SELECT COUNT(*)::bigint AS total
                 FROM submissions s
                 WHERE s.deleted_at IS NULL
                   AND EXISTS (
                     SELECT 1
                     FROM users u
                     WHERE lower(trim(coalesce(u.profile_data->>'Zone',''))) = lower(trim($1::text))
                       AND lower(trim(s.district)) = lower(trim(coalesce(u.profile_data->>'District','')))
                       AND lower(trim(s.assembly)) = lower(trim(coalesce(u.preferred_assembly, u.profile_data->>'AC Name','')))
                   )`,
                [scope.zone]
              );
            }
            if (scope.kind === "assembly_block") {
              return pool.query(
                `SELECT COUNT(*)::bigint AS total FROM submissions WHERE deleted_at IS NULL AND user_id = $1`,
                [userId]
              );
            }
            if (scope.kind === "assembly") {
              return pool.query(
                  `SELECT COUNT(*)::bigint AS total
                   FROM submissions
                   WHERE deleted_at IS NULL AND trim(assembly) = trim($1)`,
                  [scope.assembly]
                );
            }
            return pool.query(`SELECT COUNT(*)::bigint AS total FROM submissions WHERE deleted_at IS NULL AND user_id = $1`, [
              userId,
            ]);
          })();

      const assemblyWiseRes = isAdmin
        ? await pool.query(
            `SELECT trim(assembly) AS assembly, COUNT(*)::bigint AS count
             FROM submissions
             WHERE deleted_at IS NULL
               AND assembly IS NOT NULL
               AND btrim(assembly) <> ''
             GROUP BY trim(assembly)
             ORDER BY trim(assembly)`
          )
        : await (async () => {
            if (scope.kind === "district") {
              return pool.query(
                `SELECT trim(assembly) AS assembly, COUNT(*)::bigint AS count
                 FROM submissions
                 WHERE deleted_at IS NULL
                   AND district IS NOT NULL
                   AND btrim(district) <> ''
                   AND trim(district) = trim($1)
                   AND assembly IS NOT NULL
                   AND btrim(assembly) <> ''
                 GROUP BY trim(assembly)
                 ORDER BY trim(assembly)`,
                [scope.district]
              );
            }
            if (scope.kind === "zone") {
              return pool.query(
                `SELECT trim(s.assembly) AS assembly, COUNT(*)::bigint AS count
                 FROM submissions s
                 WHERE s.deleted_at IS NULL
                   AND s.assembly IS NOT NULL
                   AND btrim(s.assembly) <> ''
                   AND EXISTS (
                     SELECT 1
                     FROM users u
                     WHERE lower(trim(coalesce(u.profile_data->>'Zone',''))) = lower(trim($1::text))
                       AND lower(trim(s.district)) = lower(trim(coalesce(u.profile_data->>'District','')))
                       AND lower(trim(s.assembly)) = lower(trim(coalesce(u.preferred_assembly, u.profile_data->>'AC Name','')))
                   )
                 GROUP BY trim(s.assembly)
                 ORDER BY trim(s.assembly)`,
                [scope.zone]
              );
            }
            if (scope.kind === "assembly_block") {
              return pool.query(
                `SELECT trim(assembly) AS assembly, COUNT(*)::bigint AS count
                 FROM submissions
                 WHERE deleted_at IS NULL
                   AND user_id = $1
                   AND assembly IS NOT NULL
                   AND btrim(assembly) <> ''
                 GROUP BY trim(assembly)
                 ORDER BY trim(assembly)`,
                [userId]
              );
            }
            if (scope.kind === "assembly") {
              return pool.query(
                  `SELECT trim(assembly) AS assembly, COUNT(*)::bigint AS count
                   FROM submissions
                   WHERE deleted_at IS NULL
                     AND assembly IS NOT NULL
                     AND btrim(assembly) <> ''
                     AND trim(assembly) = trim($1)
                   GROUP BY trim(assembly)
                   ORDER BY trim(assembly)`,
                  [scope.assembly]
                );
            }
            return pool.query(
              `SELECT trim(assembly) AS assembly, COUNT(*)::bigint AS count
               FROM submissions
               WHERE deleted_at IS NULL
                 AND user_id = $1
                 AND assembly IS NOT NULL
                 AND btrim(assembly) <> ''
               GROUP BY trim(assembly)
               ORDER BY trim(assembly)`,
              [userId]
            );
          })();

      const total = Number(totalRes.rows?.[0]?.total ?? 0);
      const assemblyWise = (assemblyWiseRes.rows ?? []).map((r: any) => ({
        assembly: String(r.assembly ?? ""),
        count: Number(r.count ?? 0),
      }));

      return new Response(
        JSON.stringify({ success: true, total, assemblyWise }),
        {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    if (action === "assembly-report") {
      const payload: AssemblyReportRequest = await req.json();
      const userId = String(payload?.userId ?? "").trim();
      if (!userId) {
        return new Response(
          JSON.stringify({ success: false, message: "Missing userId" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const scope = await resolveUserDataScope(userId, false);

      if (scope.kind === "self") {
        return new Response(
          JSON.stringify({
            success: false,
            message: "Assembly, district, or zone access is not configured for this user.",
          }),
          {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      if (scope.kind === "district" || scope.kind === "zone") {
        const scopeLabel = scope.kind === "district" ? scope.district : scope.zone;
        const r = await pool.query(
          `WITH pairs AS (
             SELECT DISTINCT
               trim(COALESCE(u.profile_data->>'District', '')) AS district,
               trim(COALESCE(u.preferred_assembly, u.profile_data->>'AC Name', '')) AS assembly
             FROM users u
             WHERE u.profile_data IS NOT NULL
               AND trim(COALESCE(u.preferred_assembly, u.profile_data->>'AC Name', '')) <> ''
               AND ${
                 scope.kind === "district"
                   ? `lower(trim(COALESCE(u.profile_data->>'District', ''))) = lower(trim($1::text))`
                   : `lower(trim(COALESCE(u.profile_data->>'Zone', ''))) = lower(trim($1::text))`
               }
           )
           SELECT
             p.district,
             p.assembly,
             COALESCE(m.booth_count, 0)::bigint AS total_booths,
             COALESCE(m.vote_count, 0)::bigint AS total_votes,
             ROUND(COALESCE(m.vote_count, 0)::numeric / 100.0, 0)::bigint AS required_sakhi,
             COALESCE(sa.added_sakhi, 0)::bigint AS added_sakhi
           FROM pairs p
           LEFT JOIN mv_voter_assembly_summary m ON lower(trim(m.assembly)) = lower(trim(p.assembly))
           LEFT JOIN (
             SELECT
               trim(district) AS d,
               trim(assembly) AS a,
               COUNT(*)::bigint AS added_sakhi
             FROM submissions
             WHERE deleted_at IS NULL
             GROUP BY trim(district), trim(assembly)
           ) sa ON lower(trim(sa.d)) = lower(trim(p.district))
             AND lower(trim(sa.a)) = lower(trim(p.assembly))
           ORDER BY p.district, p.assembly`,
          [scopeLabel]
        );

        return new Response(
          JSON.stringify({
            success: true,
            scope: scope.kind,
            district: scope.kind === "district" ? scope.district : undefined,
            zone: scope.kind === "zone" ? scope.zone : undefined,
            rows: r.rows ?? [],
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      if (scope.kind !== "assembly" && scope.kind !== "assembly_block") {
        return new Response(
          JSON.stringify({ success: false, message: "Report not available for this account." }),
          {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const assembly = scope.assembly;
      // Assembly / block-level: booth-wise report for the whole AC (all users' submissions).
      const boothWiseRes = await pool.query(
        `WITH voter_booth AS (
           SELECT
             trim(boothid) AS booth_no,
             COUNT(
               DISTINCT
               CASE
                 WHEN btrim(coalesce(vcardid, '')) <> '' THEN 'epic:' || upper(trim(vcardid))
                 WHEN btrim(coalesce(srno, '')) <> '' THEN 'srno:' || trim(srno)
                 ELSE NULL
               END
             )::bigint AS no_of_voter
           FROM voters
           WHERE btrim(coalesce(e_assemblyname, '')) <> ''
             AND trim(e_assemblyname) = trim($1)
             AND btrim(coalesce(boothid, '')) <> ''
           GROUP BY trim(boothid)
         ),
         submission_booth AS (
           SELECT
             COALESCE(
               NULLIF(trim(s.booth_number), ''),
               NULLIF(
                 trim((
                   SELECT (elem->>'text')::jsonb->>'boothid'
                   FROM jsonb_array_elements(coalesce(s.ocr_data, '[]'::jsonb)) AS elem
                   WHERE elem->>'label' = 'voter_lookup'
                   LIMIT 1
                 )),
                 ''
               )
             ) AS booth_no,
             COUNT(*)::bigint AS no_of_sakhi_added
           FROM submissions s
           WHERE s.deleted_at IS NULL
             AND btrim(coalesce(s.assembly, '')) <> ''
             AND trim(s.assembly) = trim($1)
           GROUP BY 1
         ),
         merged AS (
           SELECT
             COALESCE(v.booth_no, s.booth_no) AS booth_no,
             COALESCE(v.no_of_voter, 0)::bigint AS no_of_voter,
             COALESCE(s.no_of_sakhi_added, 0)::bigint AS no_of_sakhi_added
           FROM voter_booth v
           FULL OUTER JOIN submission_booth s
             ON lower(v.booth_no) = lower(s.booth_no)
         )
         SELECT
           booth_no,
           no_of_voter,
           CASE
             WHEN COALESCE(no_of_voter, 0) <= 0 THEN 0::bigint
             ELSE GREATEST(1, ROUND(no_of_voter::numeric / 100.0, 0))::bigint
           END AS no_of_sakhi_required,
           no_of_sakhi_added
         FROM merged
         WHERE btrim(coalesce(booth_no, '')) <> ''
         ORDER BY booth_no`,
        [assembly]
      );

      const boothWise = (boothWiseRes.rows ?? []).map((r: any) => ({
        booth_no: String(r.booth_no ?? ""),
        no_of_voter: Number(r.no_of_voter ?? 0),
        no_of_sakhi_required: Number(r.no_of_sakhi_required ?? 0),
        no_of_sakhi_added: Number(r.no_of_sakhi_added ?? 0),
      }));

      const summary = {
        assembly_name: assembly,
        no_of_booth: boothWise.length,
        voters: boothWise.reduce((n, b) => n + b.no_of_voter, 0),
        no_of_sakhi_added: boothWise.reduce((n, b) => n + b.no_of_sakhi_added, 0),
      };

      return new Response(
        JSON.stringify({ success: true, summary, boothWise }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (action === "location-submission-count") {
      const payload: LocationCountRequest = await req.json();
      const { state, district, assembly, halka, village } = payload;

      const { count, error } = await supabase
        .from("submissions")
        .select("*", { count: "exact", head: true })
        .eq("state", state)
        .eq("district", district)
        .eq("assembly", assembly)
        .eq("halka", halka)
        .eq("village", village)
        .is("deleted_at", null);

      if (error) {
        return new Response(
          JSON.stringify({ success: false, message: error.message }),
          {
            status: 400,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }

      return new Response(
        JSON.stringify({ success: true, count: count || 0 }),
        {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    if (action === "soft-delete-submission") {
      const payload: SoftDeleteSubmissionRequest = await req.json();
      if (!payload?.submissionId || !payload?.userId) {
        return new Response(JSON.stringify({ success: false, message: "Missing submissionId or userId" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const isAdmin = payload.userId === "admin" && payload.password === "admin@123";
      const { data: row, error: fetchErr } = await supabase
        .from("submissions")
        .select("id, user_id, deleted_at")
        .eq("id", payload.submissionId)
        .maybeSingle();
      if (fetchErr || !row) {
        return new Response(JSON.stringify({ success: false, message: "Submission not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (row.deleted_at) {
        return new Response(JSON.stringify({ success: false, message: "Already removed" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!isAdmin && row.user_id !== payload.userId) {
        return new Response(JSON.stringify({ success: false, message: "Not allowed" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { error: upErr } = await supabase
        .from("submissions")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", payload.submissionId);
      if (upErr) {
        return new Response(JSON.stringify({ success: false, message: upErr.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "update-submission") {
      const payload: UpdateSubmissionRequest = await req.json();
      if (!payload?.submissionId || !payload?.userId) {
        return new Response(JSON.stringify({ success: false, message: "Missing submissionId or userId" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const isAdmin = payload.userId === "admin" && payload.password === "admin@123";
      const { data: row, error: fetchErr } = await supabase
        .from("submissions")
        .select("*")
        .eq("id", payload.submissionId)
        .maybeSingle();
      if (fetchErr || !row) {
        return new Response(JSON.stringify({ success: false, message: "Submission not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (row.deleted_at) {
        return new Response(JSON.stringify({ success: false, message: "Cannot edit removed submission" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!isAdmin && row.user_id !== payload.userId) {
        return new Response(JSON.stringify({ success: false, message: "Not allowed" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!isAdmin) {
        if (payload.voter_lookup === undefined || payload.voter_lookup === null || typeof payload.voter_lookup !== "object") {
          return new Response(
            JSON.stringify({
              success: false,
              message:
                "Only EPIC / voter roll fields can be updated. Send voter_lookup with the roll fields to change.",
            }),
            {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }
        const nextOcr = mergeVoterLookupIntoOcr(row.ocr_data, payload.voter_lookup as Record<string, unknown>);
        const { error: upUserErr } = await supabase
          .from("submissions")
          .update({
            ocr_data: nextOcr,
            updated_at: new Date().toISOString(),
          })
          .eq("id", payload.submissionId);
        if (upUserErr) {
          return new Response(JSON.stringify({ success: false, message: upUserErr.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (payload.sakhi_name !== undefined) updates.sakhi_name = String(payload.sakhi_name).trim();
      if (payload.father_name !== undefined) updates.father_name = String(payload.father_name).trim();
      if (payload.husband_name !== undefined) updates.husband_name = String(payload.husband_name).trim();
      if (payload.state !== undefined) updates.state = String(payload.state).trim();
      if (payload.district !== undefined) updates.district = String(payload.district).trim();
      if (payload.assembly !== undefined) updates.assembly = String(payload.assembly).trim();
      if (payload.halka !== undefined) updates.halka = String(payload.halka).trim();
      if (payload.village !== undefined) updates.village = String(payload.village).trim();
      if (payload.booth_number !== undefined) updates.booth_number = String(payload.booth_number).trim();

      if (payload.sakhi_mobile !== undefined) {
        const mobileNorm = String(payload.sakhi_mobile).replace(/\D/g, "").slice(0, 10);
        const mobileErr = validateIndianMobile10Edge(mobileNorm);
        if (mobileErr) {
          return new Response(JSON.stringify({ success: false, message: mobileErr }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const { data: dup } = await supabase
          .from("submissions")
          .select("id")
          .eq("sakhi_mobile", mobileNorm)
          .neq("id", payload.submissionId)
          .is("deleted_at", null)
          .maybeSingle();
        if (dup) {
          return new Response(
            JSON.stringify({
              success: false,
              message: "A submission already exists for this mobile number.",
            }),
            {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }
        updates.sakhi_mobile = mobileNorm;
      }

      if (isAdmin && payload.status !== undefined && String(payload.status).trim() !== "") {
        updates.status = String(payload.status).trim();
      }

      const { error: upErr } = await supabase.from("submissions").update(updates).eq("id", payload.submissionId);
      if (upErr) {
        return new Response(JSON.stringify({ success: false, message: upErr.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "list-locations") {
      const body = await req.json().catch(() => ({}));
      const preferredAssembly =
        typeof body?.preferred_assembly === "string" ? body.preferred_assembly.trim() : "";
      const userId = typeof body?.userId === "string" ? body.userId.trim() : "";
      const pageSize = Math.min(Math.max(Number(body?.pageSize) || 1000, 1), 5000);
      const from = Math.max(Number(body?.from) || 0, 0);

      let q = supabase
        .from("locations")
        .select("state, district, assembly, halka, village, booth_number")
        .range(from, from + pageSize - 1);

      if (preferredAssembly) {
        q = q.eq("assembly", preferredAssembly);
      } else if (userId) {
        const scope = await resolveUserDataScope(userId, false);
        if (scope.kind === "zone") {
          const zr = await pool.query(
            `SELECT l.state, l.district, l.assembly, l.halka, l.village, l.booth_number
             FROM locations l
             INNER JOIN (
               SELECT DISTINCT
                 trim(COALESCE(u.profile_data->>'District', '')) AS district,
                 trim(COALESCE(u.preferred_assembly, u.profile_data->>'AC Name', '')) AS assembly
               FROM users u
               WHERE u.profile_data IS NOT NULL
                 AND trim(COALESCE(u.preferred_assembly, u.profile_data->>'AC Name', '')) <> ''
                 AND lower(trim(COALESCE(u.profile_data->>'Zone', ''))) = lower(trim($1::text))
             ) p ON lower(trim(l.district)) = lower(trim(p.district))
               AND lower(trim(l.assembly)) = lower(trim(p.assembly))
             ORDER BY l.district, l.assembly, l.halka, l.village
             LIMIT $2 OFFSET $3`,
            [scope.zone, pageSize, from]
          );
          return new Response(JSON.stringify({ success: true, data: zr.rows ?? [] }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (scope.kind === "assembly" || scope.kind === "assembly_block") q = q.eq("assembly", scope.assembly);
        if (scope.kind === "district") q = q.eq("district", scope.district);
      }

      const { data, error } = await q;
      if (error) {
        return new Response(JSON.stringify({ success: false, message: error.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ success: true, data: data ?? [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "list-assemblies") {
      const r = await pool.query(
        `SELECT DISTINCT assembly FROM locations WHERE assembly IS NOT NULL AND trim(assembly) <> '' ORDER BY assembly`
      );
      const assemblies = r.rows.map((row) => row.assembly as string);
      return new Response(JSON.stringify({ success: true, assemblies }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "admin-incharge-facets") {
      const body = await req.json().catch(() => ({}));
      if (body?.userId !== "admin" || body?.password !== "admin@123") {
        return new Response(
          JSON.stringify({ success: false, message: "Invalid admin credentials" }),
          {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      const q = (sql: string) => pool.query(sql);
      const [zonesR, distR, asmR, halkaR, villR] = await Promise.all([
        q(
          `SELECT DISTINCT trim(state) AS v FROM locations WHERE state IS NOT NULL AND btrim(state::text) <> '' ORDER BY 1`
        ),
        q(
          `SELECT DISTINCT trim(district) AS v FROM locations WHERE district IS NOT NULL AND btrim(district::text) <> '' ORDER BY 1`
        ),
        q(
          `SELECT DISTINCT trim(assembly) AS v FROM locations WHERE assembly IS NOT NULL AND btrim(assembly::text) <> '' ORDER BY 1`
        ),
        q(
          `SELECT DISTINCT trim(halka) AS v FROM locations WHERE halka IS NOT NULL AND btrim(halka::text) <> '' ORDER BY 1 LIMIT 8000`
        ),
        q(
          `SELECT DISTINCT trim(village) AS v FROM locations WHERE village IS NOT NULL AND btrim(village::text) <> '' ORDER BY 1 LIMIT 12000`
        ),
      ]);
      const mapV = (rows: { v: string }[]) => rows.map((r) => String(r.v ?? "").trim()).filter(Boolean);
      return new Response(
        JSON.stringify({
          success: true,
          zones: mapV(zonesR.rows as { v: string }[]),
          districts: mapV(distR.rows as { v: string }[]),
          assemblies: mapV(asmR.rows as { v: string }[]),
          halkas: mapV(halkaR.rows as { v: string }[]),
          villages: mapV(villR.rows as { v: string }[]),
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({ success: false, message: "Invalid action" }),
      {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ success: false, message: msg }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }
}
