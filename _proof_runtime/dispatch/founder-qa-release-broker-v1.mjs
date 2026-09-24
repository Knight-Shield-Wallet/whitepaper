import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { brokerAuthorizeDistribution } from './proof-gatekeeper-v1.mjs';

export function founderQaHandoffBoundary({
  candidateBytes,
  clearance,
  gatekeeperPublicKeyStore,
  spentNonces,
  outputDir,
  filename,
  now = new Date(),
}) {
  if (!clearance) {
    return Object.freeze({ status: 'DENY', reason: 'CLEARANCE_MISSING', materialized: false, output_path: null });
  }

  const authorization = brokerAuthorizeDistribution({
    candidateBytes,
    clearance,
    expectedChannel: 'founder_qa_handoff',
    gatekeeperPublicKeyStore,
    spentNonces,
    now,
  });

  if (authorization.status !== 'ALLOW') {
    return Object.freeze({ ...authorization, materialized: false, output_path: null });
  }

  mkdirSync(resolve(outputDir), { recursive: true });
  const outputPath = resolve(outputDir, filename);
  writeFileSync(outputPath, candidateBytes);

  return Object.freeze({
    ...authorization,
    materialized: true,
    output_path: outputPath,
  });
}
