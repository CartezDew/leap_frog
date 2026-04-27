// Discovery + fetching of files in the project's `Upload DATA/` folder.
//
// The vite plugin in /vite-plugins/upload-data.js exposes:
//   GET /__upload_data_manifest.json  -> [{ name, url, size, modified, modified_iso }]
//   GET /Upload%20DATA/<name>         -> raw bytes
//
// Both endpoints work identically in dev and after `npm run build`.

const MANIFEST_URL = '/__upload_data_manifest.json';

export async function fetchUploadDataManifest() {
  try {
    const res = await fetch(MANIFEST_URL, { cache: 'no-store' });
    if (!res.ok) return [];
    const json = await res.json();
    return Array.isArray(json) ? json : [];
  } catch (err) {
    console.warn('Failed to fetch Upload DATA manifest', err);
    return [];
  }
}

export async function fetchUploadDataFile(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`Failed to load ${url} (HTTP ${res.status})`);
  }
  return await res.arrayBuffer();
}
