import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { authorityManifestStore } from './authority-manifest-store.mjs';
import {
  gatekeeperIssueReleaseClearance,
  openReleaseSession,
  receiptDigest,
  sha256Bytes,
  sha256Object,
} from './proof-gatekeeper-v1.mjs';
import { verifyAndroidCandidateIdentity } from './android-candidate-identity-verifier-v1.mjs';
import {
  verifyAndroidPackageIdentity,
  verifyAndroidPrivacyStatic,
  verifyAndroidSecurityStatic,
} from './android-apk-static-verifiers-v1.mjs';
import { founderQaHandoffBoundary } from './founder-qa-release-broker-v1.mjs';

const outputDir = resolve(process.argv[2] || 'proof-output/midnight-lens-founder-qa-negative-boundary');
rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });

const defectiveApkPath = resolve(outputDir, '.defective-candidate.apk');
const candidateBytes = Buffer.from(
  'KSD MIDNIGHT LENS DEFECTIVE ANDROID FOUNDER QA CANARY V1\nNOT A VALID APK\n',
  'utf8',
);
writeFileSync(defectiveApkPath, candidateBytes);

const now = new Date();
const session = openReleaseSession({
  candidateBytes,
  releaseClass: 'midnight_lens_android_founder_qa',
  manifestStore: authorityManifestStore,
  now,
});

const verifier = generateKeyPairSync('ed25519');
const gatekeeper = generateKeyPairSync('ed25519');
const verifierKeyId = `lens-negative-verifier-${randomUUID()}`;
const gatekeeperKeyId = `lens-negative-gatekeeper-${randomUUID()}`;
const verifierKeyStore = new Map([[verifierKeyId, verifier.publicKey]]);
const gatekeeperKeyStore = new Map([[gatekeeperKeyId, gatekeeper.publicKey]]);
const receipts = [];
const ledger = {
  listReceiptsForSession: (sessionId) => receipts.filter((r) => r.session_id === sessionId),
};

const candidateReceipt = verifyAndroidCandidateIdentity({
  candidateBytes,
  session,
  verifierKeyId,
  verifierPrivateKey: verifier.privateKey,
  sourceRef: 'canary://midnight-lens/android-founder-qa/defective-candidate',
  now,
});
receipts.push(candidateReceipt);

const staticArgs = {
  apkPath: defectiveApkPath,
  session,
  dependencyReceipts: [candidateReceipt],
  verifierKeyId,
  verifierPrivateKey: verifier.privateKey,
  now,
};
const packageReceipt = verifyAndroidPackageIdentity(staticArgs);
const securityReceipt = verifyAndroidSecurityStatic(staticArgs);
const privacyReceipt = verifyAndroidPrivacyStatic(staticArgs);
receipts.push(packageReceipt, securityReceipt, privacyReceipt);

const gatekeeperImplementationDigest = sha256Object({
  implementation: 'pentagon-proof-gatekeeper-v1',
  release: 'midnight-lens-founder-qa-negative-boundary-v1',
  version: 1,
});

const issuance = gatekeeperIssueReleaseClearance({
  session,
  manifestStore: authorityManifestStore,
  ledger,
  verifierKeyStore,
  channel: 'midnight_lens_founder_qa_handoff',
  gatekeeperKeyId,
  gatekeeperPrivateKey: gatekeeper.privateKey,
  gatekeeperImplementationDigest,
  now,
  ttlSeconds: 300,
});

const handoffDir = resolve(outputDir, 'handoff');
const broker = founderQaHandoffBoundary({
  candidateBytes,
  clearance: issuance.clearance,
  gatekeeperPublicKeyStore: gatekeeperKeyStore,
  spentNonces: new Set(),
  outputDir: handoffDir,
  filename: 'Midnight-Lens-Founder-QA.apk',
  expectedChannel: 'midnight_lens_founder_qa_handoff',
  now,
});

const proof = {
  schema: 'ksd.midnight-lens.android-founder-qa.negative-boundary.v1',
  source_sha: process.env.GITHUB_SHA || null,
  release_class: session.release_class,
  channel: 'midnight_lens_founder_qa_handoff',
  candidate_sha256: sha256Bytes(candidateBytes),
  candidate_byte_length: candidateBytes.length,
  candidate_fixture: 'deliberately malformed APK bytes',
  verifier_results: {
    candidate_identity: candidateReceipt.result,
    package_identity: {
      result: packageReceipt.result,
      reason_codes: packageReceipt.reason_codes,
      receipt_digest: receiptDigest(packageReceipt),
    },
    security_static: {
      result: securityReceipt.result,
      reason_codes: securityReceipt.reason_codes,
      receipt_digest: receiptDigest(securityReceipt),
    },
    privacy_static: {
      result: privacyReceipt.result,
      reason_codes: privacyReceipt.reason_codes,
      receipt_digest: receiptDigest(privacyReceipt),
    },
  },
  gatekeeper: {
    status: issuance.status,
    reason: issuance.evaluation?.reason || issuance.reason || null,
    detail: issuance.evaluation?.detail || issuance.detail || null,
    clearance_issued: Boolean(issuance.clearance),
  },
  broker: {
    status: broker.status,
    reason: broker.reason,
    materialized: broker.materialized,
  },
  assertions: {
    defective_android_candidate_denied: issuance.status === 'DENY',
    clearance_not_issued: !issuance.clearance,
    founder_qa_handoff_denied: broker.status === 'DENY',
    apk_not_materialized: broker.materialized === false,
  },
};

rmSync(defectiveApkPath, { force: true });
const handoffFiles = existsSync(handoffDir) ? readdirSync(handoffDir) : [];
proof.assertions.no_apk_in_handoff = !handoffFiles.some((name) => name.toLowerCase().endsWith('.apk'));

const pass = Object.values(proof.assertions).every(Boolean)
  && packageReceipt.result === 'FAIL'
  && packageReceipt.reason_codes.includes('APK_STATIC_INSPECTION_FAILED');

writeFileSync(resolve(outputDir, 'midnight-lens-founder-qa-negative-boundary.proof.json'), JSON.stringify(proof, null, 2));

if (!pass) {
  console.error(JSON.stringify(proof, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(proof, null, 2));
