#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const MARKER = '/* VALLENATRIX_9ROUTER_INTEGRATION */';
const globalModules = (() => {
  try { return execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(); }
  catch { return ''; }
})();
const appDir = process.env.NINEROUTER_APP_DIR || path.join(globalModules, '9router', 'app');
const packageJson = path.join(path.dirname(appDir), 'package.json');
const repoRoot = path.resolve(__dirname, '..');
const iconSource = process.env.VALLENATRIX_ICON_PATH || path.join(repoRoot, 'vallenterminal/assets/vallenatrix.png');
const home = os.homedir();

function fail(message) { console.error(`Vallenatrix 9router setup: ${message}`); process.exit(1); }
function findFile(root, predicate) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) { const found = findFile(file, predicate); if (found) return found; }
    else if (predicate(file)) return file;
  }
  return null;
}
function backup(file) {
  const version = (() => { try { return require(packageJson).version; } catch { return 'unknown'; } })();
  const backupPath = path.join(home, '.9router', 'vallenatrix-backups', version, path.relative(appDir, file));
  fs.mkdirSync(path.dirname(backupPath), { recursive: true, mode: 0o700 });
  if (!fs.existsSync(backupPath)) fs.copyFileSync(file, backupPath, fs.constants.COPYFILE_EXCL);
}
function replaceOnce(file, marker, replacement, label) {
  let text = fs.readFileSync(file, 'utf8');
  if (text.includes(MARKER)) return false;
  if (!text.includes(marker)) fail(`Unrecognized 9router build; cannot patch ${label}: ${file}`);
  backup(file);
  text = text.replace(marker, `${replacement}\n${MARKER}`);
  fs.writeFileSync(file, text);
  return true;
}

if (!fs.existsSync(appDir)) fail(`9router app not found: ${appDir}`);
if (!fs.existsSync(iconSource)) fail(`Vallenatrix icon not found: ${iconSource}`);
const chunksDir = path.join(appDir, '.next-cli-build/static/chunks');
const serverDir = path.join(appDir, '.next-cli-build/server');
const registryFile = findFile(chunksDir, (file) => file.endsWith('.js') && fs.readFileSync(file, 'utf8').includes('hermes:{id:"hermes"'));
const detailFile = findFile(chunksDir, (file) => file.includes(path.join('cli-tools', '[toolId]')) && path.basename(file).startsWith('page-') && file.endsWith('.js'));
const customServer = path.join(appDir, 'custom-server.js');
const appPaths = path.join(serverDir, 'app-paths-manifest.json');

for (const file of [registryFile, detailFile, customServer, appPaths]) {
  if (!fs.existsSync(file)) fail(`Required 9router asset missing: ${file}`);
}

const registryText = fs.readFileSync(registryFile, 'utf8');
if (!registryText.includes('hermes:{id:"hermes"')) fail('CLI Tools registry marker not found');
const registryEntry = 'vallenatrix:{id:"vallenatrix",name:"Vallenatrix",image:"/providers/vallenatrix.png",color:"#8B5CF6",description:"Vallenatrix AI coding agent",configType:"custom"},';
replaceOnce(registryFile, 'droid:{id:"droid"', `${registryEntry}droid:{id:"droid"`, 'CLI Tools registry');

const detailEntry = 'case"vallenatrix":return(0,s.jsx)(n.WE,{...d,activeProviders:$(),cloudEnabled:b});';
replaceOnce(detailFile, 'case"hermes":return(0,s.jsx)(n.RF,{...d,activeProviders:$(),hasActiveProviders:r,cloudEnabled:b});', `case"hermes":return(0,s.jsx)(n.RF,{...d,activeProviders:$(),hasActiveProviders:r,cloudEnabled:b});${detailEntry}`, 'CLI Tool detail route');

