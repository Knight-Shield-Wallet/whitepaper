import { createHash, randomUUID, sign as signData, verify as verifyData } from 'node:crypto';

export const PROOF_SCHEMA_VERSION = 'ksd.proof-receipt.v1';
export const CLEARANCE_SCHEMA_VERSION = 'ksd.release-clearance.v1';
export const EVIDENCE_CLASSES = Object.freeze(['MACHINE', 'TOOL', 'HUMAN', 'AI_JUDGMENT']);

const RECEIPT_FIELDS = new Set([
  'schema_version', 'receipt_id', 'gate_id', 'gate_implementation_digest',
  'policy_version', 'manifest_digest', 'candidate_digest', 'release_class',
  'session_id', 'session_nonce', 'verifier_key_id', 'evidence_classes', 'evidence_refs',
  'evidence_hashes', 'findings', 'result', 'reason_codes', 'depends_on',
  'issued_at', 'expires_at', 'signature'
]);

const CLEARANCE_FIELDS = new Set([
  'schema_version', 'clearance_id', 'candidate_digest', 'release_class',
  'channel', 'manifest_digest', 'policy_version', 'session_id', 'session_nonce',
  'receipt_digests', 'gate_results', 'gatekeeper_implementation_digest',
  'gatekeeper_key_id', 'issued_at', 'expires_at', 'nonce', 'signature'
]);

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

// Deterministic JSON for KSD proof objects. This is intentionally not claimed as full RFC 8785 JCS.
export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function sha256Object(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function b64url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

function fromB64url(value) {
  return Buffer.from(String(value), 'base64url');
}

function withoutSignature(value) {
  const next = { ...value };
  delete next.signature;
  return next;
}

export function signProofObject(value, privateKey) {
  const unsigned = withoutSignature(value);
  const signature = signData(null, Buffer.from(canonicalJson(unsigned)), privateKey);
  return Object.freeze({ ...unsigned, signature: b64url(signature) });
}

export function verifyProofObject(value, publicKey) {
  if (!value?.signature || !publicKey) return false;
  return verifyData(
    null,
    Buffer.from(canonicalJson(withoutSignature(value))),
    publicKey,
    fromB64url(value.signature),
  );
}

function assertExactFields(object, allowed, code) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) throw new Error(`${code}:INVALID_OBJECT`);
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) throw new Error(`${code}:UNKNOWN_FIELD:${key}`);
  }
}

function requireString(value, field, code) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${code}:MISSING_${field.toUpperCase()}`);
}

function requireSha256(value, field, code) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error(`${code}:INVALID_${field.toUpperCase()}`);
  }
}

function requireStringArray(value, field, code, { nonEmpty = true } = {}) {
  if (!Array.isArray(value) || (nonEmpty && value.length === 0) || value.some((item) => typeof item !== 'string' || item.trim() === '')) {
    throw new Error(`${code}:INVALID_${field.toUpperCase()}`);
  }
}

function parseTime(value, field, code) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new Error(`${code}:INVALID_${field.toUpperCase()}`);
  return time;
}

function manifestDigest(manifest) {
  return sha256Object(manifest);
}

function normalizedManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('GATEKEEPER:MANIFEST_MISSING');
  requireString(manifest.release_class, 'release_class', 'GATEKEEPER');
  requireString(manifest.policy_version, 'policy_version', 'GATEKEEPER');
  requireStringArray(manifest.allowed_channels, 'allowed_channels', 'GATEKEEPER');
  if (new Set(manifest.allowed_channels).size !== manifest.allowed_channels.length) throw new Error('GATEKEEPER:DUPLICATE_CHANNEL');
  if (!Array.isArray(manifest.required_gates) || manifest.required_gates.length === 0) {
    throw new Error('GATEKEEPER:EMPTY_MANIFEST');
  }

  const ids = new Set();
  for (const gate of manifest.required_gates) {
    requireString(gate?.gate_id, 'gate_id', 'GATEKEEPER');
    if (ids.has(gate.gate_id)) throw new Error(`GATEKEEPER:DUPLICATE_GATE:${gate.gate_id}`);
    ids.add(gate.gate_id);
    requireStringArray(gate.allowed_evidence_classes, 'allowed_evidence_classes', 'GATEKEEPER');
    for (const evidenceClass of gate.allowed_evidence_classes) {
      if (!EVIDENCE_CLASSES.includes(evidenceClass)) throw new Error(`GATEKEEPER:UNKNOWN_EVIDENCE_CLASS:${gate.gate_id}:${evidenceClass}`);
    }
    const required = gate.required_evidence_classes ?? [];
    requireStringArray(required, 'required_evidence_classes', 'GATEKEEPER', { nonEmpty: false });
    for (const evidenceClass of required) {
      if (!gate.allowed_evidence_classes.includes(evidenceClass)) {
        throw new Error(`GATEKEEPER:REQUIRED_EVIDENCE_NOT_ALLOWED:${gate.gate_id}:${evidenceClass}`);
      }
    }
    const dependencies = gate.depends_on ?? [];
    requireStringArray(dependencies, 'depends_on', 'GATEKEEPER', { nonEmpty: false });
    if (dependencies.includes(gate.gate_id)) throw new Error(`GATEKEEPER:SELF_DEPENDENCY:${gate.gate_id}`);
  }

  for (const gate of manifest.required_gates) {
    for (const dependency of gate.depends_on ?? []) {
      if (!ids.has(dependency)) throw new Error(`GATEKEEPER:UNKNOWN_DEPENDENCY:${gate.gate_id}->${dependency}`);
    }
  }

  const graph = new Map(manifest.required_gates.map((gate) => [gate.gate_id, gate.depends_on ?? []]));
  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) throw new Error(`GATEKEEPER:DEPENDENCY_CYCLE:${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dep of graph.get(id) ?? []) visit(dep);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of graph.keys()) visit(id);
  return manifest;
}

