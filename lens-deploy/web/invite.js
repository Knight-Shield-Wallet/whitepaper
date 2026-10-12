import { acceptInvite, completeSyntheticAction, createInvite } from "./two-phone-gate.mjs";

const OWNER_KEY = "ksd_midnight_lens_two_phone_owner_v1";
const USED_KEY = "ksd_midnight_lens_two_phone_used_v1";
const el = (id) => document.getElementById(id);
const ownerView = el("ownerView");
const guestView = el("guestView");
const receiptView = el("receiptView");
const inviteSummary = el("inviteSummary");
const receiptSummary = el("receiptSummary");
const receiptJson = el("receiptJson");
const verdict = el("verdict");
let currentInvite = null;
let currentToken = null;

function encode(value) {
  return btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function decode(value) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  return JSON.parse(atob(padded));
}

function show(view) {
  [ownerView, guestView, receiptView].forEach((item) => item.classList.add("hidden"));
  view.classList.remove("hidden");
}

function resultRow(label, value) {
  const ok = value === true || value === "PASS" || value === "ACCEPTED" || value === "PASS_SOURCE_GATE";
  const status = ok ? "PASS" : value === false ? "FAIL" : String(value);
  return `<div class="result"><span>${label}</span><strong class="${ok ? "pass" : "fail"}">${status}</strong></div>`;
}

function renderReceipt(receipt) {
  verdict.textContent = receipt.final_result === "PASS_SOURCE_GATE" ? "Source gate ready" : "Invite denied";
  receiptSummary.innerHTML = [
    resultRow("Token matched", receipt.checks?.token_match),
    resultRow("Not expired", receipt.checks?.not_expired),
    resultRow("Not revoked", receipt.checks?.not_revoked),
    resultRow("Not replayed", receipt.checks?.not_replay),
    resultRow("Bounded action", receipt.final_result)
  ].join("");
  receiptJson.textContent = JSON.stringify(receipt, null, 2);
  show(receiptView);
}

function usedTokens() {
  try { return JSON.parse(localStorage.getItem(USED_KEY) || "[]"); } catch { return []; }
}

function markUsed(hash) {
  localStorage.setItem(USED_KEY, JSON.stringify([...new Set([...usedTokens(), hash])]));
}

el("createInvite").addEventListener("click", async () => {
  const ownerLabel = el("ownerLabel").value;
  const action = el("actionText").value;
  const invite = await createInvite({ ownerLabel, action });
  currentInvite = invite.publicInvite;
  currentToken = invite.token;
  localStorage.setItem(OWNER_KEY, JSON.stringify({ token: currentToken, publicInvite: currentInvite, revoked: false }));
  const params = new URLSearchParams({ invite: encode(currentInvite), token: currentToken });
  const link = `${location.origin}/invite?${params.toString()}`;
  el("inviteLink").href = link;
  el("inviteLink").textContent = link;
  el("inviteOutput").classList.remove("hidden");
});

el("copyInvite").addEventListener("click", async () => {
  await navigator.clipboard.writeText(el("inviteLink").href);
  el("copyInvite").textContent = "Link Copied";
});

el("revokeInvite").addEventListener("click", () => {
  const state = JSON.parse(localStorage.getItem(OWNER_KEY) || "{}");
  localStorage.setItem(OWNER_KEY, JSON.stringify({ ...state, revoked: true }));
  el("revokeInvite").textContent = "Revoked For Local Proof";
});

el("acceptInvite").addEventListener("click", async () => {
  const alreadyUsed = usedTokens().includes(currentInvite.token_hash);
  const ownerState = JSON.parse(localStorage.getItem(OWNER_KEY) || "{}");
  const receipt = await acceptInvite(currentInvite, {
    token: currentToken,
    guestLabel: el("guestLabel").value,
    revoked: ownerState.publicInvite?.token_hash === currentInvite.token_hash && ownerState.revoked === true,
    alreadyUsed
  });
  const completed = await completeSyntheticAction(receipt);
  if (receipt.result === "ACCEPTED") markUsed(currentInvite.token_hash);
  renderReceipt(completed);
});

el("copyReceipt").addEventListener("click", async () => {
  await navigator.clipboard.writeText(receiptJson.textContent);
  el("copyReceipt").textContent = "Receipt Copied";
});

const params = new URLSearchParams(location.search);
if (params.has("invite")) {
  currentInvite = decode(params.get("invite"));
  currentToken = params.get("token") || "";
  inviteSummary.innerHTML = [
    resultRow("Opaque invite", !!currentInvite.token_hash),
    resultRow("Owner consent declared", currentInvite.consent_required?.includes("owner") === true),
    resultRow("Guest consent required", currentInvite.consent_required?.includes("guest") === true),
    resultRow("Install required", currentInvite.install_required === false ? "PASS" : false),
    `<div class="result"><span>Action</span><strong>${currentInvite.action}</strong></div>`,
    `<div class="result"><span>Expires</span><strong>${currentInvite.expires_at}</strong></div>`
  ].join("");
  show(guestView);
}
