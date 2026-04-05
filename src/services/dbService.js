const path = require('path');
const fs = require('fs');

const isPostgres = !!process.env.DATABASE_URL;
let pool, db;

if (isPostgres) {
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
} else {
  const Database = require('better-sqlite3');
  const dataDir = path.join(__dirname, '../../data');
  fs.mkdirSync(dataDir, { recursive: true });
  db = new Database(path.join(dataDir, 'tasks.db'));
}

// ? → $1, $2, ... に変換（PostgreSQL用）
function toPositional(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// INSERT OR REPLACE → ON CONFLICT upsert（PostgreSQL用）
function upsertSQL(table, conflictCol, cols) {
  const placeholders = cols.map(() => '?').join(', ');
  const setCols = cols.filter(c => c !== conflictCol).map(c => `${c} = EXCLUDED.${c}`).join(', ');
  if (isPostgres) {
    return `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders}) ON CONFLICT (${conflictCol}) DO UPDATE SET ${setCols}`;
  }
  return `INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`;
}

async function run(sql, params = []) {
  if (isPostgres) {
    await pool.query(toPositional(sql), params);
  } else {
    db.prepare(sql).run(...params);
  }
}

async function get(sql, params = []) {
  if (isPostgres) {
    const r = await pool.query(toPositional(sql), params);
    return r.rows[0] || null;
  }
  return db.prepare(sql).get(...params) || null;
}

async function all(sql, params = []) {
  if (isPostgres) {
    const r = await pool.query(toPositional(sql), params);
    return r.rows;
  }
  return db.prepare(sql).all(...params);
}

// テーブル作成
async function initDB() {
  if (isPostgres) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_tokens (
        line_user_id TEXT PRIMARY KEY,
        tokens_json TEXT NOT NULL,
        updated_at TEXT
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        due_date TEXT,
        due_time TEXT,
        priority TEXT DEFAULT 'medium',
        category TEXT DEFAULT 'その他',
        status TEXT DEFAULT 'pending',
        notes TEXT,
        source TEXT,
        google_task_id TEXT,
        google_event_id TEXT,
        line_user_id TEXT,
        created_at TEXT
      );
      CREATE TABLE IF NOT EXISTS pending_confirmations (
        id TEXT PRIMARY KEY,
        line_user_id TEXT NOT NULL,
        tasks_json TEXT NOT NULL,
        created_at TEXT
      );
      CREATE TABLE IF NOT EXISTS processed_emails (
        line_user_id TEXT NOT NULL,
        email_id TEXT NOT NULL,
        processed_at TEXT,
        PRIMARY KEY (line_user_id, email_id)
      );
    `);
  } else {
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_tokens (
        line_user_id TEXT PRIMARY KEY,
        tokens_json TEXT NOT NULL,
        updated_at TEXT DEFAULT (datetime('now', 'localtime'))
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        due_date TEXT,
        due_time TEXT,
        priority TEXT DEFAULT 'medium',
        category TEXT DEFAULT 'その他',
        status TEXT DEFAULT 'pending',
        notes TEXT,
        source TEXT,
        google_task_id TEXT,
        google_event_id TEXT,
        line_user_id TEXT,
        created_at TEXT DEFAULT (datetime('now', 'localtime'))
      );
      CREATE TABLE IF NOT EXISTS pending_confirmations (
        id TEXT PRIMARY KEY,
        line_user_id TEXT NOT NULL,
        tasks_json TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now', 'localtime'))
      );
      CREATE TABLE IF NOT EXISTS processed_emails (
        line_user_id TEXT NOT NULL,
        email_id TEXT NOT NULL,
        processed_at TEXT DEFAULT (datetime('now', 'localtime')),
        PRIMARY KEY (line_user_id, email_id)
      );
    `);
  }
}

initDB().catch(err => console.error('DB init error:', err));

const now = () => new Date().toISOString();

async function savePendingConfirmation(id, lineUserId, tasks, page = 0) {
  const sql = upsertSQL('pending_confirmations', 'id', ['id', 'line_user_id', 'tasks_json', 'created_at']);
  await run(sql, [id, lineUserId, JSON.stringify({ tasks, page }), now()]);
}