function validateCandidateBytes(candidateBytes, code) {
  if (!Buffer.isBuffer(candidateBytes) && !(candidateBytes instanceof Uint8Array)) {
    throw new Error(`${code}:CANDIDATE_BYTES_REQUIRED`);
  }
}

export function openReleaseSession({ candidateBytes, releaseClass, manifestStore, now = new Date() }) {
  validateCandidateBytes(candidateBytes, 'GATEKEEPER');
  requireString(releaseClass, 'release_class', 'GATEKEEPER');
  const manifest = normalizedManifest(manifestStore?.get?.(releaseClass));
  if (manifest.release_class !== releaseClass) throw new Error('GATEKEEPER:UNKNOWN_RELEASE_CLASS');
  const candidateDigest = sha256Bytes(candidateBytes);
  return Object.freeze({
    session_id: randomUUID(),
    nonce: randomUUID(),
    candidate_digest: candidateDigest,
    release_class: releaseClass,
    manifest_digest: manifestDigest(manifest),
    policy_version: manifest.policy_version,
    opened_at: new Date(now).toISOString(),
  });
}

export function receiptDigest(receipt) {
  return sha256Object(receipt);
}

export function evaluateReleaseClearance({
  session,
  manifestStore,
  ledger,
  verifierKeyStore,
  revokedVerifierKeys = new Set(),
  revokedImplementations = new Set(),
  now = new Date(),
}) {
  const deny = (reason, detail = null) => Object.freeze({ status: 'DENY', reason, detail });
  try {
    if (!session) return deny('SESSION_MISSING');
    requireString(session.session_id, 'session_id', 'SESSION');
    requireString(session.nonce, 'nonce', 'SESSION');
    requireSha256(session.candidate_digest, 'candidate_digest', 'SESSION');
    const openedAt = parseTime(session.opened_at, 'opened_at', 'SESSION');

    const manifest = normalizedManifest(manifestStore?.get?.(session.release_class));
    if (manifest.release_class !== session.release_class) return deny('UNKNOWN_RELEASE_CLASS');
    const expectedManifestDigest = manifestDigest(manifest);
    if (session.manifest_digest !== expectedManifestDigest) return deny('MANIFEST_DRIFT');
    if (session.policy_version !== manifest.policy_version) return deny('POLICY_VERSION_DRIFT');

    const receipts = ledger?.listReceiptsForSession?.(session.session_id);
    if (!Array.isArray(receipts)) return deny('LEDGER_UNAVAILABLE');
    const byGate = new Map();
    const requiredGateIds = new Set(manifest.required_gates.map((gate) => gate.gate_id));

    for (const receipt of receipts) {
      assertExactFields(receipt, RECEIPT_FIELDS, 'RECEIPT');
      if (receipt.schema_version !== PROOF_SCHEMA_VERSION) return deny('RECEIPT_SCHEMA_INVALID', receipt.gate_id ?? null);
      requireString(receipt.receipt_id, 'receipt_id', 'RECEIPT');
      requireString(receipt.gate_id, 'gate_id', 'RECEIPT');
      requireSha256(receipt.candidate_digest, 'candidate_digest', 'RECEIPT');
      requireString(receipt.session_id, 'session_id', 'RECEIPT');
      requireString(receipt.session_nonce, 'session_nonce', 'RECEIPT');
      requireString(receipt.verifier_key_id, 'verifier_key_id', 'RECEIPT');
      requireSha256(receipt.gate_implementation_digest, 'gate_implementation_digest', 'RECEIPT');
      requireStringArray(receipt.evidence_classes, 'evidence_classes', 'RECEIPT');
      requireStringArray(receipt.evidence_refs, 'evidence_refs', 'RECEIPT');
      requireStringArray(receipt.evidence_hashes, 'evidence_hashes', 'RECEIPT');
      if (receipt.evidence_refs.length !== receipt.evidence_hashes.length) return deny('EVIDENCE_REFERENCE_HASH_MISMATCH', receipt.gate_id);
      for (const hash of receipt.evidence_hashes) requireSha256(hash, 'evidence_hash', 'RECEIPT');
      if (!requiredGateIds.has(receipt.gate_id)) return deny('UNEXPECTED_GATE_RECEIPT', receipt.gate_id);
      if (receipt.session_id !== session.session_id) return deny('SESSION_MISMATCH', receipt.gate_id);
      if (receipt.session_nonce !== session.nonce) return deny('SESSION_NONCE_MISMATCH', receipt.gate_id);
      if (receipt.candidate_digest !== session.candidate_digest) return deny('CANDIDATE_MISMATCH', receipt.gate_id);
      if (receipt.release_class !== session.release_class) return deny('RELEASE_CLASS_MISMATCH', receipt.gate_id);
      if (receipt.manifest_digest !== session.manifest_digest) return deny('MANIFEST_MISMATCH', receipt.gate_id);
      if (receipt.policy_version !== session.policy_version) return deny('POLICY_MISMATCH', receipt.gate_id);
      if (receipt.result !== 'PASS') return deny('REQUIRED_GATE_NOT_PASS', receipt.gate_id);
      if (revokedVerifierKeys.has(receipt.verifier_key_id)) return deny('REVOKED_VERIFIER', receipt.gate_id);
      if (revokedImplementations.has(receipt.gate_implementation_digest)) return deny('REVOKED_IMPLEMENTATION', receipt.gate_id);
      const issuedAt = parseTime(receipt.issued_at, 'issued_at', 'RECEIPT');
      const expiresAt = parseTime(receipt.expires_at, 'expires_at', 'RECEIPT');
      if (issuedAt < openedAt) return deny('RECEIPT_PREDATES_SESSION', receipt.gate_id);
      if (expiresAt <= issuedAt) return deny('RECEIPT_TIME_RANGE_INVALID', receipt.gate_id);
      if (expiresAt <= new Date(now).getTime()) return deny('RECEIPT_EXPIRED', receipt.gate_id);

      const publicKey = verifierKeyStore?.get?.(receipt.verifier_key_id);
      if (!publicKey) return deny('UNTRUSTED_VERIFIER', receipt.gate_id);
      if (!verifyProofObject(receipt, publicKey)) return deny('SIGNATURE_MISMATCH', receipt.gate_id);
      if (byGate.has(receipt.gate_id)) return deny('DUPLICATE_GATE_RECEIPT', receipt.gate_id);
      byGate.set(receipt.gate_id, receipt);
    }

    for (const gate of manifest.required_gates) {
      const receipt = byGate.get(gate.gate_id);
      if (!receipt) return deny('MISSING_REQUIRED_RECEIPT', gate.gate_id);
      for (const evidenceClass of receipt.evidence_classes) {
        if (!gate.allowed_evidence_classes.includes(evidenceClass)) return deny('EVIDENCE_CLASS_NOT_ALLOWED', `${gate.gate_id}:${evidenceClass}`);
      }
      for (const requiredClass of gate.required_evidence_classes ?? []) {
        if (!receipt.evidence_classes.includes(requiredClass)) return deny('EVIDENCE_CLASS_INSUFFICIENT', `${gate.gate_id}:${requiredClass}`);
      }
      if (gate.minimum_implementation_digest) {
        requireSha256(gate.minimum_implementation_digest, 'minimum_implementation_digest', 'GATEKEEPER');
        if (receipt.gate_implementation_digest !== gate.minimum_implementation_digest) return deny('VERSION_DOWNGRADE', gate.gate_id);
      }
      for (const dependency of gate.depends_on ?? []) {
        const depReceipt = byGate.get(dependency);
        if (!depReceipt) return deny('DEPENDENCY_UNSATISFIED', `${gate.gate_id}->${dependency}`);
        if (!Array.isArray(receipt.depends_on) || !receipt.depends_on.includes(receiptDigest(depReceipt))) {
          return deny('DEPENDENCY_RECEIPT_MISMATCH', `${gate.gate_id}->${dependency}`);
        }
      }
    }

    return Object.freeze({
      status: 'PASS',
      reason: 'MANIFEST_SATISFIED',
      candidate_digest: session.candidate_digest,
      release_class: session.release_class,
      session_id: session.session_id,
      session_nonce: session.nonce,
      manifest_digest: session.manifest_digest,
      policy_version: session.policy_version,
      manifest,
      receipt_digests: manifest.required_gates.map((gate) => receiptDigest(byGate.get(gate.gate_id))),
      gate_results: Object.fromEntries(manifest.required_gates.map((gate) => [gate.gate_id, 'PASS'])),
    });
  } catch (error) {
    return deny('INTERNAL_ERROR_FAIL_CLOSED', error instanceof Error ? error.message : String(error));
  }
}

