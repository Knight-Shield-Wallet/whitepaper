import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { authorityManifestStore } from './authority-manifest-store.mjs';
import {
  openReleaseSession,
  receiptDigest,
  sha256Bytes,
  verifyProofObject,
} from './proof-gatekeeper-v1.mjs';
import { verifyAndroidCandidateIdentity } from './android-candidate-identity-verifier-v1.mjs';
import {
  verifyAndroidPackageIdentity,
  verifyAndroidSecurityStatic,
  verifyAndroidPrivacyStatic,
} from './android-apk-static-verifiers-v1.mjs';

const [apkArg, outputArg] = process.argv.slice(2);
if (!apkArg || !outputArg) {
  throw new Error('USAGE: node dispatch/run-midnight-lens-founder-qa-static-proof-v1.mjs <apk> <output-json>');
}

const apkPath = resolve(apkArg);
const outputPath = resolve(outputArg);
const bytes = readFileSync(apkPath);
const now = new Date();
const releaseClass = 'midnight_lens_android_founder_qa';

const session = openReleaseSession({
  candidateBytes: bytes,
  releaseClass,
  manifestStore: authorityManifestStore,
  now,
});

const verifier = generateKeyPairSync('ed25519');
const verifierKeyId = `midnight-lens-static-verifier-${randomUUID()}`;

const candidate = verifyAndroidCandidateIdentity({
  candidateBytes: bytes,
  session,
  verifierKeyId,
  verifierPrivateKey: verifier.privateKey,
  sourceRef: `local-build://${basename(apkPath)}`,
  now,
  ttlSeconds: 1800,
});

const common = {
  apkPath,
  session,
  dependencyReceipts: [candidate],
  verifierKeyId,
  verifierPrivateKey: verifier.privateKey,
  now,
  ttlSeconds: 1800,
};

const packageIdentity = verifyAndroidPackageIdentity(common);
const securityStatic = verifyAndroidSecurityStatic(common);
const privacyStatic = verifyAndroidPrivacyStatic(common);

const receipts = [candidate, packageIdentity, securityStatic, privacyStatic];
const signaturesValid = receipts.every((receipt) => verifyProofObject(receipt, verifier.publicKey));

const proof = {
  schema: 'ksd.midnight-lens.android-founder-qa.static-proof.v1',
  source_sha: process.env.GITHUB_SHA || null,
  candidate_sha256: sha256Bytes(bytes),
  candidate_bytes: bytes.length,
  release_class: releaseClass,
  manifest_digest: session.manifest_digest,
  policy_version: session.policy_version,
  verifier_results: Object.fromEntries(receipts.map((receipt) => [
    receipt.gate_id,
    {
      result: receipt.result,
      reason_codes: receipt.reason_codes,
      receipt_digest: receiptDigest(receipt),
      findings: receipt.findings,
    },
  ])),
  signatures_valid: signaturesValid,
  static_stage_pass: signaturesValid && receipts.every((receipt) => receipt.result === 'PASS'),
  gatekeeper_clearance_attempted: false,
  broker_handoff_attempted: false,
  distributable_apk_created: false,
  remaining_required_gates: [
    'guided_proof_surface',
    'rendered_mobile_visual',
    'accessibility_preflight',
  ],
};

mkdirSync(resolve(outputPath, '..'), { recursive: true });
writeFileSync(outputPath, JSON.stringify(proof, null, 2));

console.log(JSON.stringify(proof, null, 2));
if (!proof.static_stage_pass) process.exit(1);
