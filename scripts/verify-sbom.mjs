import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function verifySbom(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document) ||
      document.bomFormat !== 'CycloneDX' ||
      typeof document.specVersion !== 'string' ||
      !/^1\.[4-9]$/.test(document.specVersion) ||
      !Number.isInteger(document.version) || document.version < 1 ||
      !Array.isArray(document.components) || document.components.length === 0) {
    throw new Error('Generated dependency SBOM is missing or invalid.');
  }
  const keys = new Set();
  for (const component of document.components) {
    if (!component || typeof component !== 'object' ||
        typeof component.name !== 'string' || !component.name ||
        typeof component.version !== 'string' || !component.version) {
      throw new Error('Generated dependency SBOM contains invalid components.');
    }
    if (typeof component['bom-ref'] === 'string') {
      if (keys.has(component['bom-ref'])) throw new Error('Duplicate SBOM component reference.');
      keys.add(component['bom-ref']);
    }
  }
  return document.components.length;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const document = JSON.parse(readFileSync(process.argv[2] || 'sbom.cdx.json', 'utf8'));
    const count = verifySbom(document);
    process.stdout.write(`Verified CycloneDX SBOM with ${count} components.\n`);
  } catch {
    process.stderr.write('Dependency SBOM verification failed.\n');
    process.exitCode = 1;
  }
}
