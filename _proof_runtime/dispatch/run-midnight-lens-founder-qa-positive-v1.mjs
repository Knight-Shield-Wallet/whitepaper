import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { authorityManifestStore } from './authority-manifest-store.mjs';
import {
  PROOF_SCHEMA_VERSION,
  gatekeeperIssueReleaseClearance,
  openReleaseSession,
  receiptDigest,
  sha256Bytes,
  sha256Object,
  signProofObject,
} from './proof-gatekeeper-v1.mjs';
import { verifyAndroidCandidateIdentity } from './android-candidate-identity-verifier-v1.mjs';
import {
  verifyAndroidPackageIdentity,
  verifyAndroidSecurityStatic,
  verifyAndroidPrivacyStatic,
} from './android-apk-static-verifiers-v1.mjs';
import { founderQaHandoffBoundary } from './founder-qa-release-broker-v1.mjs';

const [apkArg, screenshotArg, auditArg, outputDirArg] = process.argv.slice(2);
if (!apkArg || !screenshotArg || !auditArg || !outputDirArg) {
  throw new Error('USAGE: node dispatch/run-midnight-lens-founder-qa-positive-v1.mjs <apk> <screenshot> <audit-json> <output-dir>');
}

const apkPath = resolve(apkArg);
const screenshotPath = resolve(screenshotArg);
const auditPath = resolve(auditArg);
const outputDir = resolve(outputDirArg);
const candidateBytes = readFileSync(apkPath);
const screenshotBytes = readFileSync(screenshotPath);
const audit = JSON.parse(readFileSync(auditPath, 'utf8'));
const now = new Date();
const releaseClass = 'midnight_lens_android_founder_qa';
const channel = 'midnight_lens_founder_qa_handoff';

const session = openReleaseSession({
  candidateBytes,
  releaseClass,
  manifestStore: authorityManifestStore,
  now,
});

const verifier = generateKeyPairSync('ed25519');
const gatekeeper = generateKeyPairSync('ed25519');
const verifierKeyId = `midnight-lens-founder-qa-verifier-${randomUUID()}`;
const gatekeeperKeyId = `midnight-lens-founder-qa-gatekeeper-${randomUUID()}`;
const verifierKeyStore = new Map([[verifierKeyId, verifier.publicKey]]);
const gatekeeperKeyStore = new Map([[gatekeeperKeyId, gatekeeper.publicKey]]);
const receipts = [];
const ledger = {
  listReceiptsForSession: (sessionId) => receipts.filter((receipt) => receipt.session_id === sessionId),
};

function add(receipt) {
  receipts.push(receipt);
  return receipt;
}

function genericReceipt({ gateId, evidenceClasses, evidenceRefs, findings, dependsOn = [], pass, reason }) {
  const issuedAt = new Date(now);
  return signProofObject({
    schema_version: PROOF_SCHEMA_VERSION,
    receipt_id: randomUUID(),
    gate_id: gateId,
    gate_implementation_digest: sha256Object({ implementation: `midnight-lens-${gateId}-verifier-v1`, version: 1 }),
    policy_version: session.policy_version,
    manifest_digest: session.manifest_digest,
    candidate_digest: session.candidate_digest,
    release_class: session.release_class,
    session_id: session.session_id,
    session_nonce: session.nonce,
    verifier_key_id: verifierKeyId,
    evidence_classes: evidenceClasses,
    evidence_refs: evidenceRefs,
    evidence_hashes: evidenceRefs.map((ref, index) => sha256Object({ ref, index, findings })),
    findings,
    result: pass ? 'PASS' : 'FAIL',
    reason_codes: [pass ? reason : 'VERIFIED_FAIL'],
    depends_on: dependsOn.map(receiptDigest),
    issued_at: issuedAt.toISOString(),
    expires_at: new Date(issuedAt.getTime() + 30 * 60 * 1000).toISOString(),
  }, verifier.privateKey);
}

const candidateReceipt = add(verifyAndroidCandidateIdentity({
  candidateBytes,
  session,
  verifierKeyId,
  verifierPrivateKey: verifier.privateKey,
  sourceRef: `local-build://${basename(apkPath)}`,
  now,
  ttlSeconds: 1800,
}));

const staticArgs = {
  apkPath,
  session,
  dependencyReceipts: [candidateReceipt],
  verifierKeyId,
  verifierPrivateKey: verifier.privateKey,
  now,
  ttlSeconds: 1800,
};

const packageReceipt = add(verifyAndroidPackageIdentity(staticArgs));
const securityReceipt = add(verifyAndroidSecurityStatic(staticArgs));
const privacyReceipt = add(verifyAndroidPrivacyStatic(staticArgs));

const guidedPass =
  audit.guided_proof_route === true &&
  audit.quick_session_route === true &&
  audit.start_guided_proof_control === true &&
  audit.start_photo_session_control === true &&
  audit.end_session_control === true &&
  audit.truth_boundary_present === true &&
  audit.no_file_input === true;

const guidedReceipt = add(genericReceipt({
  gateId: 'guided_proof_surface',
  evidenceClasses: ['MACHINE', 'TOOL'],
  evidenceRefs: ['http://127.0.0.1:18080/proof-session', 'http://127.0.0.1:18080/session?proof=1'],
  findings: audit,
  dependsOn: [candidateReceipt],
  pass: guidedPass,
  reason: 'GUIDED_PROOF_SURFACE_VERIFIED',
}));

