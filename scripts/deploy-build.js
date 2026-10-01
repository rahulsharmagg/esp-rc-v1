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
  const distDir = path.resolve('dist');
  fs.cpSync(distDir, tempWorktreeDir, { recursive: true });

  if (fs.existsSync('server.js')) {
    fs.copyFileSync('server.js', path.join(tempWorktreeDir, 'server.js'));
  }

  if (fs.existsSync('firmware')) {
    fs.cpSync('firmware', path.join(tempWorktreeDir, 'firmware'), { recursive: true });
  }

  const prodPkg = {
    name: 'esp-rc-production',
    version: '4.0.0',
    private: true,
    type: 'module',
    scripts: {
      start: 'node server.js',
      serve: 'node server.js'
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
