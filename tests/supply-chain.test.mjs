import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifySbom } from '../scripts/verify-sbom.mjs';

const valid = { bomFormat: 'CycloneDX', specVersion: '1.7', version: 1,
  components: [{ type: 'library', name: 'example-package', version: '1.0.0',
    'bom-ref': 'pkg:npm/example-package@1.0.0' }] };

test('SBOM contract rejects missing metadata, empty lists and bad components', () => {
  assert.equal(verifySbom(valid), 1);
  for (const wrong of [
    null, [], {}, { ...valid, bomFormat: 'SPDX' },
    { ...valid, version: 0 }, { ...valid, components: [] },
    { ...valid, components: [{ name: 'package' }] },
    { ...valid, components: [valid.components[0], valid.components[0]] },
  ]) assert.throws(() => verifySbom(wrong));
});
test('CI blocks dependency risk and emits auditable SBOM artifact', () => {
  const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const dependabot = readFileSync(new URL('../.github/dependabot.yml', import.meta.url), 'utf8');
  assert.match(ci, /pnpm install --frozen-lockfile/);
  assert.match(ci, /pnpm audit --audit-level high/);
  assert.match(ci, /pnpm sbom --sbom-format cyclonedx --lockfile-only/);
  assert.match(ci, /node scripts\\/verify-sbom.mjs sbom.cdx.json/);
  assert.match(ci, /upload-artifact@v4/);
  assert.match(dependabot, /package-ecosystem: "npm"/);
  assert.match(dependabot, /package-ecosystem: "github-actions"/);
});
