import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  test(`${signal} during stack startup stops the disposable stack`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'e2e-signal-test-'));
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    mkdirSync(join(dir, 'node_modules/.bin'), { recursive: true });
    const executable = (path: string, content: string) => writeFileSync(path, content, { mode: 0o755 });
    executable(join(bin, 'docker'), '#!/bin/sh\necho \'[{"Endpoints":{"docker":{"Host":"unix:///tmp/docker.sock"}}}]\'\n');
    executable(join(dir, 'node_modules/.bin/supabase'), `#!/bin/sh\ncase "$1" in\ninit) mkdir -p "$3/supabase"; printf 'project_id = "x"\\n[db.migrations]\\nenabled = true\\n[db.seed]\\nenabled = true\\n' > "$3/supabase/config.toml";;\nstart) touch "${dir}/started"; exec sleep 60;;\nstop) touch "${dir}/stopped";;\nesac\n`);
    const child = spawn(process.execPath, [resolve('scripts/e2e.mjs')], { cwd: dir, env: { PATH: `${bin}:${process.env.PATH}`, HOME: dir, NODE_ENV: 'test' }, stdio: 'ignore' });
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
    try {
      for (let i = 0; i < 200 && !existsSync(join(dir, 'started')); i++) await delay(10);
      assert.ok(existsSync(join(dir, 'started')), 'startup reached');
      child.kill(signal);
      const result = await Promise.race([exited, delay(5000).then(() => { throw new Error('teardown timed out'); })]);
      assert.equal(result.code, signal === 'SIGINT' ? 130 : 143);
      assert.ok(existsSync(join(dir, 'stopped')), 'stack stopped');
    } finally {
      child.kill('SIGKILL');
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
