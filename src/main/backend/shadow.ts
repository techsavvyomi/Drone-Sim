import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// A second copy of the license's clock and usage state, kept outside the SQLite
// file. Putting an old copy of the database back would otherwise bring back an
// old usage count and an old last-seen time, and with them offline time that
// was already used. The service seals what it writes here (service.ts) and
// takes the later of this and the database.
//
// macOS: the user's preferences (`defaults`), Windows: the user's registry
// (HKCU\Software\PlutoSim, which the uninstaller removes), elsewhere a file in
// the config folder. Values are base64, so no quoting can break them.

export interface ShadowStore {
  /** The stored value, or null when there is none or it cannot be read. */
  read(): string | null;
  write(value: string): void;
}

const MAC_DOMAIN = 'com.dronaaviation.plutosim.license';
const WIN_KEY = 'HKCU\\Software\\PlutoSim';
const NAME = 'LicenseState';

const run = (cmd: string, args: string[]) =>
  execFileSync(cmd, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    windowsHide: true,
    timeout: 5000,
  });

function decode(b64: string | undefined): string | null {
  if (!b64) return null;
  try {
    return Buffer.from(b64.trim(), 'base64').toString('utf8') || null;
  } catch {
    return null;
  }
}

const encode = (value: string) => Buffer.from(value, 'utf8').toString('base64');

function macShadow(): ShadowStore {
  return {
    read: () => {
      try {
        return decode(run('defaults', ['read', MAC_DOMAIN, NAME]));
      } catch {
        return null;
      }
    },
    write: (value) => {
      run('defaults', ['write', MAC_DOMAIN, NAME, '-string', encode(value)]);
    },
  };
}

function windowsShadow(): ShadowStore {
  return {
    read: () => {
      try {
        // "    LicenseState    REG_SZ    <value>"
        const line = run('reg', ['query', WIN_KEY, '/v', NAME])
          .split(/\r?\n/)
          .find((l) => l.includes(NAME) && l.includes('REG_SZ'));
        return decode(line?.split('REG_SZ')[1]);
      } catch {
        return null;
      }
    },
    write: (value) => {
      run('reg', ['add', WIN_KEY, '/v', NAME, '/t', 'REG_SZ', '/d', encode(value), '/f']);
    },
  };
}

function fileShadow(file: string): ShadowStore {
  return {
    read: () => {
      try {
        return decode(readFileSync(file, 'utf8'));
      } catch {
        return null;
      }
    },
    write: (value) => {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(`${file}.tmp`, encode(value));
      renameSync(`${file}.tmp`, file);
    },
  };
}

/** The shadow store for this computer. `configDir` is used where there is no OS store. */
export function osShadow(configDir: string): ShadowStore {
  if (process.platform === 'darwin') return macShadow();
  if (process.platform === 'win32') return windowsShadow();
  return fileShadow(path.join(configDir, 'plutosim-license-state'));
}
