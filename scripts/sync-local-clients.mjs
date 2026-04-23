import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');

const packages = [
  {
    name: 'chill-sharp-ts-client',
    sourcePath: resolve(projectRoot, 'vendor', 'chill-sharp-ts-client'),
    installedPath: resolve(projectRoot, 'node_modules', 'chill-sharp-ts-client')
  },
  {
    name: 'chill-sharp-ng-client',
    sourcePath: resolve(projectRoot, 'vendor', 'chill-sharp-ng-client'),
    installedPath: resolve(projectRoot, 'node_modules', 'chill-sharp-ng-client')
  }
];

const watchedEntries = ['src', 'dist', 'package.json', 'tsconfig.json', 'README.md'];

function latestModifiedAt(targetPath) {
  if (!existsSync(targetPath)) {
    return 0;
  }

  const stats = statSync(targetPath);
  if (!stats.isDirectory()) {
    return stats.mtimeMs;
  }

  let latest = stats.mtimeMs;
  for (const entry of readdirSync(targetPath, { withFileTypes: true })) {
    if (entry.name === 'node_modules') {
      continue;
    }

    latest = Math.max(latest, latestModifiedAt(join(targetPath, entry.name)));
  }

  return latest;
}

function packageModifiedAt(rootPath) {
  return watchedEntries.reduce((latest, entry) => {
    return Math.max(latest, latestModifiedAt(join(rootPath, entry)));
  }, 0);
}

function needsSync(pkg) {
  if (!existsSync(pkg.installedPath)) {
    return true;
  }

  return packageModifiedAt(pkg.sourcePath) > packageModifiedAt(pkg.installedPath);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: false
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function hasStaleAngularOptimizedClientCache() {
  const cacheRoot = resolve(projectRoot, '.angular', 'cache');
  if (!existsSync(cacheRoot)) {
    return false;
  }

  const stack = [cacheRoot];
  while (stack.length > 0) {
    const currentPath = stack.pop();
    if (!currentPath) {
      continue;
    }

    const stats = statSync(currentPath);
    if (stats.isDirectory()) {
      for (const entry of readdirSync(currentPath, { withFileTypes: true })) {
        stack.push(join(currentPath, entry.name));
      }
      continue;
    }

    if (!currentPath.endsWith(`${join('vite', 'deps', 'chill-sharp-ng-client.js')}`)) {
      continue;
    }

    const contents = readFileSync(currentPath, 'utf8');
    if (
      contents.includes('getSchema(chillType, chillViewCode, cultureName)') &&
      !contents.includes('getSchema(chillType, chillViewCode, cultureName, update = false)')
    ) {
      return true;
    }
  }

  return false;
}

const packagesToSync = packages.filter(needsSync);
const shouldCleanAngularCache = packagesToSync.length > 0 || hasStaleAngularOptimizedClientCache();
if (packagesToSync.length === 0 && !shouldCleanAngularCache) {
  process.exit(0);
}

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

if (packagesToSync.length > 0) {
  console.log(`[sync-local-clients] Refreshing ${packagesToSync.map((pkg) => pkg.name).join(', ')}`);

  run(npmCommand, [
    'install',
    '--no-save',
    ...packages.map((pkg) => pkg.sourcePath)
  ]);
}

if (shouldCleanAngularCache) {
  console.log('[sync-local-clients] Cleaning Angular cache');

  run(process.execPath, [
    resolve(projectRoot, 'node_modules', '@angular', 'cli', 'bin', 'ng.js'),
    'cache',
    'clean'
  ]);
}
