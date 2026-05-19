const BASE_URL = 'http://localhost:3000';

const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const BLUE = '\x1b[34m';
const CYAN = '\x1b[36m';

let token = null;
let testUserEmail = null;

function log(msg, color = RESET) {
  console.log(`${color}${msg}${RESET}`);
}

function logTest(name, status, details = '') {
  const icon = status ? '✓' : '✗';
  const color = status ? GREEN : RED;
  log(`  ${icon} ${name}${details}`, color);
  return status;
}

async function request(method, path, body = null, requireAuth = false) {
  const headers = { 'Content-Type': 'application/json' };
  if (requireAuth && token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const options = { 
    method, 
    headers,
    signal: AbortSignal.timeout(10000)
  };
  if (body) options.body = JSON.stringify(body);

  try {
    const res = await fetch(`${BASE_URL}${path}`, options);
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    return { ok: false, status: 0, error: err.message };
  }
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTests() {
  log('='.repeat(55), CYAN);
  log('KhelSetu API Test Suite - Quick', CYAN);
  log('='.repeat(55), CYAN);
  log(`Base URL: ${BASE_URL}\n`, BLUE);

  let passed = 0;
  let failed = 0;

  // Core endpoints
  log('Core Endpoints', BLUE);
  
  let res = await request('GET', '/health');
  logTest('GET /health', res.ok && res.data?.status === 'ok', res.ok ? ` (${res.data?.status})` : '');
  res.ok && res.data?.status === 'ok' ? passed++ : failed++;

  await sleep(100);
  
  const email = `test${Date.now()}@example.com`;
  testUserEmail = email;
  res = await request('POST', '/api/auth/register', { email, password: 'TestPass123!', first_name: 'Test', last_name: 'User' });
  logTest('POST /api/auth/register', res.ok && res.data?.success, res.ok ? ' (created)' : ` (${res.status})`);
  res.ok && res.data?.success ? passed++ : failed++;

  await sleep(100);
  
  res = await request('POST', '/api/auth/login', { email: testUserEmail, password: 'TestPass123!' });
  if (res.ok && res.data?.data?.accessToken) {
    token = res.data.data.accessToken;
    logTest('POST /api/auth/login', true, ' (token obtained)');
    passed++;
  } else {
    logTest('POST /api/auth/login', false, ` (${res.status})`);
    failed++;
  }

  await sleep(100);
  
  res = await request('GET', '/api/auth/me', null, true);
  logTest('GET /api/auth/me', res.ok && res.data?.success, res.ok ? ` (${res.data?.data?.email})` : '');
  res.ok && res.data?.success ? passed++ : failed++;

  // Public endpoints
  log('\nPublic Endpoints', BLUE);
  
  res = await request('GET', '/api/public/sports');
  logTest('GET /api/public/sports', res.ok, res.ok ? ` (${res.data?.data?.length || 0})` : ` (${res.status})`);
  res.ok ? passed++ : failed++;

  res = await request('GET', '/api/public/tournaments');
  logTest('GET /api/public/tournaments', res.ok, res.ok ? ` (${res.data?.data?.length || 0})` : ` (${res.status})`);
  res.ok ? passed++ : failed++;

  res = await request('GET', '/api/public/teams/00000000-0000-0000-0000-000000000001');
  logTest('GET /api/public/teams/:id', res.ok || res.status === 404, res.status === 404 ? ' (not found)' : '');
  (res.ok || res.status === 404) ? passed++ : failed++;

  // Auth required endpoints
  log('\nAuth Required Endpoints', BLUE);
  
  res = await request('GET', '/api/organizations', null, true);
  logTest('GET /api/organizations', res.ok, res.ok ? ` (${res.data?.data?.length || 0})` : '');
  res.ok ? passed++ : failed++;

  res = await request('GET', '/api/sports', null, true);
  logTest('GET /api/sports', res.ok, res.ok ? ` (${res.data?.data?.length || 0})` : '');
  res.ok ? passed++ : failed++;

  res = await request('GET', '/api/notifications', null, true);
  logTest('GET /api/notifications', res.ok, res.ok ? ` (${res.data?.data?.length || 0})` : '');
  res.ok ? passed++ : failed++;

  res = await request('GET', '/api/overlays', null, true);
  logTest('GET /api/overlays', res.ok, res.ok ? ` (${res.data?.data?.length || 0})` : '');
  res.ok ? passed++ : failed++;

  res = await request('GET', '/api/sync/status', null, true);
  logTest('GET /api/sync/status', res.ok, res.ok ? '' : '');
  res.ok ? passed++ : failed++;

  res = await request('GET', '/api/standings/tournament/00000000-0000-0000-0000-000000000001', null, true);
  logTest('GET /api/standings/tournament/:id', res.ok || res.status === 404, res.status === 404 ? ' (not found)' : '');
  (res.ok || res.status === 404) ? passed++ : failed++;

  res = await request('GET', '/api/visualization/annotations/match/00000000-0000-0000-0000-000000000001', null, true);
  logTest('GET /api/visualization/annotations', res.ok || res.status === 404, res.status === 404 ? ' (not found)' : '');
  (res.ok || res.status === 404) ? passed++ : failed++;

  res = await request('GET', '/api/matches/00000000-0000-0000-0000-000000000001', null, true);
  logTest('GET /api/matches/:id', res.ok || res.status === 404, res.status === 404 ? ' (not found)' : '');
  (res.ok || res.status === 404) ? passed++ : failed++;

  res = await request('GET', '/api/teams/00000000-0000-0000-0000-000000000001', null, true);
  logTest('GET /api/teams/:id', res.ok || res.status === 404, res.status === 404 ? ' (not found)' : '');
  (res.ok || res.status === 404) ? passed++ : failed++;

  res = await request('GET', '/api/players/00000000-0000-0000-0000-000000000001', null, true);
  logTest('GET /api/players/:id', res.ok || res.status === 404, res.status === 404 ? ' (not found)' : '');
  (res.ok || res.status === 404) ? passed++ : failed++;

  res = await request('GET', '/api/tournaments', null, true);
  logTest('GET /api/tournaments', res.ok, res.ok ? ` (${res.data?.data?.length || 0})` : '');
  res.ok ? passed++ : failed++;

  // Database
  log('\nDatabase', BLUE);
  
  res = await request('GET', '/health');
  logTest('Database Health', res.ok && res.data?.database?.status === 'healthy', res.ok ? ` (${res.data?.database?.status})` : '');
  res.ok && res.data?.database?.status === 'healthy' ? passed++ : failed++;

  log('\n' + '='.repeat(55), CYAN);
  log(`Results: ${GREEN}${passed} passed${RESET} | ${RED}${failed} failed${RESET}`);
  log('='.repeat(55), CYAN);

  process.exit(failed > 0 ? 1 : 0);
}

runTests();