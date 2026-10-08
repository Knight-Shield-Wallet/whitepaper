const textEncoder = new TextEncoder();

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function sha256(value) {
  const bytes = await crypto.subtle.digest("SHA-256", textEncoder.encode(typeof value === "string" ? value : canonical(value)));
  return Array.from(new Uint8Array(bytes)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createInvite({
  ownerLabel = "Owner",
  action = "bounded synthetic photo-session acknowledgement",
  ttlSeconds = 600,
  createdAt = new Date().toISOString(),
  token = randomToken()
} = {}) {
  const expiresAt = new Date(new Date(createdAt).getTime() + ttlSeconds * 1000).toISOString();
  const publicInvite = {
    schema: "ksd.midnight-lens.two-phone-invite.v1",
    token_hash: await sha256(token),
    owner_label: String(ownerLabel || "Owner").slice(0, 80),
    action: String(action || "bounded synthetic action").slice(0, 140),
    created_at: createdAt,
    expires_at: expiresAt,
    consent_required: ["owner", "guest"],
    install_required: false,
    authority: {
      proof_scope: "source_prepared_two_phone_gate",
      live_identity_proven: false,
      live_media_transport_proven: false,
      signing_proven: false
    }
  };
  return { token, publicInvite };
}

export async function acceptInvite(publicInvite, {
  token,
  guestLabel = "Guest",
  acceptedAt = new Date().toISOString(),
  revoked = false,
  alreadyUsed = false
} = {}) {
  const checks = {
    schema: publicInvite?.schema === "ksd.midnight-lens.two-phone-invite.v1",
    token_match: !!token && await sha256(token) === publicInvite?.token_hash,
    not_expired: new Date(acceptedAt).getTime() <= new Date(publicInvite?.expires_at || 0).getTime(),
    not_revoked: revoked !== true,
    not_replay: alreadyUsed !== true,
    owner_consent_declared: publicInvite?.consent_required?.includes("owner") === true,
    guest_consent_declared: publicInvite?.consent_required?.includes("guest") === true
  };
  const accepted = Object.values(checks).every(Boolean);
  const receipt = {
    schema: "ksd.midnight-lens.two-phone-receipt.v1",
    invite_hash: await sha256(publicInvite || {}),
    guest_label: String(guestLabel || "Guest").slice(0, 80),
    accepted_at: acceptedAt,
    bounded_action: publicInvite?.action || null,
    result: accepted ? "ACCEPTED" : "DENIED",
    checks,
    truth_boundary: {
      source_gate_prepared: true,
      real_two_phone_run_proven: false,
      independent_runtime_receipt_proven: false,
      qr_doorbell_media_proven: false,
      signing_proven: false
    }
  };
  receipt.receipt_hash = await sha256(receipt);
  return receipt;
}

export async function completeSyntheticAction(receipt, completedAt = new Date().toISOString()) {
  if (receipt?.result !== "ACCEPTED") {
    return { ...receipt, completed_at: completedAt, final_result: "DENIED_NOT_ACCEPTED" };
  }
  const completed = {
    ...receipt,
    completed_at: completedAt,
    final_result: "PASS_SOURCE_GATE",
    synthetic_action_completed: true
  };
  completed.receipt_hash = await sha256(completed);
  return completed;
}

export async function runTwoPhoneGateSelfTest() {
  const baseTime = "2026-10-06T18:00:00.000Z";
  const { token, publicInvite } = await createInvite({ ownerLabel: "Owner phone", createdAt: baseTime, token: "test-token-opaque" });
  const accepted = await acceptInvite(publicInvite, { token, guestLabel: "Guest phone", acceptedAt: "2026-10-06T18:01:00.000Z" });
  const completed = await completeSyntheticAction(accepted, "2026-10-06T18:02:00.000Z");
  const expired = await acceptInvite(publicInvite, { token, acceptedAt: "2026-10-06T18:11:00.000Z" });
  const revoked = await acceptInvite(publicInvite, { token, acceptedAt: "2026-10-06T18:01:00.000Z", revoked: true });
  const replay = await acceptInvite(publicInvite, { token, acceptedAt: "2026-10-06T18:01:00.000Z", alreadyUsed: true });
  return {
    schema: "ksd.midnight-lens.two-phone-gate.self-test.v1",
    happy_path: completed.final_result === "PASS_SOURCE_GATE",
    expired_denied: expired.result === "DENIED" && expired.checks.not_expired === false,
    revoked_denied: revoked.result === "DENIED" && revoked.checks.not_revoked === false,
    replay_denied: replay.result === "DENIED" && replay.checks.not_replay === false,
    receipt_hash: completed.receipt_hash,
    proof_scope: "deterministic_source_gate_only"
  };
}

if (typeof window !== "undefined") {
  window.KSDLensTwoPhoneGate = { createInvite, acceptInvite, completeSyntheticAction, runTwoPhoneGateSelfTest };
}
