import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

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
  documents_collected_consent?: string | null;
  documents_collected_aadhaar?: string | null;
  documents_collected_voter?: string | null;
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
    (x: { label?: string }) => x && typeof x === "object" && x.label === "voter_lookup"
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

function normEpicOffline(s: unknown): string {
  return String(s ?? "").replace(/\s/g, "").toUpperCase();
}

function normTextOffline(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
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
  const a = String(csvBooth ?? "").replace(/\D/g, "");
  const b = String(dbBooth ?? "").replace(/\D/g, "");
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

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

      return new Response(
        JSON.stringify({ success: true, otp, message: "OTP sent successfully" }),
        {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
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

      return new Response(
        JSON.stringify({ success: true, otp, message: "OTP sent successfully" }),
        {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
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

      return new Response(
        JSON.stringify({ success: true, user, message: "OTP verified successfully" }),
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

      const { data, error } = await supabase
        .from("submissions")
        .select(
          `
          id,
          user_id,
          sakhi_name,
          sakhi_mobile,
          father_name,
          husband_name,
          state,
          district,
          assembly,
          halka,
          village,
          booth_number,
          aadhaar_front_url,
          aadhaar_back_url,
          voter_id_url,
          live_photo_url,
          ocr_data,
          status,
          created_at,
          source_name,
          documents_collected_consent,
          documents_collected_aadhaar,
          documents_collected_voter,
          submitted_with_epic,
          users:user_id (
            name,
            mobile,
            profile_data
          )
        `
        )
        .is("deleted_at", null)
        .order("created_at", { ascending: false });

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

      const submissions = (data || []).map((item: any) => {
        const pd = item.users?.profile_data as Record<string, unknown> | null | undefined;
        const wingRaw = pd
          ? String(
              (pd["Wing Name"] || pd["Wing"] || pd.wing || "") as string
            ).trim()
          : "";
        return {
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
          user_name: item.users?.name ?? null,
          user_mobile: item.users?.mobile ?? null,
          submitter_wing: wingRaw || null,
        };
      });

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

      const skippedNoEpic = rows.reduce((n, row) => {
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
            message: "No valid voter rows: har row me EPIC (vcardid) zaroori hai.",
            skippedNoEpic,
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

      /** Same chunk me duplicate EPIC ek hi baar insert (last row wins) */
      const epicToRow = new Map<string, VoterRow>();
      for (const row of mapped) {
        epicToRow.set(row.vcardid, row);
      }
      const dedupedRows = [...epicToRow.values()];
      const skippedDuplicateInChunk = mapped.length - dedupedRows.length;

      let insertedNew = 0;
      const { data: rpcInserted, error: rpcChunkErr } = await supabase.rpc("admin_voters_upsert_chunk", {
        p_rows: dedupedRows,
      });

      if (!rpcChunkErr && rpcInserted !== null && rpcInserted !== undefined) {
        insertedNew = Number(rpcInserted);
      } else {
        const { data: insertedRows, error: upsertError } = await supabase
          .from("voters")
          .upsert(dedupedRows, { onConflict: "vcardid", ignoreDuplicates: true })
          .select("id");

        if (upsertError) {
          const hint =
            String(upsertError.message).includes("unique or exclusion constraint") ||
            String(upsertError.message).includes("ON CONFLICT")
              ? " Database me voters.vcardid par UNIQUE index zaroori hai — latest migration apply karein (idx_voters_vcardid)."
              : "";
          const rpcHint = rpcChunkErr
            ? ` RPC: ${rpcChunkErr.message}.`
            : "";
          return new Response(
            JSON.stringify({ success: false, message: upsertError.message + hint + rpcHint }),
            {
              status: 500,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
              },
            }
          );
        }
        insertedNew = Array.isArray(insertedRows) ? insertedRows.length : 0;
      }

      const skippedDuplicateEpic = Math.max(0, dedupedRows.length - insertedNew);

      return new Response(
        JSON.stringify({
          success: true,
          submittedWithEpic: mapped.length,
          dedupedInChunk: dedupedRows.length,
          insertedNew,
          skippedNoEpic,
          skippedDuplicateInChunk,
          skippedDuplicateEpic,
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

      const { data: existingUser } = await supabase
        .from("users")
        .select("id")
        .eq("mobile", payload.mobile)
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
          .eq("mobile", payload.mobile);

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
          mobile: payload.mobile,
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

      const mobileToRow = new Map<string, (typeof payload.users)[number]>();
      for (const row of payload.users) {
        const mobile = String(row?.mobile ?? "").replace(/\D/g, "").slice(0, 10);
        if (!mobile) continue;
        mobileToRow.set(mobile, { ...row, mobile });
      }
      const dedupedByMobile = Math.max(0, payload.users.length - mobileToRow.size);

      const validRows = [...mobileToRow.values()].filter(
        (r) =>
          String(r.name ?? "").trim() &&
          r.mobile &&
          String(r.preferred_assembly ?? "").trim()
      );

      if (validRows.length === 0) {
        return new Response(JSON.stringify({ success: true, created: 0, updated: 0, dedupedByMobile }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const mobiles = validRows.map((r) => r.mobile);
      const { data: existingRows } = await supabase.from("users").select("mobile").in("mobile", mobiles);
      const existingSet = new Set((existingRows ?? []).map((r: { mobile: string }) => r.mobile));
      const created = validRows.filter((r) => !existingSet.has(r.mobile)).length;
      const updated = validRows.filter((r) => existingSet.has(r.mobile)).length;

      const upsertPayload = validRows.map((r) => ({
        name: String(r.name).trim(),
        mobile: r.mobile,
        preferred_assembly: String(r.preferred_assembly).trim(),
        profile_data: r.profile_data ?? {},
      }));

      const { error: upsertError } = await supabase.from("users").upsert(upsertPayload, {
        onConflict: "mobile",
      });

      if (upsertError) {
        return new Response(JSON.stringify({ success: false, message: upsertError.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
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
        const { data: rpcData, error: rpcErr } = await supabase.rpc("admin_offline_sakhi_fetch_voters", {
          p_epics: uniqueEpics,
        });
        if (rpcErr) {
          return new Response(
            JSON.stringify({
              success: false,
              message: rpcErr.message || "Voter lookup failed (apply migration admin_offline_sakhi_fetch_voters).",
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
        dbRows = (rpcData ?? []) as typeof dbRows;
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
      const payload = await req.json();
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
      const { data: insRow, error: insErr } = await supabase
        .from("offline_sakhi_reports")
        .insert({
          file_name: fileName,
          summary,
          csv_headers: csvHeaders,
          results: [],
        })
        .select("id")
        .single();
      if (insErr) {
        return new Response(
          JSON.stringify({
            success: false,
            message: insErr.message || "Failed to create report row.",
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
        JSON.stringify({ success: true, reportId: insRow?.id }),
        {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    if (action === "admin-offline-sakhi-report-save-rows") {
      const payload = await req.json();
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
      const batch = rowsIn.map((r: Record<string, unknown>) => ({
        report_id: reportId,
        row_index: r.rowIndex,
        status: r.status,
        epic: r.epic,
        mismatched_fields: r.mismatchedFields ?? [],
        csv: r.csv,
        roll: r.roll ?? null,
        extra_cells: r.extraCells ?? null,
      }));
      const { error: rowErr } = await supabase.from("offline_sakhi_report_rows").insert(batch);
      if (rowErr) {
        return new Response(
          JSON.stringify({
            success: false,
            message: rowErr.message || "Failed to insert report rows (migration offline_sakhi_report_rows?).",
          }),
          {
            status: /duplicate|unique/i.test(rowErr.message) ? 409 : 500,
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
      const payload = await req.json();
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
      const { error: abErr } = await supabase.from("offline_sakhi_reports").delete().eq("id", reportId);
      if (abErr) {
        return new Response(
          JSON.stringify({ success: false, message: abErr.message }),
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
      const payload = await req.json();
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
        const assembly = String(r.halka ?? "").trim();
        const epic = String(r.epic ?? "").replace(/\s/g, "").toUpperCase();
        const mobile = String(r.mobile ?? "").replace(/\D/g, "").slice(0, 10);
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
        const mobileErr = validateIndianMobile10Edge(mobile);
        if (mobileErr) {
          skipped += 1;
          markSkipped(assembly, "invalid_mobile");
          errors.push({ epic, mobile, assembly, reason: "invalid_mobile", message: mobileErr });
          continue;
        }

        // Duplicate check: mobile OR EPIC (active rows)
        const { data: dupRow, error: dupErr } = await supabase
          .from("submissions")
          .select("id")
          .is("deleted_at", null)
          .or(`sakhi_mobile.eq.${mobile}${epic ? `,epic.eq.${epic}` : ""}`)
          .limit(1)
          .maybeSingle();
        if (dupErr && /column .* does not exist/i.test(dupErr.message || "")) {
          return new Response(
            JSON.stringify({
              success: false,
              message:
                "Missing submissions import columns — run migration 20260413130000_submissions_googleform_fields.sql.",
            }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        if (!dupErr && dupRow) {
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

        const applicantName = String(r.applicantName ?? "").trim() || "—";
        const fatherName = String(r.fatherName ?? "").trim() || "—";
        const district = String(r.district ?? "").trim() || "—";
        const booth = String(r.booth ?? "").trim();
        const dob = String(r.dob ?? "").trim();
        const genderRaw = String(r.gender ?? "").trim();
        const gender =
          genderRaw.toLowerCase().startsWith("f") ? "Female" : genderRaw.toLowerCase().startsWith("m") ? "Male" : genderRaw;
        const aadhaarDigits = String(r.aadhaar ?? "").replace(/\D/g, "").slice(0, 12);

        const state = "Punjab";
        const village = "Googleform";
        const halkaBlock = assembly;

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
        const ocrData = [{ label: "voter_lookup", text: JSON.stringify(voterLookup) }];

        const { error: insErr } = await supabase.from("submissions").insert({
          user_id: null,
          sakhi_name: applicantName,
          sakhi_mobile: mobile,
          father_name: fatherName,
          husband_name: fatherName,
          state,
          district,
          assembly,
          halka: halkaBlock,
          village,
          booth_number: booth || null,
          ocr_data: ocrData,
          status: "pending",
          source_name: sourceName,
          epic,
          aadhaar_number: aadhaarDigits || null,
          dob: dob || null,
          gender: gender || null,
          submitted_with_epic: true,
          documents_collected_consent: null,
        } as any);

        if (insErr) {
          if (/column .* does not exist/i.test(insErr.message || "")) {
            return new Response(
              JSON.stringify({
                success: false,
                message:
                  "Missing submissions import columns — run migration 20260413130000_submissions_googleform_fields.sql.",
              }),
              { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
          skipped += 1;
          markSkipped(assembly, "insert_failed");
          errors.push({ epic, mobile, assembly, reason: "insert_failed", message: insErr.message || "Insert failed" });
          continue;
        }
        inserted += 1;
        markInserted(assembly);
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

    if (action === "admin-offline-sakhi-report-save") {
      const payload = await req.json();
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
      if (!summary || typeof summary !== "object" || !Array.isArray(csvHeaders) || !Array.isArray(results)) {
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
      const { error: insErr } = await supabase.from("offline_sakhi_reports").insert({
        file_name: fileName,
        summary,
        csv_headers: csvHeaders,
        results,
      });
      if (insErr) {
        return new Response(
          JSON.stringify({
            success: false,
            message: insErr.message || "Failed to save report (create table offline_sakhi_reports if missing).",
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
        JSON.stringify({ success: true }),
        {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    if (action === "admin-offline-sakhi-report-latest") {
      const payload = await req.json();
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
      const { data: row, error: selErr } = await supabase
        .from("offline_sakhi_reports")
        .select("id, created_at, file_name, summary, csv_headers, results")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (selErr) {
        return new Response(
          JSON.stringify({ success: false, message: selErr.message }),
          {
            status: 500,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }
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
        const { data: rrows, error: rerr } = await supabase
          .from("offline_sakhi_report_rows")
          .select("row_index, status, epic, mismatched_fields, csv, roll, extra_cells")
          .eq("report_id", row.id)
          .order("row_index", { ascending: true });
        if (rerr) {
          resultsOut = [];
        } else {
          resultsOut = (rrows ?? []).map((r: Record<string, unknown>) => ({
            rowIndex: r.row_index,
            status: r.status,
            epic: r.epic,
            mismatchedFields: Array.isArray(r.mismatched_fields)
              ? r.mismatched_fields.map((x: unknown) => String(x))
              : [],
            csv: r.csv,
            roll: r.roll,
            extraCells: r.extra_cells ?? undefined,
          }));
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
    }

    if (action === "admin-offline-sakhi-report-clear") {
      const payload = await req.json();
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
      const { error: delErr } = await supabase.from("offline_sakhi_reports").delete().neq("id", "00000000-0000-0000-0000-000000000000");
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

      const serviceAccountKey = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_KEY");
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

      const ocrApiUrl = Deno.env.get("OCR_API_URL");
      const sessionSecret = Deno.env.get("SESSION_SECRET");
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
      const { data: rows, error: lookupError } = await supabase
        .from("voters")
        .select("*")
        .eq("vcardid", epicNorm)
        .limit(100);

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

      const assembly = payload.assembly?.trim();
      let voter = rows[0];
      if (assembly && rows.length > 1) {
        const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
        const a = norm(assembly);
        const match = rows.find((r: { e_assemblyname?: string | null }) => {
          const ra = norm(r.e_assemblyname ?? "");
          return ra === a || ra.includes(a) || a.includes(ra);
        });
        if (match) voter = match;
      }

      return new Response(
        JSON.stringify({ success: true, voter }),
        {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

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
      if (!submittedWithEpic && !String(payload.booth_number ?? "").trim()) {
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

      const { data: mobileTaken, error: rpcDupErr } = await supabase.rpc("submission_mobile_taken", {
        p_ten_digits: mobileNorm,
      });
      if (!rpcDupErr && mobileTaken === true) {
        return new Response(
          JSON.stringify({
            success: false,
            message: "Is mobile number par pehle se submission ho chuka hai — doosra number use karein.",
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
          .select("id")
          .eq("sakhi_mobile", mobileNorm)
          .is("deleted_at", null)
          .maybeSingle();
        if (existingRow) {
          return new Response(
            JSON.stringify({
              success: false,
              message: "Is mobile number par pehle se submission ho chuka hai — doosra number use karein.",
            }),
            {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        }
      }

      const insertPayload = {
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
      };

      let insertError: { message: string } | null = null;
      let data: { id: string } | null = null;
      const firstTry = await supabase.from("submissions").insert(insertPayload).select("id").single();
      insertError = firstTry.error;
      data = firstTry.data;

      if (insertError) {
        const missingSplit =
          /documents_collected_aadhaar|documents_collected_voter|column .* does not exist/i.test(
            insertError.message ?? ""
          );
        if (missingSplit) {
          const legacyOnly = { ...insertPayload };
          delete (legacyOnly as Record<string, unknown>).documents_collected_aadhaar;
          delete (legacyOnly as Record<string, unknown>).documents_collected_voter;
          const second = await supabase.from("submissions").insert(legacyOnly).select("id").single();
          insertError = second.error;
          data = second.data;
        }
      }

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

      const { data, error } = await supabase
        .from("submissions")
        .select("*")
        .eq("user_id", userId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });

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
              message: "Is mobile number par pehle se submission hai.",
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
});
