// Isolated source-navigation compatibility gate; never imports/runs Gradle.
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { decodeFrames, encodeFrame, positionOf } from './protocol.mjs';

const binary = process.argv[2];
if (!binary || !isAbsolute(binary)) throw new Error('Usage: bun probe-kotlin.mjs /absolute/path/to/kmp-lsp');
const scratch = await mkdtemp(join(tmpdir(), 'diffcompass-kmp-probe-'));
const root = join(scratch, 'workspace');
await cp(join(dirname(fileURLToPath(import.meta.url)), 'fixture'), root, { recursive: true });
await mkdir(join(scratch, 'gradle'), { recursive: true });
const env = {
  ...process.env,
  KMP_LSP_WORKSPACE_ROOT: root,
  KMP_LSP_LOG_FILE: join(scratch, 'provider.log'),
  XDG_CACHE_HOME: join(scratch, 'cache'),
  GRADLE_USER_HOME: join(scratch, 'gradle'),
};
delete env.KMP_LSP_PREFER_CONFIG_ROOT;
delete env.ANDROID_HOME;
delete env.ANDROID_SDK_ROOT;

const child = spawn(binary, [], { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
let nextId = 0;
let remaining = Buffer.alloc(0);
let stderr = '';
let finishedIndexing = false;
const pending = new Map();
const progress = [];
const send = (message) => child.stdin.write(encodeFrame({ jsonrpc: '2.0', ...message }));
const failAll = (error) => {
  for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); }
  pending.clear();
};
child.on('error', failAll);
child.on('exit', (code) => failAll(new Error(`Provider exited (${code})`)));
child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-64 * 1024); });
child.stdout.on('data', (chunk) => {
  try {
    const decoded = decodeFrames(Buffer.concat([remaining, chunk]));
    remaining = decoded.remaining;
    for (const message of decoded.messages) {
      if (message.method && message.id !== undefined) {
        if (message.method === 'window/workDoneProgress/create') send({ id: message.id, result: null });
        else if (message.method === 'workspace/configuration') send({ id: message.id, result: message.params.items.map(() => null) });
        else send({ id: message.id, error: { code: -32601, message: 'Unsupported by compatibility probe' } });
      } else if (message.method === '$/progress') {
        progress.push(message.params);
        if (message.params.value.kind === 'end') finishedIndexing = true;
      } else if (message.id !== undefined) {
        const item = pending.get(message.id);
        if (!item) continue;
        pending.delete(message.id);
        clearTimeout(item.timer);
        if (message.error) item.reject(new Error(JSON.stringify(message.error)));
        else item.resolve(message.result);
      }
    }
  } catch (error) { failAll(error); child.kill(); }
});
function request(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => {
      pending.delete(id);
      send({ method: '$/cancelRequest', params: { id } });
      reject(new Error(`Timeout: ${method}`));
    }, 10000);
    pending.set(id, { resolve, reject, timer });
    send({ id, method, params });
  });
}
const uri = (path) => pathToFileURL(join(root, path)).href;
const common = 'src/commonMain/kotlin/';
const checkout = common + 'ui/Checkout.kt';
const receipt = common + 'billing/Receipt.kt';
const results = [];
const documents = new Map();
async function at(path, uniqueExpression, symbol) {
  if (!documents.has(path)) {
    const text = await readFile(join(root, path), 'utf8');
    documents.set(path, text);
    send({ method: 'textDocument/didOpen', params: { textDocument: { uri: uri(path), languageId: 'kotlin', version: 1, text } } });
  }
  const text = documents.get(path);
  const position = positionOf(text, uniqueExpression);
  position.character += uniqueExpression.indexOf(symbol);
  return { textDocument: { uri: uri(path) }, position };
}
function locations(response) {
  return (Array.isArray(response) ? response : response ? [response] : []).map((location) => ({
    path: relative(root, fileURLToPath(location.uri ?? location.targetUri)),
    line: (location.range ?? location.targetSelectionRange).start.line + 1,
  }));
}
async function definition(name, path, expression, symbol, allowed, expectedLine) {
  const raw = await request('textDocument/definition', await at(path, expression, symbol));
  const targets = locations(raw);
  results.push({ name, passed: targets.length > 0 && targets.every((target) => allowed.includes(target.path)
    && (expectedLine === undefined || target.line === expectedLine)), targets });
}

