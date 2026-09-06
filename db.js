const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'races.db'));

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS races (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player TEXT NOT NULL,
    track TEXT NOT NULL,
    time_ms INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_track_time ON races (track, time_ms);
`);

function addRace({ player, track, time_ms }) {
  const stmt = db.prepare(
    'INSERT INTO races (player, track, time_ms) VALUES (?, ?, ?)'
  );
  return stmt.run(player, track, time_ms);
}

// Best (lowest) time per player, for a given track (or overall best per player if no track given)
function getLeaderboard(track, limit = 10) {
  if (track) {
    return db
      .prepare(
        `SELECT player, MIN(time_ms) as best_time, track
         FROM races
         WHERE track = ?
         GROUP BY player
         ORDER BY best_time ASC
         LIMIT ?`
      )
      .all(track, limit);
  }
  return db
    .prepare(
      `SELECT player, MIN(time_ms) as best_time
       FROM races
       GROUP BY player
       ORDER BY best_time ASC
       LIMIT ?`
    )
    .all(limit);
}

function getTracks() {
  return db.prepare('SELECT DISTINCT track FROM races').all().map(r => r.track);
}

// ---------- Upcoming races ----------
db.exec(`
  CREATE TABLE IF NOT EXISTS upcoming_races (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    track TEXT NOT NULL,
    starts_at TEXT NOT NULL,
    note TEXT,
    event_name TEXT,
    image_url TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// Add columns if upgrading from an older db that doesn't have them yet
try { db.exec(`ALTER TABLE upcoming_races ADD COLUMN event_name TEXT`); } catch (e) {}
try { db.exec(`ALTER TABLE upcoming_races ADD COLUMN image_url TEXT`); } catch (e) {}

function addUpcomingRace({ track, starts_at, note, event_name, image_url }) {
  return db
    .prepare(
      'INSERT INTO upcoming_races (track, starts_at, note, event_name, image_url) VALUES (?, ?, ?, ?, ?)'
    )
    .run(track, starts_at, note || null, event_name || null, image_url || null);
}

function getUpcomingRaces(limit = 5) {
  return db
    .prepare(
      `SELECT * FROM upcoming_races
       WHERE datetime(starts_at) >= datetime('now')
       ORDER BY datetime(starts_at) ASC
       LIMIT ?`
    )
    .all(limit);
}

function clearPastRaces() {
  return db
    .prepare(`DELETE FROM upcoming_races WHERE datetime(starts_at) < datetime('now')`)
    .run();
}

// ---------- Bulk import (for seeding leaderboard from CSV/JSON) ----------
const insertRaceStmt = db.prepare(
  'INSERT INTO races (player, track, time_ms) VALUES (?, ?, ?)'
);
const importMany = db.transaction((rows) => {
  let count = 0;
  for (const row of rows) {
    if (!row.player || !row.track || !Number.isFinite(Number(row.time_ms))) continue;
    insertRaceStmt.run(String(row.player), String(row.track), Number(row.time_ms));
    count++;
  }
  return count;
});

module.exports = {
  addRace,
  getLeaderboard,
  getTracks,
  addUpcomingRace,
  getUpcomingRaces,
  clearPastRaces,
  importMany,
};