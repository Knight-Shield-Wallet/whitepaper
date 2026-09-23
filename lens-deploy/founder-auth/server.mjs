import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";

const PORT = Number(process.env.PORT || 8787);
const RP_ID = requiredEnv("KSD_FOUNDER_RP_ID");
const RP_NAME = process.env.KSD_FOUNDER_RP_NAME || "Knight Shield Digital";
const WEB_ORIGIN = `https://${RP_ID}`;
const ANDROID_ORIGIN = requiredEnv("KSD_ANDROID_ORIGIN");
const ANDROID_PACKAGE = process.env.KSD_ANDROID_PACKAGE || "com.ksd.gameplayer.debug";
const ANDROID_CERT_SHA256 = requiredEnv("KSD_ANDROID_CERT_SHA256");
const FOUNDER_SUBJECT = process.env.KSD_FOUNDER_SUBJECT || "ksd-founder-1";
const FOUNDER_LABEL = process.env.KSD_FOUNDER_LABEL || "Founder";
const STATE_DIR = process.env.KSD_FOUNDER_AUTH_STATE_DIR || "/opt/ksd/state/founder-auth-rp";
const STATE_FILE = path.join(STATE_DIR, "state.json");
const BOOTSTRAP_TOKEN_SHA256 = requiredEnv("KSD_FOUNDER_BOOTSTRAP_TOKEN_SHA256").toLowerCase();
if (!/^[0-9a-f]{64}$/.test(BOOTSTRAP_TOKEN_SHA256)) throw new Error("KSD_FOUNDER_BOOTSTRAP_TOKEN_SHA256_INVALID");
const SESSION_TTL_MS = 10 * 60 * 1000;
const CHALLENGE_TTL_MS = 2 * 60 * 1000;
const ENROLLMENT_LEASE_TTL_MS = 10 * 60 * 1000;
const MAX_BODY = 128 * 1024;

fs.mkdirSync(STATE_DIR, { recursive: true });

function requiredEnv(name) {
  const value = (process.env[name] || "").trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function base64url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

function fromBase64url(value) {
  return new Uint8Array(Buffer.from(value, "base64url"));
}

function now() { return Date.now(); }

function defaultState() {
  return { credentials: [], challenges: {}, sessions: {}, enrollmentLease: null, receipts: [] };
}

function loadState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    return { ...defaultState(), ...parsed };
  } catch {
    return defaultState();
  }
}

function saveState(state) {
  const tmp = STATE_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, STATE_FILE);
}

function prune(state) {
  const t = now();
  for (const [id, challenge] of Object.entries(state.challenges)) {
    if (!challenge || challenge.expiresAt <= t) delete state.challenges[id];
  }
  for (const [token, session] of Object.entries(state.sessions)) {
    if (!session || session.expiresAt <= t) delete state.sessions[token];
  }
  if (state.enrollmentLease && state.enrollmentLease.expiresAt <= t) state.enrollmentLease = null;
}

function randomId() {
  return crypto.randomBytes(24).toString("base64url");
}