const screenshotDigest = sha256Bytes(screenshotBytes);
const renderedPass =
  audit.viewport_width === 390 &&
  audit.viewport_height === 844 &&
  audit.horizontal_overflow === false &&
  audit.primary_action_visible === true &&
  audit.rendered_title_visible === true &&
  screenshotBytes.length > 1000;

const renderedReceipt = add(genericReceipt({
  gateId: 'rendered_mobile_visual',
  evidenceClasses: ['MACHINE'],
  evidenceRefs: ['ci://render/midnight-lens-guided-proof-390x844.png'],
  findings: {
    screenshot_sha256: screenshotDigest,
    screenshot_bytes: screenshotBytes.length,
    viewport_width: audit.viewport_width,
    viewport_height: audit.viewport_height,
    horizontal_overflow: audit.horizontal_overflow,
    primary_action_visible: audit.primary_action_visible,
    rendered_title_visible: audit.rendered_title_visible,
  },
  dependsOn: [packageReceipt, securityReceipt, privacyReceipt, guidedReceipt],
  pass: renderedPass,
  reason: 'MOBILE_RENDER_390X844_VERIFIED',
}));

const accessibilityPass =
  audit.html_lang_present === true &&
  audit.viewport_meta_present === true &&
  audit.heading_present === true &&
  audit.button_count >= 1 &&
  audit.unlabelled_button_count === 0 &&
  audit.min_interactive_height_px >= 44 &&
  audit.status_role_present === true &&
  audit.focusable_primary_action === true;

const accessibilityReceipt = add(genericReceipt({
  gateId: 'accessibility_preflight',
  evidenceClasses: ['MACHINE', 'TOOL'],
  evidenceRefs: ['ci://audit/midnight-lens-guided-proof-accessibility.json'],
  findings: {
    html_lang_present: audit.html_lang_present,
    viewport_meta_present: audit.viewport_meta_present,
    heading_present: audit.heading_present,
    button_count: audit.button_count,
    unlabelled_button_count: audit.unlabelled_button_count,
    min_interactive_height_px: audit.min_interactive_height_px,
    status_role_present: audit.status_role_present,
    focusable_primary_action: audit.focusable_primary_action,
  },
  dependsOn: [renderedReceipt],
  pass: accessibilityPass,
  reason: 'ACCESSIBILITY_PREFLIGHT_VERIFIED',
}));

const gatekeeperImplementationDigest = sha256Object({
  implementation: 'pentagon-proof-gatekeeper-v1',
  release: 'midnight-lens-founder-qa-v1',
  version: 1,
});

const issuance = gatekeeperIssueReleaseClearance({
  session,
  manifestStore: authorityManifestStore,
  ledger,
  verifierKeyStore,
  channel,
  gatekeeperKeyId,
  gatekeeperPrivateKey: gatekeeper.privateKey,
  gatekeeperImplementationDigest,
  now,
  ttlSeconds: 900,
});

const handoffDir = resolve(outputDir, 'handoff');
const broker = founderQaHandoffBoundary({
  candidateBytes,
  clearance: issuance.clearance,
  gatekeeperPublicKeyStore: gatekeeperKeyStore,
  spentNonces: new Set(),
  outputDir: handoffDir,
  filename: 'Midnight-Lens-Founder-QA.apk',
  expectedChannel: channel,
  now,
});

const proof = {
  schema: 'ksd.midnight-lens.android-founder-qa.positive-boundary.v1',
  source_sha: process.env.GITHUB_SHA || null,
  candidate_sha256: sha256Bytes(candidateBytes),
  candidate_bytes: candidateBytes.length,
  release_class: releaseClass,
  channel,
  screenshot_sha256: screenshotDigest,
  gates: Object.fromEntries(receipts.map((r) => [r.gate_id, {
    result: r.result,
    reason_codes: r.reason_codes,
    receipt_digest: receiptDigest(r),
  }])),
  gatekeeper: {
    status: issuance.status,
    reason: issuance.evaluation?.reason || issuance.reason || null,
    detail: issuance.evaluation?.detail || issuance.detail || null,
    clearance_issued: Boolean(issuance.clearance),
    clearance_id: issuance.clearance?.clearance_id || null,
  },
  broker: {
    status: broker.status,
    reason: broker.reason,
    materialized: broker.materialized,
  },
  founder_qa_only: true,
  production_release_authorized: false,
};

mkdirSync(outputDir, { recursive: true });
writeFileSync(resolve(outputDir, 'midnight-lens-founder-qa-positive-boundary.proof.json'), JSON.stringify(proof, null, 2));
writeFileSync(resolve(outputDir, 'midnight-lens-guided-proof-390x844.png'), screenshotBytes);
writeFileSync(resolve(outputDir, 'midnight-lens-guided-proof-accessibility.json'), JSON.stringify(audit, null, 2));

console.log(JSON.stringify(proof, null, 2));
if (issuance.status !== 'PASS' || broker.status !== 'ALLOW' || broker.materialized !== true) process.exit(1);
