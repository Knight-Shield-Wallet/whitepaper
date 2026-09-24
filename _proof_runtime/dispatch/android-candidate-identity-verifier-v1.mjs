import { randomUUID } from 'node:crypto';
import {
  PROOF_SCHEMA_VERSION,
  sha256Bytes,
  sha256Object,
  signProofObject,
} from './proof-gatekeeper-v1.mjs';

const IMPLEMENTATION_ID = Object.freeze({
  service: 'android-candidate-identity-verifier-v1',
  version: 1,
});

export const ANDROID_CANDIDATE_IDENTITY_IMPLEMENTATION_DIGEST = sha256Object(IMPLEMENTATION_ID);

function requireNonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`ANDROID_CANDIDATE_IDENTITY:MISSING_${field.toUpperCase()}`);
  }
}

function requireCandidateBytes(candidateBytes) {
  if (!Buffer.isBuffer(candidateBytes) && !(candidateBytes instanceof Uint8Array)) {
    throw new Error('ANDROID_CANDIDATE_IDENTITY:CANDIDATE_BYTES_REQUIRED');
  }
}

function requireSession(session) {
  if (!session || typeof session !== 'object') {
    throw new Error('ANDROID_CANDIDATE_IDENTITY:SESSION_REQUIRED');
  }
  requireNonEmptyString(session.session_id, 'session_id');
  requireNonEmptyString(session.nonce, 'session_nonce');
  requireNonEmptyString(session.candidate_digest, 'candidate_digest');
  requireNonEmptyString(session.release_class, 'release_class');
  requireNonEmptyString(session.manifest_digest, 'manifest_digest');
  requireNonEmptyString(session.policy_version, 'policy_version');
  if (!['android_founder_qa', 'android_release'].includes(session.release_class)) {
    throw new Error(`ANDROID_CANDIDATE_IDENTITY:UNSUPPORTED_RELEASE_CLASS:${session.release_class}`);
  }
}

export function verifyAndroidCandidateIdentity({
  candidateBytes,
  session,
  verifierKeyId,
  verifierPrivateKey,
  sourceRef,
  now = new Date(),
  ttlSeconds = 600,
}) {
  requireCandidateBytes(candidateBytes);
  requireSession(session);
  requireNonEmptyString(verifierKeyId, 'verifier_key_id');
  requireNonEmptyString(sourceRef, 'source_ref');
  if (!verifierPrivateKey) throw new Error('ANDROID_CANDIDATE_IDENTITY:VERIFIER_PRIVATE_KEY_REQUIRED');
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error('ANDROID_CANDIDATE_IDENTITY:INVALID_TTL');
  }

  const observedDigest = sha256Bytes(candidateBytes);
  const digestMatchesSession = observedDigest === session.candidate_digest;
  const findings = Object.freeze({
    observed_sha256: observedDigest,
    expected_sha256: session.candidate_digest,
    byte_length: candidateBytes.byteLength,
    source_ref: sourceRef,
    digest_matches_session: digestMatchesSession,
  });
  const issuedAt = new Date(now);

  return signProofObject({
    schema_version: PROOF_SCHEMA_VERSION,
    receipt_id: randomUUID(),
    gate_id: 'candidate_identity',
    gate_implementation_digest: ANDROID_CANDIDATE_IDENTITY_IMPLEMENTATION_DIGEST,
    policy_version: session.policy_version,
    manifest_digest: session.manifest_digest,
    candidate_digest: session.candidate_digest,
    release_class: session.release_class,
    session_id: session.session_id,
    session_nonce: session.nonce,
    verifier_key_id: verifierKeyId,
    evidence_classes: ['MACHINE'],
    evidence_refs: [sourceRef],
    evidence_hashes: [sha256Object(findings)],
    findings,
    result: digestMatchesSession ? 'PASS' : 'FAIL',
    reason_codes: [digestMatchesSession ? 'CANDIDATE_DIGEST_MATCH' : 'CANDIDATE_DIGEST_MISMATCH'],
    depends_on: [],
    issued_at: issuedAt.toISOString(),
    expires_at: new Date(issuedAt.getTime() + ttlSeconds * 1000).toISOString(),
  }, verifierPrivateKey);
}