function buildReleaseClearance({
  session,
  evaluation,
  channel,
  gatekeeperKeyId,
  gatekeeperPrivateKey,
  gatekeeperImplementationDigest,
  now,
  ttlSeconds,
}) {
  if (evaluation?.status !== 'PASS') throw new Error('CLEARANCE:DENIED');
  if (evaluation.candidate_digest !== session.candidate_digest ||
      evaluation.release_class !== session.release_class ||
      evaluation.session_id !== session.session_id ||
      evaluation.session_nonce !== session.nonce ||
      evaluation.manifest_digest !== session.manifest_digest ||
      evaluation.policy_version !== session.policy_version) {
    throw new Error('CLEARANCE:EVALUATION_BINDING_MISMATCH');
  }
  requireString(channel, 'channel', 'CLEARANCE');
  requireString(gatekeeperKeyId, 'gatekeeper_key_id', 'CLEARANCE');
  requireSha256(gatekeeperImplementationDigest, 'gatekeeper_implementation_digest', 'CLEARANCE');
  const issued = new Date(now);
  const unsigned = {
    schema_version: CLEARANCE_SCHEMA_VERSION,
    clearance_id: randomUUID(),
    candidate_digest: session.candidate_digest,
    release_class: session.release_class,
    channel,
    manifest_digest: session.manifest_digest,
    policy_version: session.policy_version,
    session_id: session.session_id,
    session_nonce: session.nonce,
    receipt_digests: evaluation.receipt_digests,
    gate_results: evaluation.gate_results,
    gatekeeper_implementation_digest: gatekeeperImplementationDigest,
    gatekeeper_key_id: gatekeeperKeyId,
    issued_at: issued.toISOString(),
    expires_at: new Date(issued.getTime() + ttlSeconds * 1000).toISOString(),
    nonce: randomUUID(),
  };
  return signProofObject(unsigned, gatekeeperPrivateKey);
}

