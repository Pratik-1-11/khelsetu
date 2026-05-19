import http from 'http';
import env from '../core/env.js';

const BASE_URL = `http://localhost:${env.port}`;

// ─── Helpers ───

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;

    const options = { hostname: url.hostname, port: url.port, path: url.pathname + url.search, method, headers };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
    res.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        if (res.statusCode >= 400) {
          console.error(`HTTP ${res.statusCode} response:`, data);
          reject(new Error(`${method} ${path} ${res.statusCode}: ${JSON.stringify(parsed)}`));
        } else {
          resolve(parsed);
        }
      } catch {
        console.error(`Raw response (status ${res.statusCode}):`, data);
        reject(new Error(`${method} ${path} ${res.statusCode}: ${data}`));
      }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function seed() {
  console.log('=== KhelSetu API Seed ===\n');

  // ── 1. SQL Seed (sports, permissions, roles) ──
  console.log('1. Running SQL seed (sports, permissions, roles)...');
  const { execSync } = await import('child_process');
  try {
    execSync('npm run seed', { stdio: 'inherit', cwd: process.cwd() });
    console.log('   SQL seed complete\n');
  } catch (e) {
    console.log('   SQL seed may have already been run or failed, continuing...\n');
  }

  // ── 2. Register admin user ──
  console.log('2. Registering admin user...');
  let adminToken, adminId;
  try {
    const adminReg = await request('POST', '/api/auth/register', {
      email: 'admin@khelsetu.com',
      password: 'Admin@123456',
      first_name: 'Admin',
      last_name: 'User',
      phone: '+977-9841000001'
    });
    adminToken = adminReg.data.accessToken;
    adminId = adminReg.data.user.id;
    console.log(`   Admin: ${adminReg.data.user.email} (${adminId})\n`);
  } catch (e) {
    if (e.message.includes('409') || e.message.includes('already')) {
      console.log('   Admin already exists, logging in...');
      await delay(50);
      const login = await request('POST', '/api/auth/login', {
        email: 'admin@khelsetu.com',
        password: 'Admin@123456'
      });
      adminToken = login.data.accessToken;
      adminId = login.data.user.id;
      console.log(`   Admin: ${login.data.user.email} (${adminId})\n`);
    } else {
      throw e;
    }
  }

  // ── 3. Register scorer users ──
  console.log('3. Registering scorer users...');
  const scorers = [];
  for (let i = 1; i <= 3; i++) {
    try {
      await delay(50);
      const reg = await request('POST', '/api/auth/register', {
        email: `scorer${i}@khelsetu.com`,
        password: 'Scorer@123456',
        first_name: `Scorer`,
        last_name: `${i}`,
        phone: `+977-984100000${i + 1}`
      });
      scorers.push(reg.data);
      console.log(`   Scorer ${i}: ${reg.data.user.email}`);
    } catch (e) {
      if (e.message.includes('409') || e.message.includes('already')) {
        console.log(`   Scorer ${i} already exists, skipping`);
      } else {
        throw e;
      }
    }
  }
  console.log('');

  // ── 4. Create organization ──
  console.log('4. Creating organization...');
  let orgId;
  const orgSlug = 'nsf-seed';
  try {
    const org = await request('POST', '/api/organizations', {
      name: 'Nepal Sports Federation',
      slug: orgSlug,
      description: 'National sports organization of Nepal',
      website: 'https://nsf.org.np',
      contact_email: 'info@nsf.org.np',
      contact_phone: '+977-1-4444444'
    }, adminToken);
    orgId = org.data.id;
    console.log(`   Org: ${org.data.name} (${orgId})\n`);
  } catch (e) {
    if (e.message.includes('409') || e.message.includes('already')) {
      console.log('   Organization already exists, fetching...');
      const orgs = await request('GET', '/api/organizations', null, adminToken);
      const existing = orgs.data.find((o) => o.slug === orgSlug);
      if (!existing) throw new Error(`Org with slug '${orgSlug}' not found for this user. Try a fresh seed.`);
      orgId = existing.id;
      console.log(`   Org: ${existing.name} (${orgId})\n`);
    } else {
      throw e;
    }
  }

  // ── 5. Create teams ──
  console.log('5. Creating teams...');
  const teams = [];
  const teamNames = [
    { name: 'Kathmandu Kings', slug: 'kathmandu-kings', home_venue: 'Dasharath Rangasala' },
    { name: 'Pokhara Warriors', slug: 'pokhara-warriors', home_venue: 'Pokhara Stadium' },
    { name: 'Biratnagar Strikers', slug: 'biratnagar-strikers', home_venue: 'Biratnagar Ground' },
    { name: 'Lalitpur Lions', slug: 'lalitpur-lions', home_venue: 'Lalitpur Cricket Ground' },
    { name: 'Chitwan Rhinos', slug: 'chitwan-rhinos', home_venue: 'Chitwan Stadium' },
    { name: 'Dharan Thunder', slug: 'dharan-thunder', home_venue: 'Dharan Sports Complex' }
  ];
  for (const t of teamNames) {
    try {
      await delay(50);
      const team = await request('POST', '/api/teams', {
        organization_id: orgId,
        name: t.name,
        slug: t.slug,
        description: `${t.name} cricket team`,
        home_venue: t.home_venue
      }, adminToken);
      teams.push(team.data);
      console.log(`   Team: ${team.data.name} (${team.data.id})`);
    } catch (e) {
      if (e.message.includes('409') || e.message.includes('already')) {
        const allTeams = await request('GET', `/api/teams?organization_id=${orgId}`, null, adminToken);
        const existing = allTeams.data.find((tm) => tm.slug === t.slug);
        if (existing) {
          teams.push(existing);
          console.log(`   Team: ${existing.name} (exists)`);
        }
      } else {
        throw e;
      }
    }
  }
  console.log('');

  // ── 6. Create players ──
  console.log('6. Creating players...');
  const players = [];
  const playerData = [
    { first_name: 'Rohan', last_name: 'Shrestha', jersey_number: 7, position: 'Batsman', gender: 'male' },
    { first_name: 'Suman', last_name: 'Gurung', jersey_number: 10, position: 'Bowler', gender: 'male' },
    { first_name: 'Anil', last_name: 'Magar', jersey_number: 3, position: 'All-rounder', gender: 'male' },
    { first_name: 'Bikash', last_name: 'Rai', jersey_number: 1, position: 'Wicket-keeper', gender: 'male' },
    { first_name: 'Deepak', last_name: 'Tamang', jersey_number: 5, position: 'Batsman', gender: 'male' },
    { first_name: 'Rajesh', last_name: 'Karki', jersey_number: 8, position: 'Bowler', gender: 'male' },
    { first_name: 'Suresh', last_name: 'Thapa', jersey_number: 11, position: 'All-rounder', gender: 'male' },
    { first_name: 'Manish', last_name: 'Paudel', jersey_number: 4, position: 'Batsman', gender: 'male' },
    { first_name: 'Ganesh', last_name: 'Bhandari', jersey_number: 9, position: 'Bowler', gender: 'male' },
    { first_name: 'Pradeep', last_name: 'Shahi', jersey_number: 2, position: 'Wicket-keeper', gender: 'male' },
    { first_name: 'Nabin', last_name: 'Bohara', jersey_number: 6, position: 'All-rounder', gender: 'male' },
    { first_name: 'Kamal', last_name: 'Chhetri', jersey_number: 12, position: 'Batsman', gender: 'male' }
  ];
  for (const p of playerData) {
    try {
      await delay(50);
      const player = await request('POST', '/api/players', {
        organization_id: orgId,
        first_name: p.first_name,
        last_name: p.last_name,
        jersey_number: p.jersey_number,
        position: p.position,
        gender: p.gender
      }, adminToken);
      players.push(player.data);
      console.log(`   Player: ${player.data.first_name} ${player.data.last_name} (#${player.data.jersey_number})`);
    } catch (e) {
      if (e.message.includes('409') || e.message.includes('already')) {
        const allPlayers = await request('GET', `/api/players?organization_id=${orgId}`, null, adminToken);
        const existing = allPlayers.data.find((pl) => pl.first_name === p.first_name && pl.last_name === p.last_name);
        if (existing) {
          players.push(existing);
          console.log(`   Player: ${existing.first_name} ${existing.last_name} (exists)`);
        }
      } else {
        throw e;
      }
    }
  }
  console.log('');

  // ── 7. Assign players to teams ──
  console.log('7. Assigning players to teams...');
  for (let i = 0; i < players.length; i++) {
    const teamIndex = i % teams.length;
    const role = i % 6 === 0 ? 'captain' : 'player';
    await delay(50);
    await request('POST', `/api/players/${players[i].id}/teams`, {
      team_id: teams[teamIndex].id,
      role
    }, adminToken);
    console.log(`   ${players[i].first_name} ${players[i].last_name} → ${teams[teamIndex].name} (${role})`);
  }
  console.log('');

  // ── 8. Fetch sports to get sport IDs ──
  console.log('8. Fetching sports...');
  const sportsRes = await request('GET', '/api/sports', null, adminToken);
  const sports = sportsRes.data;
  const cricket = sports.find((s) => s.slug === 'cricket');
  const football = sports.find((s) => s.slug === 'football');
  const basketball = sports.find((s) => s.slug === 'basketball');
  console.log(`   Cricket: ${cricket.id}`);
  console.log(`   Football: ${football.id}`);
  console.log(`   Basketball: ${basketball.id}\n`);

  // ── 9. Create tournaments ──
  console.log('9. Creating tournaments...');
  const tournaments = [];

  try {
    await delay(50);
    const cricketTournament = await request('POST', '/api/tournaments', {
      organization_id: orgId,
      sport_id: cricket.id,
      name: 'Nepal Premier League 2026',
      format: 'league',
      description: 'T20 cricket league',
      start_date: '2026-06-01',
      end_date: '2026-06-30'
    }, adminToken);
    tournaments.push(cricketTournament.data);
    console.log(`   Cricket: ${cricketTournament.data.name} (${cricketTournament.data.id})`);
  } catch (e) {
    if (e.message.includes('409') || e.message.includes('already')) {
      const allTournaments = await request('GET', `/api/tournaments?organization_id=${orgId}`, null, adminToken);
      const existing = allTournaments.data.find((t) => t.name.includes('Nepal Premier League'));
      if (existing) {
        tournaments.push(existing);
        console.log(`   Cricket: ${existing.name} (exists)`);
      }
    } else {
      throw e;
    }
  }

  try {
    await delay(50);
    const footballTournament = await request('POST', '/api/tournaments', {
      organization_id: orgId,
      sport_id: football.id,
      name: 'Nepal Super League 2026',
      format: 'knockout',
      description: 'Football knockout tournament',
      start_date: '2026-07-01',
      end_date: '2026-07-15'
    }, adminToken);
    tournaments.push(footballTournament.data);
    console.log(`   Football: ${footballTournament.data.name} (${footballTournament.data.id})\n`);
  } catch (e) {
    if (e.message.includes('409') || e.message.includes('already')) {
      const allTournaments = await request('GET', `/api/tournaments?organization_id=${orgId}`, null, adminToken);
      const existing = allTournaments.data.find((t) => t.name.includes('Nepal Super League'));
      if (existing) {
        tournaments.push(existing);
        console.log(`   Football: ${existing.name} (exists)\n`);
      }
    } else {
      throw e;
    }
  }

  // ── 10. Register teams to tournaments ──
  console.log('10. Registering teams to tournaments...');
  for (const tournament of tournaments) {
    await request('POST', `/api/tournaments/${tournament.id}/status`, { status: 'registration_open' }, adminToken);
    for (let i = 0; i < teams.length; i++) {
      try {
        await delay(50);
        await request('POST', `/api/tournaments/${tournament.id}/teams`, {
          team_id: teams[i].id,
          seed_number: i + 1
        }, adminToken);
      } catch (e) {
        if (e.message.includes('409') || e.message.includes('already')) {
          // Team already registered
        } else {
          throw e;
        }
      }
    }
    console.log(`   ${tournament.name}: ${teams.length} teams registered`);
  }
  console.log('');

  // ── 11. Generate fixtures ──
  console.log('11. Generating fixtures...');
  for (const tournament of tournaments) {
    const fixtures = await request('POST', `/api/tournaments/${tournament.id}/fixtures`, {
      format: tournament.format
    }, adminToken);
    console.log(`   ${tournament.name}: ${fixtures.data.length || fixtures.data.fixtures?.length || 'N/A'} fixtures generated`);
  }
  console.log('');

  // ── 12. Create matches manually (for cricket tournament) ──
  console.log('12. Creating matches...');
  const matches = [];
  const matchPairs = [
    { home: 0, away: 1, round: 1, venue: 'Dasharath Rangasala' },
    { home: 2, away: 3, round: 1, venue: 'Pokhara Stadium' },
    { home: 4, away: 5, round: 1, venue: 'Biratnagar Ground' },
    { home: 0, away: 2, round: 2, venue: 'Dasharath Rangasala' },
    { home: 1, away: 4, round: 2, venue: 'Pokhara Stadium' },
    { home: 3, away: 5, round: 2, venue: 'Lalitpur Cricket Ground' }
  ];

  for (const mp of matchPairs) {
    try {
      await delay(50);
      const match = await request('POST', '/api/matches', {
        tournament_id: tournaments[0].id,
        home_team_id: teams[mp.home].id,
        away_team_id: teams[mp.away].id,
        round_number: mp.round,
        venue: mp.venue,
        scheduled_at: `2026-06-${String(mp.round * 5 + mp.home).padStart(2, '0')}T14:00:00Z`
      }, adminToken);
      matches.push(match.data);
      console.log(`   Match: ${teams[mp.home].name} vs ${teams[mp.away].name} (Round ${mp.round})`);
    } catch (e) {
      if (e.message.includes('409') || e.message.includes('already')) {
        console.log(`   Match: ${teams[mp.home].name} vs ${teams[mp.away].name} (exists)`);
      } else {
        throw e;
      }
    }
  }
  console.log('');

  // ── 13. Start and score matches ──
  console.log('13. Starting and scoring matches...');
  const scores = [
    { home: 185, away: 172 },
    { home: 156, away: 160 },
    { home: 201, away: 198 },
    { home: 145, away: 142 },
    { home: 178, away: 180 },
    { home: 167, away: 155 }
  ];

  for (let i = 0; i < matches.length; i++) {
    await delay(50);
    await request('POST', `/api/matches/${matches[i].id}/start`, null, adminToken);
    console.log(`   Started: ${teams[matchPairs[i].home].name} vs ${teams[matchPairs[i].away].name}`);

    await delay(50);
    await request('POST', `/api/matches/${matches[i].id}/score`, {
      home_score: scores[i].home,
      away_score: scores[i].away
    }, adminToken);

    const winnerId = scores[i].home > scores[i].away ? teams[matchPairs[i].home].id : teams[matchPairs[i].away].id;
    await delay(50);
    await request('POST', `/api/matches/${matches[i].id}/end`, {
      home_score: scores[i].home,
      away_score: scores[i].away,
      winner_id: winnerId
    }, adminToken);
    console.log(`   Scored: ${scores[i].home}-${scores[i].away} → ${scores[i].home > scores[i].away ? teams[matchPairs[i].home].name : teams[matchPairs[i].away].name} won\n`);
  }

  // ── 14. Update tournament status ──
  console.log('14. Updating tournament status...');
  await request('POST', `/api/tournaments/${tournaments[0].id}/status`, {
    status: 'in_progress'
  }, adminToken);
  console.log(`   ${tournaments[0].name}: in_progress\n`);

  // ── 15. Summary ──
  console.log('=== Seed Summary ===');
  console.log(`   Users:       ${2 + scorers.length} (1 admin + ${scorers.length} scorers)`);
  console.log(`   Organizations: 1`);
  console.log(`   Teams:       ${teams.length}`);
  console.log(`   Players:     ${players.length}`);
  console.log(`   Tournaments: ${tournaments.length}`);
  console.log(`   Matches:     ${matches.length} (all completed)`);
  console.log('\n   Admin credentials:');
  console.log(`   Email:    admin@khelsetu.com`);
  console.log(`   Password: Admin@123456`);
  console.log(`   Token:    ${adminToken.slice(0, 30)}...`);
  console.log('\n=== Seed Complete ===');
}

seed().catch((err) => {
  console.error('Seed failed:', err.message);
  console.error('Stack:', err.stack);
  process.exit(1);
});
