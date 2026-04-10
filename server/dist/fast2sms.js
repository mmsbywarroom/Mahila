/**
 * Fast2SMS DLT OTP — POST https://www.fast2sms.com/dev/bulkV2
 * Env: FAST2SMS_API_KEY, FAST2SMS_SENDER_ID, DLT_TEMPLATE_ID, optional FAST2SMS_ENTITY_ID, optional FAST2SMS_VARIABLES_MODE (pipe | plain).
 */
export function isFast2SmsConfigured() {
    return Boolean(process.env.FAST2SMS_API_KEY?.trim() &&
        process.env.FAST2SMS_SENDER_ID?.trim() &&
        process.env.DLT_TEMPLATE_ID?.trim());
}
function looksLikeHtml(s) {
    const t = s.trim().toLowerCase();
    return t.startsWith("<!doctype") || t.startsWith("<html");
}
function buildVariablesValues(otp) {
    const mode = (process.env.FAST2SMS_VARIABLES_MODE ?? "pipe").trim().toLowerCase();
    if (mode === "plain" || mode === "otp_only") {
        return otp;
    }
    return `${otp}|`;
}
export async function sendFast2SmsOtp(mobile10Digits, otp) {
    const apiKey = process.env.FAST2SMS_API_KEY?.trim();
    const senderId = process.env.FAST2SMS_SENDER_ID?.trim();
    const messageId = process.env.DLT_TEMPLATE_ID?.trim();
    const entityId = process.env.FAST2SMS_ENTITY_ID?.trim();
    if (!apiKey || !senderId || !messageId) {
        return { ok: false, message: "SMS gateway not configured" };
    }
    const numbers = mobile10Digits.replace(/\D/g, "").slice(-10);
    if (numbers.length !== 10) {
        return { ok: false, message: "Invalid mobile number" };
    }
    const variablesValues = buildVariablesValues(otp);
    const messageField = /^\d+$/.test(messageId) ? Number(messageId) : messageId;
    const body = {
        route: "dlt",
        sender_id: senderId,
        message: messageField,
        variables_values: variablesValues,
        numbers,
        flash: 0,
    };
    if (entityId) {
        body.entity_id = entityId;
    }
    try {
        const res = await fetch("https://www.fast2sms.com/dev/bulkV2", {
            method: "POST",
            headers: {
                authorization: apiKey,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
        });
        const rawText = await res.text();
        if (looksLikeHtml(rawText)) {
            return {
                ok: false,
                message: "SMS gateway returned HTML instead of JSON. Check API key and https://www.fast2sms.com/dev/bulkV2",
            };
        }
        let json = {};
        try {
            json = JSON.parse(rawText);
        }
        catch {
            return { ok: false, message: rawText.slice(0, 200) || `HTTP ${res.status}` };
        }
        const statusOk = Number(json.status_code) === 200;
        if (json.return === true || statusOk) {
            return { ok: true };
        }
        const rawMsg = typeof json.message === "string"
            ? json.message
            : Array.isArray(json.message)
                ? JSON.stringify(json.message)
                : JSON.stringify(json.message ?? json);
        return { ok: false, message: rawMsg || `HTTP ${res.status}` };
    }
    catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
}
