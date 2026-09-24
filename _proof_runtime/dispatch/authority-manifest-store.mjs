import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const manifestDir = join(here, '..', 'authority', 'proof-manifests');

const MANIFEST_FILES = Object.freeze({
  android_founder_qa: 'android_founder_qa.v1.json',
  android_release: 'android_release.v1.json',
  midnight_lens_android_founder_qa: 'midnight_lens_android_founder_qa.v1.json',
  proof_boundary_canary: 'proof_boundary_canary.v1.json',
});

function readManifest(filename) {
  return JSON.parse(readFileSync(join(manifestDir, filename), 'utf8'));
}

export class AuthorityManifestStore {
  constructor({ directory = manifestDir } = {}) {
    this.directory = directory;
  }

  get(releaseClass) {
    const filename = MANIFEST_FILES[releaseClass];
    if (!filename) return undefined;
    const manifest = JSON.parse(readFileSync(join(this.directory, filename), 'utf8'));
    if (manifest.release_class !== releaseClass) {
      throw new Error(`AUTHORITY_MANIFEST:CLASS_MISMATCH:${releaseClass}`);
    }
    return Object.freeze(manifest);
  }

  listReleaseClasses() {
    return Object.freeze(Object.keys(MANIFEST_FILES));
  }
}

export const authorityManifestStore = new AuthorityManifestStore();

// Import-time parse proof: malformed committed authority manifests fail CI immediately.
for (const filename of Object.values(MANIFEST_FILES)) readManifest(filename);