const routeMarker = '  return handler(req, res);';
const handler = `${MARKER}
  if ((req.url || '').split('?')[0] === '/api/cli-tools/vallenatrix-settings') {
    handleVallenatrixSettings(req, res).catch((error) => {
      if (!res.headersSent) { res.statusCode = 500; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ error: { message: error.message } })); }
    });
    return;
  }
`;
const routeHelpers = `${MARKER}
const os = require('os');
function validVallenatrixSession(req) {
  try {
    const token = String(req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith('auth_token='))?.slice('auth_token='.length);
    if (!token) return false;
    const [header, payload, signature] = decodeURIComponent(token).split('.');
    if (!header || !payload || !signature || JSON.parse(Buffer.from(header, 'base64url')).alg !== 'HS256') return false;
    const dataDir = process.env.DATA_DIR || path.join(os.homedir(), '.9router');
    const secret = fs.readFileSync(path.join(dataDir, 'jwt-secret'), 'utf8').trim();
    const expected = crypto.createHmac('sha256', secret).update(header + '.' + payload).digest();
    const actual = Buffer.from(signature, 'base64url');
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return false;
    const claims = JSON.parse(Buffer.from(payload, 'base64url'));
    return claims.authenticated === true && Number(claims.exp) > Math.floor(Date.now() / 1000);
  } catch { return false; }
}
async function handleVallenatrixSettings(req, res) {
  const send = (status, body) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store'); res.end(JSON.stringify(body)); };
  if (!validVallenatrixSession(req)) return send(401, { error: { message: 'Dashboard login required' } });
  const configPath = path.join(os.homedir(), '.vallenatrix', 'config.json');
  let config;
  try { config = JSON.parse(await fs.promises.readFile(configPath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') return send(500, { error: { message: 'Vallenatrix config is invalid' } }); config = {}; }
  if (req.method === 'GET') {
    const provider = config.providers?.['9router'];
    let installed = false;
    try { execFileSync('bash', ['-lc', 'command -v vallenatrix >/dev/null 2>&1 || test -f "$HOME/.vallenatrix/config.json"']); installed = true; } catch {}
    return send(200, { installed, has9Router: Boolean(provider?.base_url), config: provider ? { base_url: provider.base_url, model: provider.model } : null, configPath });
  }
  if (!['POST', 'DELETE'].includes(req.method)) return send(405, { error: { message: 'Method not allowed' } });
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 16384) return send(413, { error: { message: 'Request too large' } }); chunks.push(chunk); }
  let body = {};
  if (req.method === 'POST') {
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(400, { error: { message: 'Invalid JSON body' } }); }
    const { baseUrl, apiKey, model } = body;
    if (typeof baseUrl !== 'string' || !/^https?:\\/\\//i.test(baseUrl) || /[\\r\\n]/.test(baseUrl)) return send(400, { error: { message: 'Valid HTTP baseUrl is required' } });
    if (typeof model !== 'string' || !model.trim() || model.length > 256 || /[\\r\\n]/.test(model)) return send(400, { error: { message: 'Valid model is required' } });
    if (apiKey != null && (typeof apiKey !== 'string' || apiKey.length > 4096 || /[\\r\\n]/.test(apiKey))) return send(400, { error: { message: 'Invalid API key' } });
    config.providers = config.providers && typeof config.providers === 'object' ? config.providers : {};
    const previous = config.providers['9router'] || {};
    config.providers.active = '9router';
    config.providers['9router'] = { ...previous, base_url: baseUrl.replace(/\\/+$/, '').replace(/\\/v1$/i, '') + '/v1', api_key: apiKey || previous.api_key || '', model: model.trim(), enabled: true };
  } else {
    delete config.providers?.['9router'];
    if (config.providers?.active === '9router') {
      const fallback = Object.keys(config.providers).find((key) => key !== 'active');
      if (fallback) config.providers.active = fallback; else delete config.providers.active;
    }
  }
  await fs.promises.mkdir(path.dirname(configPath), { recursive: true, mode: 0o700 });
  const temp = configPath + '.' + process.pid + '.tmp';
  await fs.promises.writeFile(temp, JSON.stringify(config, null, 2), { mode: 0o600 });
  await fs.promises.rename(temp, configPath);
  return send(200, { success: true, message: req.method === 'POST' ? 'Vallenatrix connected to 9Router.' : '9Router settings removed from Vallenatrix.', configPath });
}
`;
replaceOnce(customServer, routeMarker, `${routeHelpers}\n${handler}${routeMarker}`, 'authenticated settings endpoint');

const manifest = JSON.parse(fs.readFileSync(appPaths, 'utf8'));
const routePath = '/api/cli-tools/vallenatrix-settings/route';
if (!manifest[routePath]) {
  backup(appPaths);
  manifest[routePath] = 'app/api/cli-tools/vallenatrix-settings/route.js';
  fs.writeFileSync(appPaths, JSON.stringify(manifest, null, 2) + '\n');
}
const iconDest = path.join(appDir, 'public/providers/vallenatrix.png');
if (!fs.existsSync(iconDest)) fs.copyFileSync(iconSource, iconDest);
console.log(`Vallenatrix CLI Tool patched into local 9router: ${appDir}`);
