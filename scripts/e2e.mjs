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
const run = (bin, args, options = {}) => execFileSync(bin, args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...options });
let started = false;
let server;
try {
  // No remote Docker daemon: even creating/deleting a stack must be local.
  const endpoint = JSON.parse(run('docker', ['context', 'inspect']))[0]?.Endpoints?.docker?.Host;
  if (!endpoint?.startsWith('unix://') || process.env.DOCKER_HOST || process.env.DOCKER_CONTEXT) throw new Error('E2E requires the local Unix Docker context, without Docker overrides');
  for (const file of ['.env', '.env.local', '.env.development', '.env.development.local']) {
    if (existsSync(join(root, file))) throw new Error(`Remove ${file} from this worktree before running E2E; real credentials are not permitted`);
  }
  mkdirSync(join(workdir, 'supabase'));
  // Initialise in a fresh directory, never in the application Supabase project.
  run(cli, ['init', '--workdir', workdir]);
  const configPath = join(workdir, 'supabase/config.toml');
  let config = readFileSync(configPath, 'utf8');
  config = config.replace(/^project_id = .+$/m, `project_id = "${project}"`)
    .replace(/(\[db\.migrations\][\s\S]*?enabled = )true/, '$1false')
    .replace(/(\[db\.seed\][\s\S]*?enabled = )true/, '$1false');
  writeFileSync(configPath, config);
  started = true;
  console.log('Starting disposable local Supabase (first run downloads images)...');
  run(cli, ['start', '--workdir', workdir, '-x', 'studio,imgproxy,edge-runtime,logflare,vector,mailpit,realtime,storage-api']);
  const name = `supabase_db_${project}`;
  const details = JSON.parse(run('docker', ['inspect', name]))[0];
  if (details?.Config?.Labels?.['com.supabase.cli.project'] !== project || details?.Config?.Labels?.['com.supabase.cli.workdir'] !== workdir) throw new Error('Cannot verify disposable database container');
  // schema.sql is a fresh-install snapshot containing transactional temp tables.
  const schema = readFileSync(join(root, 'supabase/schema.sql'));
  for (let i = 0; i < 2; i++) {
    run('docker', ['exec', '-i', name, 'psql', '-1', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'], { input: schema });
  }
  run('docker', ['exec', '-i', name, 'psql', '-1', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'], { input: "grant usage on schema public to service_role; grant all on all tables in schema public to service_role; grant all on all sequences in schema public to service_role; grant execute on all functions in schema public to service_role; insert into public.users (telegram_user_id, first_name) values (900000000001, 'Synthetic'); notify pgrst, 'reload schema';" });
  const status = run(cli, ['status', '--workdir', workdir, '-o', 'env']);
  const values = Object.fromEntries(status.trim().split('\n').map(line => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1).replace(/^"|"$/g, '')]; }));
  if (values.API_URL !== 'http://127.0.0.1:54321' || !values.SERVICE_ROLE_KEY) throw new Error('Unverifiable local Supabase API target');
  let schemaReady = false;
  for (let i = 0; i < 30; i++) {
    const response = await fetch(`${values.API_URL}/rest/v1/accounts?select=id&limit=1`, { headers: { apikey: values.SERVICE_ROLE_KEY, Authorization: `Bearer ${values.SERVICE_ROLE_KEY}` } });
    if (response.ok) { schemaReady = true; break; }
    await new Promise(r => setTimeout(r, 1000));
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
  server = spawn(join(root, 'node_modules/.bin/next'), ['dev', '-p', '3107', '-H', '127.0.0.1'], { env, stdio: 'ignore' });
  let ready = false;
  for (let i = 0; i < 90; i++) {
    if (server.exitCode !== null) throw new Error('Next server exited during startup');
    try { if ((await fetch('http://127.0.0.1:3107/api/health')).ok) { ready = true; break; } } catch {}
    await new Promise(r => setTimeout(r, 1000));
  }
  if (!ready) throw new Error('Next server did not become ready');
  console.log('Running browser journey...');
  const child = spawn(join(root, 'node_modules/.bin/playwright'), ['test', ...process.argv.slice(2)], { env, stdio: 'inherit' });
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
  if (code !== 0) process.exitCode = 1;
} catch (error) {
  // Do not print command output: local service keys and launch credentials may be present.
  console.error('E2E setup failed:', error.message?.split('\n')[0]);
  process.exitCode = 1;
} finally {
  server?.kill('SIGTERM');
  if (started) {
    try { run(cli, ['stop', '--no-backup', '--workdir', workdir]); }
    catch { console.error(`Could not remove disposable stack ${project}; inspect it locally.`); process.exitCode = 1; }
  }
  rmSync(workdir, { recursive: true, force: true });
}