// Authority-zone issuance API: it evaluates the authority manifest + ledger itself.
// No caller-supplied PASS object or receipt list can directly mint clearance.
export function gatekeeperIssueReleaseClearance({
  session,
  manifestStore,
  ledger,
  verifierKeyStore,
  revokedVerifierKeys = new Set(),
  revokedImplementations = new Set(),
  channel,
  gatekeeperKeyId,
  gatekeeperPrivateKey,
  gatekeeperImplementationDigest,
  now = new Date(),
  ttlSeconds = 300,
}) {
  const evaluation = evaluateReleaseClearance({
    session,
    manifestStore,
    ledger,
    verifierKeyStore,
    revokedVerifierKeys,
    revokedImplementations,
    now,
  });
  if (evaluation.status !== 'PASS') return Object.freeze({ status: 'DENY', evaluation, clearance: null });
  const manifest = normalizedManifest(manifestStore?.get?.(session.release_class));
  if (!manifest.allowed_channels.includes(channel)) {
    return Object.freeze({ status: 'DENY', evaluation, clearance: null, reason: 'CHANNEL_NOT_AUTHORIZED_BY_MANIFEST' });
  }
  try {
    const clearance = buildReleaseClearance({
      session,
      evaluation,
      channel,
      gatekeeperKeyId,
      gatekeeperPrivateKey,
      gatekeeperImplementationDigest,
      now,
      ttlSeconds,
    });
    return Object.freeze({ status: 'PASS', evaluation, clearance });
  } catch (error) {
    return Object.freeze({ status: 'DENY', evaluation, clearance: null, reason: 'CLEARANCE_ISSUANCE_FAIL_CLOSED', detail: error instanceof Error ? error.message : String(error) });
  }
}