function json(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store, private",
    "x-content-type-options": "nosniff",
  });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error("BODY_TOO_LARGE");
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  const value = JSON.parse(text || "{}");
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("BODY_OBJECT_REQUIRED");
  return value;
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function bootstrapLeaseValid(req) {
  const token = String(req.headers["x-ksd-founder-enrollment-lease"] || "");
  if (!token) return false;
  const actual = Buffer.from(sha256Hex(token), "hex");
  const expected = Buffer.from(BOOTSTRAP_TOKEN_SHA256, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function bearer(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return "";
  return header.slice(7).trim();
}

function activeSession(state, req) {
  const token = bearer(req);
  const session = token ? state.sessions[token] : null;
  if (!session || session.expiresAt <= now() || session.founderSubject !== FOUNDER_SUBJECT) return null;
  return { token, ...session };
}

function activeEnrollmentLease(state) {
  const lease = state.enrollmentLease;
  if (!lease || lease.used || lease.expiresAt <= now()) return null;
  return lease;
}

function issueChallenge(state, purpose) {
  const id = randomId();
  state.challenges[id] = { purpose, expiresAt: now() + CHALLENGE_TTL_MS };
  return id;
}

function takeChallenge(state, id, purpose) {
  const value = state.challenges[id];
  delete state.challenges[id];
  if (!value || value.purpose !== purpose || value.expiresAt <= now()) throw new Error("CHALLENGE_INVALID_OR_EXPIRED");
  return value;
}

function record(state, type, details = {}) {
  state.receipts.push({
    schema: "ksd.founder-auth.receipt.v1",
    type,
    founderSubject: FOUNDER_SUBJECT,
    at: new Date().toISOString(),
    ...details,
  });
  state.receipts = state.receipts.slice(-500);
}

function credentialDescriptor(c) {
  return { id: c.id, transports: c.transports || undefined };
}

async function handle(req, res) {
  const url = new URL(req.url, WEB_ORIGIN);
  if (req.method === "GET" && url.pathname === "/health") {
    return json(res, 200, {
      ok: true,
      service: "ksd-founder-auth-rp",
      rpId: RP_ID,
      founderSubject: FOUNDER_SUBJECT,
    });
  }

  if (req.method === "GET" && url.pathname === "/.well-known/assetlinks.json") {
    res.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=300",
    });
    return res.end(JSON.stringify([{
      relation: ["delegate_permission/common.handle_all_urls", "delegate_permission/common.get_login_creds"],
      target: {
        namespace: "android_app",
        package_name: ANDROID_PACKAGE,
        sha256_cert_fingerprints: [ANDROID_CERT_SHA256],
      },
    }]));
  }

  if (req.method !== "POST") return json(res, 405, { code: "METHOD_NOT_ALLOWED" });

  const state = loadState();
  prune(state);
  const body = await readJson(req);

  if (url.pathname === "/v1/founder/enrollment/lease/open") {
    if (!bootstrapLeaseValid(req)) {
      return json(res, 403, { code: "FOUNDER_BOOTSTRAP_NOT_AUTHORIZED" });
    }
    const activeCredentials = state.credentials.filter(c => !c.revokedAt);
    if (activeCredentials.length !== 0) {
      return json(res, 409, { code: "FOUNDER_ALREADY_ENROLLED" });
    }
    const leaseId = randomId();
    const expiresAt = now() + ENROLLMENT_LEASE_TTL_MS;
    state.enrollmentLease = { id: leaseId, expiresAt, used: false };
    record(state, "FOUNDER_ENROLLMENT_LEASE_OPENED", { leaseId, expiresAt: new Date(expiresAt).toISOString() });
    saveState(state);
    return json(res, 200, {
      opened: true,
      leaseId,
      expiresAt: new Date(expiresAt).toISOString(),
      singleUse: true,
    });
  }

  if (url.pathname === "/v1/founder/passkey/register/options") {
    const session = activeSession(state, req);
    const firstCredential = state.credentials.filter(c => !c.revokedAt).length === 0;
    const enrollmentLease = firstCredential ? activeEnrollmentLease(state) : null;
    if (!(session || enrollmentLease)) {
      return json(res, 403, { code: "FOUNDER_ENROLLMENT_NOT_AUTHORIZED" });
    }
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: RP_ID,
      userName: FOUNDER_LABEL,
      userDisplayName: FOUNDER_LABEL,
      userID: new TextEncoder().encode(FOUNDER_SUBJECT),
      attestationType: "none",
      excludeCredentials: state.credentials.map(credentialDescriptor),
      authenticatorSelection: {
        residentKey: "required",
        userVerification: "required",
      },
    });
    const challengeId = issueChallenge(state, "registration");
    state.challenges[challengeId].challenge = options.challenge;
    state.challenges[challengeId].authorizedBy = session ? "founder-session" : "server-enrollment-lease";
    if (enrollmentLease) state.challenges[challengeId].enrollmentLeaseId = enrollmentLease.id;
    saveState(state);
    return json(res, 200, { challengeId, requestJson: JSON.stringify(options) });
  }

  if (url.pathname === "/v1/founder/passkey/register/verify") {
    const challengeId = String(body.challengeId || "");
    const response = body.responseJson;
    const challenge = takeChallenge(state, challengeId, "registration");
    if (challenge.authorizedBy === "founder-session" && !activeSession(state, req)) {
      saveState(state);
      return json(res, 403, { code: "FOUNDER_SESSION_REQUIRED" });
    }
    if (challenge.authorizedBy === "server-enrollment-lease") {
      const lease = activeEnrollmentLease(state);
      if (!lease || lease.id !== challenge.enrollmentLeaseId) {
        saveState(state);
        return json(res, 403, { code: "FOUNDER_ENROLLMENT_LEASE_REQUIRED" });
      }
    }
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: [WEB_ORIGIN, ANDROID_ORIGIN],
      expectedRPID: RP_ID,
      requireUserVerification: true,
    });
    if (!verification.verified || !verification.registrationInfo) {
      saveState(state);
      return json(res, 403, { code: "PASSKEY_REGISTRATION_NOT_VERIFIED" });
    }
    const info = verification.registrationInfo;
    const cred = info.credential;
    const existing = state.credentials.findIndex((c) => c.id === cred.id);
    const stored = {
      id: cred.id,
      publicKey: base64url(cred.publicKey),
      counter: cred.counter,
      transports: cred.transports || [],
      deviceType: info.credentialDeviceType,
      backedUp: info.credentialBackedUp,
      createdAt: new Date().toISOString(),
      revokedAt: null,
    };
    if (existing >= 0) state.credentials[existing] = stored;
    else state.credentials.push(stored);
    if (challenge.authorizedBy === "server-enrollment-lease" && state.enrollmentLease?.id === challenge.enrollmentLeaseId) {
      state.enrollmentLease.used = true;
      state.enrollmentLease.expiresAt = now();
    }
    record(state, "PASSKEY_REGISTERED", { credentialId: cred.id, credentialCount: state.credentials.filter(c => !c.revokedAt).length });
    saveState(state);
    return json(res, 200, {
      verified: true,
      recoveryReady: state.credentials.filter(c => !c.revokedAt).length >= 2,
    });
  }

  if (url.pathname === "/v1/founder/passkey/authenticate/options") {
    const credentials = state.credentials.filter(c => !c.revokedAt);
    if (!credentials.length) return json(res, 409, { code: "FOUNDER_PASSKEY_NOT_REGISTERED" });
    const options = await generateAuthenticationOptions({
      rpID: RP_ID,
      userVerification: "required",
      allowCredentials: credentials.map(credentialDescriptor),
    });
    const challengeId = issueChallenge(state, "authentication");
    state.challenges[challengeId].challenge = options.challenge;
    saveState(state);
    return json(res, 200, { challengeId, requestJson: JSON.stringify(options) });
  }

  if (url.pathname === "/v1/founder/passkey/authenticate/verify") {
    const challengeId = String(body.challengeId || "");
    const response = body.responseJson;
    const challenge = takeChallenge(state, challengeId, "authentication");
    const credential = state.credentials.find(c => !c.revokedAt && c.id === String(response?.id || ""));
    if (!credential) {
      saveState(state);
      return json(res, 403, { code: "FOUNDER_CREDENTIAL_NOT_FOUND" });
    }
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: [WEB_ORIGIN, ANDROID_ORIGIN],
      expectedRPID: RP_ID,
      requireUserVerification: true,
      credential: {
        id: credential.id,
        publicKey: fromBase64url(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports || undefined,
      },
    });
    if (!verification.verified) {
      saveState(state);
      return json(res, 403, { code: "FOUNDER_PASSKEY_NOT_VERIFIED" });
    }
    credential.counter = verification.authenticationInfo.newCounter;
    credential.lastUsedAt = new Date().toISOString();
    const token = randomId();
    const expiresAt = now() + SESSION_TTL_MS;
    state.sessions[token] = { founderSubject: FOUNDER_SUBJECT, expiresAt };
    record(state, "PASSKEY_AUTHENTICATED", { credentialId: credential.id });
    saveState(state);
    return json(res, 200, {
      verified: true,
      founderSubject: FOUNDER_SUBJECT,
      sessionExpiresAt: new Date(expiresAt).toISOString(),
      sessionToken: token,
      recoveryReady: state.credentials.filter(c => !c.revokedAt).length >= 2,
    });
  }

  if (url.pathname === "/v1/founder/recovery/status") {
    const session = activeSession(state, req);
    if (!session) return json(res, 401, { code: "FOUNDER_SESSION_REQUIRED" });
    return json(res, 200, {
      founderSubject: FOUNDER_SUBJECT,
      activeCredentialCount: state.credentials.filter(c => !c.revokedAt).length,
      recoveryReady: state.credentials.filter(c => !c.revokedAt).length >= 2,
    });
  }

  if (url.pathname === "/v1/founder/passkey/revoke") {
    const session = activeSession(state, req);
    if (!session) return json(res, 401, { code: "FOUNDER_SESSION_REQUIRED" });
    const id = String(body.credentialId || "");
    const target = state.credentials.find(c => c.id === id && !c.revokedAt);
    if (!target) return json(res, 404, { code: "CREDENTIAL_NOT_FOUND" });
    const remaining = state.credentials.filter(c => !c.revokedAt && c.id !== id).length;
    if (remaining < 1) return json(res, 409, { code: "CANNOT_REVOKE_LAST_FOUNDER_CREDENTIAL" });
    target.revokedAt = new Date().toISOString();
    record(state, "PASSKEY_REVOKED", { credentialId: id });
    saveState(state);
    return json(res, 200, { revoked: true, recoveryReady: remaining >= 2 });
  }

  return json(res, 404, { code: "NOT_FOUND" });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((error) => {
    console.error(error);
    json(res, error?.message === "BODY_TOO_LARGE" ? 413 : 400, {
      code: String(error?.message || "FOUNDER_AUTH_FAILED").slice(0, 160),
    });
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(JSON.stringify({
    status: "READY",
    service: "ksd-founder-auth-rp",
    port: PORT,
    rpId: RP_ID,
    androidPackage: ANDROID_PACKAGE,
  }));
});
