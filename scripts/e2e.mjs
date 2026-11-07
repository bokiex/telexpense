import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';

const root = resolve('.');
const cli = join(root, 'node_modules/.bin/supabase');
const project = `telexpensee2e${randomBytes(6).toString('hex')}`;
const workdir = mkdtempSync(join(tmpdir(), 'telexpense-e2e-'));
const controller = new AbortController();
let activeChild;
let interrupted;
const terminate = child => {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
  timer.unref();
  child.once('close', () => clearTimeout(timer));
};
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (interrupted) return;
    interrupted = signal;
    process.exitCode = signal === 'SIGINT' ? 130 : 143;
    controller.abort();
    terminate(activeChild);
    terminate(server);
  });
}
const run = (bin, args, options = {}) => new Promise((resolve, reject) => {
  if (controller.signal.aborted) return reject(new Error('Interrupted'));
  const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  activeChild = child;
  let output = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.resume();
  child.on('error', reject);
  child.on('close', code => {
    if (activeChild === child) activeChild = undefined;
    if (controller.signal.aborted || code !== 0) reject(new Error('Command failed or interrupted'));
    else resolve(output);
  });
  child.stdin.on('error', () => {});
  child.stdin.end(options.input);
});
const pause = ms => new Promise((resolve, reject) => {
  if (controller.signal.aborted) return reject(new Error('Interrupted'));
  const timer = setTimeout(() => { controller.signal.removeEventListener('abort', abort); resolve(); }, ms);
  const abort = () => { clearTimeout(timer); reject(new Error('Interrupted')); };
  controller.signal.addEventListener('abort', abort, { once: true });
});
let started = false;
let server;
let serverError;
try {
  // No remote Docker daemon: even creating/deleting a stack must be local.
  const endpoint = JSON.parse(await run('docker', ['context', 'inspect']))[0]?.Endpoints?.docker?.Host;
  if (!endpoint?.startsWith('unix://') || process.env.DOCKER_HOST || process.env.DOCKER_CONTEXT) throw new Error('E2E requires the local Unix Docker context, without Docker overrides');
  for (const file of ['.env', '.env.local', '.env.development', '.env.development.local']) {
    if (existsSync(join(root, file))) throw new Error(`Remove ${file} from this worktree before running E2E; real credentials are not permitted`);
  }
  mkdirSync(join(workdir, 'supabase'));
  // Initialise in a fresh directory, never in the application Supabase project.
  await run(cli, ['init', '--workdir', workdir]);
  const configPath = join(workdir, 'supabase/config.toml');
  let config = readFileSync(configPath, 'utf8');
  config = config.replace(/^project_id = .+$/m, `project_id = "${project}"`)
    .replace(/(\[db\.migrations\][\s\S]*?enabled = )true/, '$1false')
    .replace(/(\[db\.seed\][\s\S]*?enabled = )true/, '$1false');
  writeFileSync(configPath, config);
  started = true;
  console.log('Starting disposable local Supabase (first run downloads images)...');
  await run(cli, ['start', '--workdir', workdir, '-x', 'studio,imgproxy,edge-runtime,logflare,vector,mailpit,realtime,storage-api']);
  const name = `supabase_db_${project}`;
  const details = JSON.parse(await run('docker', ['inspect', name]))[0];
  if (details?.Config?.Labels?.['com.supabase.cli.project'] !== project || details?.Config?.Labels?.['com.supabase.cli.workdir'] !== workdir) throw new Error('Cannot verify disposable database container');
  // schema.sql is a fresh-install snapshot containing transactional temp tables.
  const schema = readFileSync(join(root, 'supabase/schema.sql'));
  for (let i = 0; i < 2; i++) {
    await run('docker', ['exec', '-i', name, 'psql', '-1', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'], { input: schema });
  }
  // Exercise the forward migration against legacy violations as well as new
  // inserts/updates. Roll back all synthetic data and DDL before browser tests.
  const domainMigration = readFileSync(join(root, 'supabase/migrations/20261107113216_schema_domain_invariants.sql'), 'utf8');
  const domainFixture = readFileSync(join(root, 'tests-ts/fixtures/schema-domain-invariants.sql'), 'utf8')
    .replaceAll('-- MIGRATION --', () => domainMigration);
  await run('docker', ['exec', '-i', name, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'], { input: `begin;\n${domainFixture}\nrollback;` });

  // Each SQL fixture rolls back DDL and data. Expand its known \ir includes
  // locally because the container has no repo mount. Concurrency fixtures
  // commit setup and need independent connections, so run everything serially
  // on the disposable database before any browser data exists.
  for (const fixture of [
    'budget-schema-repair.sql', 'owner-scoped-references.sql',
    'card-payment-classification.sql', 'card-payment-classification-backfill.sql',
    'card-statement-baselines.sql', 'card-statement-capture-order.sql',
    'recurring-legacy-ownership.sql', 'schema-reapply-legacy-violations.sql',
  ]) {
    console.log(`Running SQL fixture ${fixture}...`);
    const source = readFileSync(join(root, 'tests-sql', fixture), 'utf8');
    const sql = source.replace(/^\\ir \.\.\/supabase\/(schema\.sql|migrations\/[\w.-]+\.sql)[ \t]*$/gm,
      (_, file) => readFileSync(join(root, 'supabase', file), 'utf8'));
    if (/^\\ir\b/m.test(sql)) throw new Error(`Unexpanded SQL include in fixture: ${fixture}`);
    try {
      await run('docker', ['exec', '-i', name, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'], { input: sql });
    } catch { throw new Error(`SQL fixture failed: ${fixture}`); }
  }
  for (const fixture of ['card-statement-concurrency.sh', 'owner-budget-concurrency.sh', 'recurring-materialization-concurrency.sh']) {
    console.log(`Running concurrency fixture ${fixture}...`);
    const script = readFileSync(join(root, 'tests-sql', fixture));
    try {
      await run('docker', ['exec', '-i', name, 'env', '-i', 'PATH=/usr/local/bin:/usr/bin:/bin', 'HOME=/tmp', 'PGUSER=postgres', 'PGDATABASE=postgres', 'bash', '-s'], { input: script });
    } catch { throw new Error(`Concurrency fixture failed: ${fixture}`); }
  }
  await run('docker', ['exec', '-i', name, 'psql', '-1', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'], { input: "grant usage on schema public to service_role; grant all on all tables in schema public to service_role; grant all on all sequences in schema public to service_role; grant execute on all functions in schema public to service_role; insert into public.users (telegram_user_id, first_name) values (900000000001, 'Synthetic'), (900000000002, 'Synthetic'), (900000000003, 'Synthetic'); notify pgrst, 'reload schema';" });
  const status = await run(cli, ['status', '--workdir', workdir, '-o', 'env']);
  const values = Object.fromEntries(status.trim().split('\n').map(line => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1).replace(/^"|"$/g, '')]; }));
  if (values.API_URL !== 'http://127.0.0.1:54321' || !values.SERVICE_ROLE_KEY) throw new Error('Unverifiable local Supabase API target');
  let schemaReady = false;
  for (let i = 0; i < 30; i++) {
    const response = await fetch(`${values.API_URL}/rest/v1/accounts?select=id&limit=1`, { signal: controller.signal, headers: { apikey: values.SERVICE_ROLE_KEY, Authorization: `Bearer ${values.SERVICE_ROLE_KEY}` } });
    if (response.ok) { schemaReady = true; break; }
    await pause(1000);
  }
  if (!schemaReady) throw new Error('PostgREST schema cache did not load');
  const token = `123456:${randomBytes(24).toString('hex')}`;
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'development', TELEGRAM_BOT_TOKEN: token, E2E_BOT_TOKEN: token, NEXT_PUBLIC_SUPABASE_URL: values.API_URL, SUPABASE_SECRET_KEY: values.SERVICE_ROLE_KEY, APP_BASE_URL: 'http://127.0.0.1:3107', NEXT_TELEMETRY_DISABLED: '1' };
  // Never send synthetic credentials to an unrelated service already on this port.
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', () => reject(new Error('E2E application port 3107 is already in use')));
    probe.listen(3107, '127.0.0.1', () => probe.close(resolve));
  });
  if (controller.signal.aborted) throw new Error('Interrupted');
  server = spawn(join(root, 'node_modules/.bin/next'), ['dev', '-p', '3107', '-H', '127.0.0.1'], { env, stdio: 'ignore' });
  server.on('error', error => { serverError = error; });
  let ready = false;
  for (let i = 0; i < 90; i++) {
    if (serverError || server.exitCode !== null || server.signalCode !== null) throw new Error('Next server exited during startup');
    try { if ((await fetch('http://127.0.0.1:3107/api/health', { signal: controller.signal })).ok) { ready = true; break; } } catch {}
    await pause(1000);
  }
  if (!ready) throw new Error('Next server did not become ready');
  if (controller.signal.aborted) throw new Error('Interrupted');
  console.log('Running browser journey...');
  const child = spawn(join(root, 'node_modules/.bin/playwright'), ['test', ...process.argv.slice(2)], { env, stdio: 'inherit' });
  activeChild = child;
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  activeChild = undefined;
  if (code !== 0 && !interrupted) process.exitCode = 1;
} catch (error) {
  // Do not print command output: local service keys and launch credentials may be present.
  console.error('E2E setup failed:', error.message?.split('\n')[0]);
  if (!interrupted) process.exitCode = 1;
} finally {
  if (server && server.exitCode === null && server.signalCode === null && !serverError) {
    const closed = new Promise(resolve => server.once('close', resolve));
    terminate(server);
    await closed;
  }
  if (started) {
    try { execFileSync(cli, ['stop', '--no-backup', '--workdir', workdir], { stdio: 'ignore' }); }
    catch { console.error(`Could not remove disposable stack ${project}; inspect it locally.`); process.exitCode = 1; }
  }
  rmSync(workdir, { recursive: true, force: true });
}
