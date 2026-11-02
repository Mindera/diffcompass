// Discover a real CLI review through its lock, without parsing the URL from stdout.
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runProcess } from '../src/process.ts';

const { chromium } = await import(pathToFileURL(process.argv[2]).href);
const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome', headless: true });
const root = await realpath(await mkdtemp(join(tmpdir(), 'diffcompass-discovery-')));
const repository = join(root, 'repository');
const stateRoot = join(root, 'state');
const sessions = join(stateRoot, 'diffcompass', 'sessions');
const runs = [];
const git = (...args) => runProcess(['git', ...args], repository);
const readJson = path => readFile(path, 'utf8').then(JSON.parse);
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };

async function start({ attached = false, resume } = {}) {
  const args = resume ? ['--resume', resume] : ['--repo', repository, '--base', 'HEAD', ...(attached ? ['--attached'] : [])];
  const child = Bun.spawn([process.execPath, fileURLToPath(new URL('../src/cli.ts', import.meta.url)), ...args, '--port', '0', '--no-findings'], {
    cwd: repository, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, XDG_STATE_HOME: stateRoot },
  });
  const run = { child, stdout: new Response(child.stdout).text(), stderr: new Response(child.stderr).text() };
  runs.push(run);
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline && child.exitCode === null) {
    const files = await readdir(sessions).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
    for (const name of files.filter(name => name.endsWith('.json') && !name.startsWith('.'))) {
      const stateFile = join(sessions, name);
      const lock = await readJson(`${stateFile}.lock`).catch(() => null);
      if (lock?.pid !== child.pid || !lock.reviewUrl || !alive(lock.pid)) continue;
      const state = await readJson(stateFile);
      assert.equal(state.repositoryRoot, repository);
      run.stateFile = stateFile; run.lock = lock; run.state = state;
      if (process.platform !== 'win32') assert.equal((await stat(`${stateFile}.lock`)).mode & 0o777, 0o600);
      const review = new URL(lock.reviewUrl);
      assert.ok(new URLSearchParams(review.hash.slice(1)).get('token') === state.browserToken, 'Lock URL authenticates the saved review');
      assert.equal(review.hostname, '127.0.0.1');
      assert.ok(Number(review.port) > 0);
      assert.equal(lock.bridgeUrl, state.bridgeToken ? review.origin : undefined);
      assert.deepEqual(Object.keys(lock).sort(), ['pid', 'token', 'startedAt', 'reviewUrl', ...(state.bridgeToken ? ['bridgeUrl'] : [])].sort());
      return run;
    }
    await Bun.sleep(25);
  }
  throw Error('CLI did not publish a live session URL.');
}

async function openReview(run) {
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  page.setDefaultTimeout(20000);
  await page.route('**/api/update', route => route.fulfill({ json: { updateAvailable: false } }));
  const loaded = page.waitForResponse(response => new URL(response.url()).pathname === '/api/session');
  await page.goto(run.lock.reviewUrl);
  const response = await loaded;
  assert.ok(response.ok(), 'The discovered URL loads an authenticated review');
  assert.equal((await response.json()).comparison.repositoryRoot, repository);
  await page.locator('#diff-tab').click();
  const file = page.locator('#diff .diff-file[data-path="app.ts"]');
  await file.waitFor();
  assert.ok((await file.textContent()).includes('changed = 2'), 'The review renders the changed code');
  return page;
}

async function closeReview(run, outcome) {
  const origin = new URL(run.lock.reviewUrl).origin;
  const response = await fetch(`${origin}/api/close`, {
    method: 'POST', headers: { origin, 'content-type': 'application/json', 'x-diffcompass-token': run.state.browserToken },
    body: JSON.stringify({ outcome }),
  });
  assert.equal(response.status, 200); await response.text();
  if (run.state.bridgeToken) {
    const headers = { 'x-diffcompass-token': run.state.bridgeToken, 'content-type': 'application/json' };
    const { events } = await (await fetch(`${run.lock.bridgeUrl}/api/bridge/events`, { headers })).json();
    const terminal = events.find(event => event.type === 'review.closed');
    assert.ok(terminal, 'Attached result remains available until acknowledged');
    const ack = await fetch(`${run.lock.bridgeUrl}/api/bridge/ack`, {
      method: 'POST', headers, body: JSON.stringify({ eventId: terminal.id, leaseId: terminal.leaseId }),
    });
    assert.equal(ack.status, 200); await ack.text();
  }
  const timeout = setTimeout(() => run.child.kill('SIGKILL'), 10000);
  try { assert.equal(await run.child.exited, 0); } finally { clearTimeout(timeout); }
  await assert.rejects(access(`${run.stateFile}.lock`));
  const stdout = await run.stdout;
  assert.ok(stdout.includes(`DiffCompass: ${run.lock.reviewUrl}\n`), 'Existing stdout URL remains unchanged');
  if (run.state.bridgeToken) assert.ok(stdout.includes(`Attached bridge URL: ${run.lock.bridgeUrl}\n`));
}

try {
  await mkdir(repository);
  await git('init', '-b', 'main');
  await git('config', 'user.name', 'Discovery test');
  await git('config', 'user.email', 'discovery@example.test');
  await writeFile(join(repository, 'app.ts'), 'const changed = 1;\n');
  await git('add', 'app.ts'); await git('commit', '-m', 'base');
  await writeFile(join(repository, 'app.ts'), 'const changed = 2;\n');

  const standalone = await start();
  await openReview(standalone);
  await closeReview(standalone, 'accepted');

  const attached = await start({ attached: true });
  await openReview(attached);
  const context = await fetch(`${attached.lock.bridgeUrl}/api/bridge/context`, { headers: { 'x-diffcompass-token': attached.state.bridgeToken } });
  assert.equal(context.status, 200);
  assert.equal((await context.json()).comparison.repositoryRoot, repository);
  attached.child.kill('SIGKILL'); await attached.child.exited;
  assert.equal(alive(attached.lock.pid), false, 'A crashed session has a dead PID');
  assert.ok((await readJson(`${attached.stateFile}.lock`)).reviewUrl, 'The crash leaves a stale URL for readers to ignore');

  const resumed = await start({ resume: attached.stateFile });
  assert.equal(resumed.stateFile, attached.stateFile);
  assert.notEqual(resumed.lock.token, attached.lock.token, 'Resume replaces the stale lock owner');
  assert.equal(resumed.lock.pid, resumed.child.pid);
  await openReview(resumed);
  await closeReview(resumed, 'cancelled');
  console.log('PASS lock URL discovery, private permissions, browser authentication, attached bridge URL, shutdown cleanup, and stale-lock replacement');
} catch (error) {
  let detail = String(error.stack || error);
  for (const run of runs) {
    if (run.lock?.reviewUrl) detail = detail.replaceAll(run.lock.reviewUrl, '[redacted review URL]');
    if (run.state?.browserToken) detail = detail.replaceAll(run.state.browserToken, '[redacted browser token]');
  }
  console.error(detail); process.exitCode = 1;
} finally {
  await browser.close();
  for (const run of runs) {
    if (run.child.exitCode === null) run.child.kill('SIGKILL');
    await run.child.exited;
    // The deliberate crash leaves the CLI's disposable bridge directory too.
    const tokenFile = /^Attached bridge token file: (.+)$/m.exec(await run.stdout)?.[1];
    if (tokenFile) {
      const directory = dirname(tokenFile);
      const marker = await readJson(join(directory, '.active.json')).catch(() => null);
      if (marker?.pid === run.child.pid) await rm(directory, { recursive: true, force: true });
    }
  }
  await rm(root, { recursive: true, force: true });
}
