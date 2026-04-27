// Vite plugin: surface files in `Upload DATA/` to the React app.
//
// Dev:
//   - GET /__upload_data_manifest.json  → JSON list of available files
//   - GET /Upload%20DATA/<name>         → streams the file bytes
//
// Build:
//   - Emits the manifest as dist/__upload_data_manifest.json
//   - Copies every .xlsx / .xls into dist/Upload DATA/<name>
//
// The frontend treats the manifest URL identically in dev and prod.

import fs from 'node:fs';
import path from 'node:path';

const FOLDER = 'Upload DATA';
const MANIFEST_PATH = '/__upload_data_manifest.json';
const FILE_PREFIX = `/${FOLDER}/`;
const ALLOWED_EXT = /\.(xlsx|xls)$/i;

function listFiles(rootDir) {
  const dir = path.resolve(rootDir, FOLDER);
  if (!fs.existsSync(dir)) return [];
  return fs
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
      };
    })
    .sort((a, b) => b.modified - a.modified);
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
          res.end(JSON.stringify(listFiles(rootDir)));
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
          const file = path.resolve(rootDir, FOLDER, filename);
          if (!fs.existsSync(file)) {
            res.statusCode = 404;
            res.end('Not found');
            return;
          }
          res.setHeader(
            'Content-Type',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          );
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
        source: JSON.stringify(files),
      });
      for (const file of files) {
        const full = path.resolve(rootDir, FOLDER, file.name);
        try {
          this.emitFile({
            type: 'asset',
            fileName: `${FOLDER}/${file.name}`,
            source: fs.readFileSync(full),
          });
        } catch (err) {
          this.warn(`Failed to bundle ${file.name}: ${err.message}`);
        }
      }
    },
  };
}