async function getPendingConfirmation(lineUserId) {
  const row = await get(
    'SELECT * FROM pending_confirmations WHERE line_user_id = ? ORDER BY created_at DESC LIMIT 1',
    [lineUserId]
  );
  if (!row) return null;
  const parsed = JSON.parse(row.tasks_json);
  const tasks = Array.isArray(parsed) ? parsed : parsed.tasks;
  const page = Array.isArray(parsed) ? 0 : (parsed.page || 0);
  return {
    id: row.id,
    lineUserId: row.line_user_id,
    tasks,
    page,
    createdAt: row.created_at
  };
}

async function deletePendingConfirmation(lineUserId) {
  await run('DELETE FROM pending_confirmations WHERE line_user_id = ?', [lineUserId]);
}

async function saveTask(taskData) {
  const sql = upsertSQL('tasks', 'id', [
    'id', 'title', 'due_date', 'due_time', 'priority', 'category',
    'status', 'notes', 'source', 'google_task_id', 'google_event_id', 'line_user_id', 'created_at'
  ]);
  await run(sql, [
    taskData.id,
    taskData.title,
    taskData.dueDate || null,
    taskData.dueTime || null,
    taskData.priority || 'medium',
    taskData.category || 'その他',
    taskData.status || 'pending',
    taskData.notes || null,
    taskData.source || null,
    taskData.googleTaskId || null,
    taskData.googleEventId || null,
    taskData.lineUserId || null,
    now()
  ]);
}

async function getAllTasks(lineUserId) {
  if (lineUserId) {
    return all("SELECT * FROM tasks WHERE status = 'pending' AND line_user_id = ? ORDER BY created_at DESC", [lineUserId]);
  }
  return all("SELECT * FROM tasks WHERE status = 'pending' ORDER BY created_at DESC");
}

async function updateTaskStatus(id, status) {
  await run('UPDATE tasks SET status = ? WHERE id = ?', [status, id]);
}

async function updateTaskGoogleIds(id, googleTaskId, googleEventId) {
  await run('UPDATE tasks SET google_task_id = ?, google_event_id = ? WHERE id = ?', [googleTaskId, googleEventId, id]);
}

async function deleteTask(id) {
  await run('DELETE FROM tasks WHERE id = ?', [id]);
}

async function findTaskByTitle(title, lineUserId) {
  if (lineUserId) {
    return get(
      "SELECT * FROM tasks WHERE title LIKE ? AND line_user_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1",
      [`%${title}%`, lineUserId]
    );
  }
  return get(
    "SELECT * FROM tasks WHERE title LIKE ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1",
    [`%${title}%`]
  );
}

async function saveProcessedEmailIds(lineUserId, emailIds) {
  for (const emailId of emailIds) {
    const sql = isPostgres
      ? 'INSERT INTO processed_emails (line_user_id, email_id, processed_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING'
      : 'INSERT OR IGNORE INTO processed_emails (line_user_id, email_id, processed_at) VALUES (?, ?, ?)';
    await run(sql, [lineUserId, emailId, now()]);
  }
}

async function getProcessedEmailIds(lineUserId) {
  const rows = await all('SELECT email_id FROM processed_emails WHERE line_user_id = ?', [lineUserId]);
  return new Set(rows.map(r => r.email_id));
}

async function saveUserTokens(lineUserId, tokens) {
  const sql = upsertSQL('user_tokens', 'line_user_id', ['line_user_id', 'tokens_json', 'updated_at']);
  await run(sql, [lineUserId, JSON.stringify(tokens), now()]);
}

async function getUserTokens(lineUserId) {
  const row = await get('SELECT tokens_json FROM user_tokens WHERE line_user_id = ?', [lineUserId]);
  if (!row) return null;
  try { return JSON.parse(row.tokens_json); } catch { return null; }
}

module.exports = {
  savePendingConfirmation,
  getPendingConfirmation,
  deletePendingConfirmation,
  saveTask,
  getAllTasks,
  updateTaskStatus,
  updateTaskGoogleIds,
  deleteTask,
  findTaskByTitle,
  saveProcessedEmailIds,
  getProcessedEmailIds,
  saveUserTokens,
  getUserTokens
};
