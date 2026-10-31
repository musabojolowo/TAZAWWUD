// ============================================================================
// TAZAWWUD - Sends "Send now" reminders to phones that registered for push.
// ----------------------------------------------------------------------------
// Run every 10 minutes by GitHub Actions. Uses a Firebase service account, given as
// the FIREBASE_SERVICE_ACCOUNT secret. No packages are needed; only Node 20.
// Each reminder is sent once (recorded under pushSent). Phones whose token is no
// longer valid are removed from pushTokens.
// ============================================================================

import { createSign } from "node:crypto";

const PROJECT_ID = "tazawwud-4028b";
const DB = "https://tazawwud-4028b-default-rtdb.firebaseio.com";
const RECENT_MS = 30 * 60 * 1000; // only reminders created in the last 30 minutes

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "null");
if (!serviceAccount?.client_email || !serviceAccount?.private_key) {
  console.error("FIREBASE_SERVICE_ACCOUNT is missing or invalid.");
  process.exit(1);
}

const b64url = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");

async function accessToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url({ alg: "RS256", typ: "JWT" });
  const claims = b64url({
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  });
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = signer.sign(serviceAccount.private_key, "base64url");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${signature}`,
    }),
  });
  if (!response.ok) throw new Error(`Token request failed: ${response.status}`);
  return (await response.json()).access_token;
}

async function readJson(token, path) {
  const response = await fetch(`${DB}/${path}.json?access_token=${encodeURIComponent(token)}`);
  if (!response.ok) throw new Error(`Read ${path} failed: ${response.status}`);
  return (await response.json()) || {};
}

async function writeJson(token, path, value, method = "PUT") {
  const response = await fetch(`${DB}/${path}.json?access_token=${encodeURIComponent(token)}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  });
  if (!response.ok) throw new Error(`Write ${path} failed: ${response.status}`);
}

async function sendToPhone(token, phoneToken, reminder) {
  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${PROJECT_ID}/messages:send`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      message: {
        token: phoneToken,
        data: { title: String(reminder.title || "TAZAWWUD"), body: String(reminder.body || ""), id: String(reminder.id) },
        android: { priority: "high" },
      },
    }),
  });
  if (response.ok) return "sent";
  const text = await response.text();
  if (/UNREGISTERED|INVALID_ARGUMENT|NOT_FOUND/.test(text)) return "invalid";
  throw new Error(`Send failed: ${response.status} ${text.slice(0, 200)}`);
}

const token = await accessToken();
const [immediate, sent, phones] = await Promise.all([
  readJson(token, "immediateReminders"),
  readJson(token, "pushSent"),
  readJson(token, "pushTokens"),
]);

const now = Date.now();
const due = Object.entries(immediate).filter(([id, item]) =>
  !sent[id] && Number(item?.createdAt || 0) >= now - RECENT_MS && item?.title
);

const phoneTokens = Object.keys(phones);
console.log(`Reminders to send: ${due.length}. Phones registered: ${phoneTokens.length}.`);

for (const [id, item] of due) {
  let delivered = 0;
  for (const phone of phoneTokens) {
    const result = await sendToPhone(token, phone, { ...item, id });
    if (result === "sent") delivered += 1;
    if (result === "invalid") await writeJson(token, `pushTokens/${phone}`, null);
  }
  await writeJson(token, `pushSent/${id}`, true);
  console.log(`Reminder ${id}: delivered to ${delivered} phone(s).`);
}
console.log("Done.");
