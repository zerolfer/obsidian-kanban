import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function validateReleaseMetadata(packageMetadata, manifest, versions) {
  for (const [name, value] of [
    ['package.json', packageMetadata],
    ['manifest.json', manifest],
    ['versions.json', versions],
  ]) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`${name} must contain a JSON object.`);
    }
  }

  const version = packageMetadata.version;
  if (typeof version !== 'string' || !stableVersion.test(version)) {
    throw new Error('package.json must specify a stable version in x.y.z format.');
  }
  if (manifest.version !== version) {
    throw new Error('manifest.json version must match package.json. Run version-bump.mjs when preparing the release.');
  }
  if (typeof manifest.minAppVersion !== 'string' || !stableVersion.test(manifest.minAppVersion)) {
    throw new Error('manifest.json minAppVersion must use x.y.z format.');
  }
  if (!Object.hasOwn(versions, version) || versions[version] !== manifest.minAppVersion) {
    throw new Error(`versions.json must map ${version} to manifest.json minAppVersion (${manifest.minAppVersion}).`);
  }
  return version;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const metadata = ['package.json', 'manifest.json', 'versions.json'].map((name) =>
      JSON.parse(readFileSync(name, 'utf8'))
    );
    console.log(validateReleaseMetadata(...metadata));
  } catch (error) {
    console.error(`Release validation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
