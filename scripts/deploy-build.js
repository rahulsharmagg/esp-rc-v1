import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

function run(cmd) {
  console.log(`\x1b[36m> ${cmd}\x1b[0m`);
  execSync(cmd, { stdio: 'inherit' });
}

try {
  console.log('\n🔨 1. Building production assets...');
  run('npm run build');

  const tempWorktreeDir = path.join(process.env.TEMP || '/tmp', 'esp-rc-build-tree');

  if (fs.existsSync(tempWorktreeDir)) {
    try {
      run(`git worktree remove --force "${tempWorktreeDir}"`);
    } catch {}
    fs.rmSync(tempWorktreeDir, { recursive: true, force: true });
  }

  console.log('\n🌿 2. Preparing build branch worktree...');
  run(`git worktree add -B build "${tempWorktreeDir}" origin/build`);

  console.log('\n📂 3. Synchronizing production files...');
  // Wipe old structure from worktree (except .git)
  for (const item of fs.readdirSync(tempWorktreeDir)) {
    if (item === '.git') continue;
    fs.rmSync(path.join(tempWorktreeDir, item), { recursive: true, force: true });
  }

  // 1. Copy all compiled static frontend assets to public/
  const distDir = path.resolve('dist');
  const publicDest = path.join(tempWorktreeDir, 'public');
  fs.mkdirSync(publicDest, { recursive: true });
  fs.cpSync(distDir, publicDest, { recursive: true });

  // 2. Copy backend server files
  const prodServerJs = `/**
 * ESP32 RC Car Zero-Dependency Production Server
 * Entry point delegating to modular server structure in /server
 */
const { server, startServer, wsRelay } = require('./server/app.js');

startServer();

module.exports = {
  server,
  startServer,
  wsRelay
};
`;
  fs.writeFileSync(path.join(tempWorktreeDir, 'server.js'), prodServerJs);

  if (fs.existsSync('server')) {
    fs.cpSync('server', path.join(tempWorktreeDir, 'server'), { recursive: true });
  }

  const prodPkg = {
    name: 'esp-rc-production',
    version: '4.0.0',
    private: true,
    main: 'server/app.js',
    type: 'commonjs',
    scripts: {
      start: 'node server/app.js',
      serve: 'node server/app.js'
    },
    dependencies: {
      ws: '^8.22.0'
    }
  };
  fs.writeFileSync(path.join(tempWorktreeDir, 'package.json'), JSON.stringify(prodPkg, null, 2));

  console.log('\n🚀 4. Committing and pushing to origin/build...');
  run(`git -C "${tempWorktreeDir}" add -A`);

  try {
    run(`git -C "${tempWorktreeDir}" commit -m "release: update production build [${new Date().toISOString()}]"`);
    run(`git -C "${tempWorktreeDir}" push origin build`);
    console.log('\n✅ Successfully deployed latest build to "build" branch!');
  } catch {
    console.log('\nℹ️ No changes detected in build output (already up to date).');
  }

  try {
    run(`git worktree remove --force "${tempWorktreeDir}"`);
  } catch {}

} catch (err) {
  console.error('\n❌ Deployment failed:', err.message);
}