export function brokerAuthorizeDistribution({
  candidateBytes,
  clearance,
  expectedChannel,
  gatekeeperPublicKeyStore,
  spentNonces,
  now = new Date(),
}) {
  const deny = (reason) => Object.freeze({ status: 'DENY', reason });
  try {
    validateCandidateBytes(candidateBytes, 'BROKER');
    requireString(expectedChannel, 'expected_channel', 'BROKER');
    if (!spentNonces || typeof spentNonces.has !== 'function' || typeof spentNonces.add !== 'function') {
      return deny('NONCE_STORE_REQUIRED');
    }
    assertExactFields(clearance, CLEARANCE_FIELDS, 'CLEARANCE');
    if (clearance.schema_version !== CLEARANCE_SCHEMA_VERSION) return deny('CLEARANCE_SCHEMA_INVALID');
    requireSha256(clearance.candidate_digest, 'candidate_digest', 'CLEARANCE');
    requireString(clearance.session_id, 'session_id', 'CLEARANCE');
    requireString(clearance.session_nonce, 'session_nonce', 'CLEARANCE');
    requireString(clearance.nonce, 'nonce', 'CLEARANCE');
    requireString(clearance.gatekeeper_key_id, 'gatekeeper_key_id', 'CLEARANCE');
    requireSha256(clearance.gatekeeper_implementation_digest, 'gatekeeper_implementation_digest', 'CLEARANCE');
    requireStringArray(clearance.receipt_digests, 'receipt_digests', 'CLEARANCE');
    for (const digest of clearance.receipt_digests) requireSha256(digest, 'receipt_digest', 'CLEARANCE');
    if (clearance.channel !== expectedChannel) return deny('CHANNEL_MISMATCH');
    if (sha256Bytes(candidateBytes) !== clearance.candidate_digest) return deny('DIGEST_MISMATCH_AT_DISTRIBUTION');
    const issuedAt = parseTime(clearance.issued_at, 'issued_at', 'CLEARANCE');
    const expiresAt = parseTime(clearance.expires_at, 'expires_at', 'CLEARANCE');
    if (expiresAt <= issuedAt) return deny('CLEARANCE_TIME_RANGE_INVALID');
    if (expiresAt <= new Date(now).getTime()) return deny('CLEARANCE_EXPIRED');
    if (spentNonces.has(clearance.nonce)) return deny('NONCE_SPENT');
    const publicKey = gatekeeperPublicKeyStore?.get?.(clearance.gatekeeper_key_id);
    if (!publicKey) return deny('UNTRUSTED_GATEKEEPER');
    if (!verifyProofObject(clearance, publicKey)) return deny('CLEARANCE_SIGNATURE_MISMATCH');
    spentNonces.add(clearance.nonce);
    return Object.freeze({ status: 'ALLOW', reason: 'CLEARANCE_VALID', candidate_digest: clearance.candidate_digest });
  } catch {
    return deny('INTERNAL_ERROR_FAIL_CLOSED');
  }
}