try {
  const initialized = await request('initialize', {
    processId: process.pid, rootUri: uri(''), workspaceFolders: [{ uri: uri(''), name: 'isolated-kmp-probe' }],
    capabilities: { window: { workDoneProgress: true }, general: { positionEncodings: ['utf-16'] } },
    initializationOptions: { indexingOptions: { sourcePaths: [], jarPaths: [] } },
  });
  send({ method: 'initialized', params: {} });
  const deadline = Date.now() + 15000;
  while (!finishedIndexing && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
  if (!finishedIndexing) throw new Error('No indexing-complete notification; results would be inconclusive');

  await definition('common code does not resolve into platform-only source', common + 'demo/Platform.kt', '= platformName()', 'platformName', [common + 'demo/Platform.kt']);
  for (const [platform, file] of [['android', 'AndroidScreen'], ['ios', 'IosScreen']]) {
    await definition(`${platform} call excludes the other platform`, `src/${platform}Main/kotlin/ui/${file}.kt`, 'platformName()', 'platformName', [common + 'demo/Platform.kt', `src/${platform}Main/kotlin/demo/Platform.kt`]);
  }
  await definition('explicit import excludes unrelated same-name function', checkout, 'receipt("café 🧭")', 'receipt', [receipt], 4);
  await definition('String extension selects String receiver', checkout, '"label".decorate()', 'decorate', [receipt], 6);
  await definition('Int extension selects Int receiver', checkout, '42.decorate()', 'decorate', [receipt], 7);
  await definition('String overload selects String parameter', checkout, 'convert("label")', 'convert', [receipt], 9);
  await definition('Int overload selects Int parameter', checkout, 'convert(42)', 'convert', [receipt], 10);
  await definition('local Card receiver extension', checkout, 'card.label()', 'label', [receipt], 15);
  await definition('local Cash receiver extension', checkout, 'cash.label()', 'label', [receipt], 16);
  await definition('local Card parameter overload', checkout, 'billing.describe(card)', 'describe', [receipt], 17);
  await definition('local Cash parameter overload', checkout, 'billing.describe(cash)', 'describe', [receipt], 18);
  await definition('local annotated composable navigation (stub only)', checkout, 'ReceiptView(receipt', 'ReceiptView', [checkout], 17);

  const hover = await request('textDocument/hover', await at(checkout, 'receipt("café 🧭")', 'receipt'));
  results.push({ name: 'local hover describes the imported function', passed: JSON.stringify(hover?.contents ?? '').includes('receipt'), raw: hover });
  const references = locations(await request('textDocument/references', { ...await at(receipt, 'fun receipt', 'receipt'), context: { includeDeclaration: false } }));
  results.push({ name: 'references include only code usages, not same-name functions or prose', passed: references.length > 0 && references.every((target) => target.path === checkout && target.line === 13), targets: references });
  const folds = await request('textDocument/foldingRange', { textDocument: { uri: uri(checkout) } });
  results.push({ name: 'method and nested if folding ranges', passed: [16, 17].every((startLine) => folds?.some((range) => range.startLine === startLine)), raw: folds });

  const report = { binary, scratch, scope: 'source-only smoke test; no Gradle import, Android SDK, real Compose or compiler validation', capabilities: initialized.capabilities, results, progress };
  await writeFile(join(scratch, 'report.json'), JSON.stringify(report, null, 2));
  for (const result of results) console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.name}${result.targets ? ': ' + JSON.stringify(result.targets) : ''}`);
  console.log(`Report: ${join(scratch, 'report.json')}`);
  process.exitCode = results.every((result) => result.passed) ? 0 : 1;
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    try { await request('shutdown', null); send({ method: 'exit' }); } catch {}
    const cleanup = setTimeout(() => child.kill(), 1000);
    await new Promise((resolve) => child.exitCode !== null || child.signalCode !== null ? resolve() : child.once('exit', resolve));
    clearTimeout(cleanup);
  }
  await writeFile(join(scratch, 'stderr.log'), stderr);
}
