// Vite plugin: surface files in `Upload DATA/` to the React app.
//
// Dev:
//   - GET /__upload_data_manifest.json  → JSON list of available files
//   - GET /Upload%20DATA/<name>         → streams the file bytes
//
// Build:
//   - Emits the manifest as dist/__upload_data_manifest.json
//   - Copies every .xlsx / .xls / .pdf into dist/Upload DATA/<name>
//
// The frontend treats the manifest URL identically in dev and prod.

import fs from 'node:fs';
import path from 'node:path';

const FOLDER = 'Upload DATA';
const MANIFEST_PATH = '/__upload_data_manifest.json';
const FILE_PREFIX = `/${FOLDER}/`;
const ALLOWED_EXT = /\.(xlsx|xls|pdf)$/i;
const SYNTHETIC_GA4_SAMPLE = {
  name: 'leapfrog-2025-synthetic.xlsx',
  source: path.join('sample-data', 'synthetic_ga4.xlsx'),
};

const CONTENT_TYPES = {
  '.xlsx':
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.pdf': 'application/pdf',
};

function contentTypeFor(filename) {
  const ext = path.extname(filename).toLowerCase();
  return CONTENT_TYPES[ext] || 'application/octet-stream';
}

function toManifestEntry(file) {
  const { sourceFull, ...publicEntry } = file;
  return publicEntry;
}

function listFiles(rootDir) {
  const dir = path.resolve(rootDir, FOLDER);
  const files = fs.existsSync(dir)
    ? fs
      .readdirSync(dir)
      .filter((name) => ALLOWED_EXT.test(name) && !name.startsWith('.'))
      .map((name) => {
        const full = path.join(dir, name);
        const stat = fs.statSync(full);
        return {
          name,
          url: `${FILE_PREFIX}${encodeURIComponent(name)}`,
          size: stat.size,
          modified: stat.mtimeMs,
          modified_iso: new Date(stat.mtimeMs).toISOString(),
          sourceFull: full,
        };
      })
    : [];

  const sampleFull = path.resolve(rootDir, SYNTHETIC_GA4_SAMPLE.source);
  const hasSyntheticWorkbook = files.some(
    (file) => file.name === SYNTHETIC_GA4_SAMPLE.name,
  );

  if (!hasSyntheticWorkbook && fs.existsSync(sampleFull)) {
    const stat = fs.statSync(sampleFull);
    files.push({
      name: SYNTHETIC_GA4_SAMPLE.name,
      url: `${FILE_PREFIX}${encodeURIComponent(SYNTHETIC_GA4_SAMPLE.name)}`,
      size: stat.size,
      modified: stat.mtimeMs,
      modified_iso: new Date(stat.mtimeMs).toISOString(),
      sourceFull: sampleFull,
    });
  }

  return files.sort((a, b) => b.modified - a.modified);
}

function findUploadDataFile(rootDir, filename) {
  const uploadFull = path.resolve(rootDir, FOLDER, filename);
  if (fs.existsSync(uploadFull)) return uploadFull;

  if (filename === SYNTHETIC_GA4_SAMPLE.name) {
    const sampleFull = path.resolve(rootDir, SYNTHETIC_GA4_SAMPLE.source);
    if (fs.existsSync(sampleFull)) return sampleFull;
  }

  return null;
}

function listManifestFiles(rootDir) {
  return listFiles(rootDir).map(toManifestEntry);
}

export function uploadDataPlugin() {
  let rootDir = process.cwd();

  return {
    name: 'leapfrog-upload-data',

    configResolved(cfg) {
      rootDir = cfg.root || process.cwd();
    },

    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url || '';

        if (url.startsWith(MANIFEST_PATH)) {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify(listManifestFiles(rootDir)));
          return;
        }

        const decoded = decodeURIComponent(url.split('?')[0]);
        if (decoded.startsWith(FILE_PREFIX)) {
          const filename = decoded.slice(FILE_PREFIX.length);
          if (!filename || filename.includes('..') || filename.includes('/')) {
            res.statusCode = 400;
            res.end('Bad request');
            return;
          }
          if (!ALLOWED_EXT.test(filename)) {
            res.statusCode = 415;
            res.end('Unsupported file type');
            return;
          }
          const file = findUploadDataFile(rootDir, filename);
          if (!file) {
            res.statusCode = 404;
            res.end('Not found');
            return;
          }
          res.setHeader('Content-Type', contentTypeFor(filename));
          res.setHeader(
            'Content-Disposition',
            `inline; filename="${encodeURIComponent(filename)}"`,
          );
          res.setHeader('Cache-Control', 'no-store');
          fs.createReadStream(file).pipe(res);
          return;
        }

        next();
      });
    },

    generateBundle() {
      const files = listFiles(rootDir);
      this.emitFile({
        type: 'asset',
        fileName: '__upload_data_manifest.json',
        source: JSON.stringify(files.map(toManifestEntry)),
      });
      for (const file of files) {
        try {
          this.emitFile({
            type: 'asset',
            fileName: `${FOLDER}/${file.name}`,
            source: fs.readFileSync(file.sourceFull),
          });
        } catch (err) {
          this.warn(`Failed to bundle ${file.name}: ${err.message}`);
        }
      }
    },
  };
}
