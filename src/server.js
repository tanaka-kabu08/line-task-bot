require('dotenv').config({ override: true });
const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// data/ ディレクトリを自動作成
const dataDir = path.join(__dirname, '../data');
fs.mkdirSync(dataDir, { recursive: true });

// express-session の設定
app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

// LINE Webhook は @line/bot-sdk のミドルウェアを使うため、先に登録
const lineRouter = require('./routes/line');
app.use('/webhook/line', lineRouter);

// 静的ファイル配信
app.use(express.static(path.join(__dirname, '../public')));

// JSON ボディパーサー（LINE Webhook 以外のルート用）
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Google認証関連ルート
const authRouter = require('./routes/auth');
app.use('/auth', authRouter);

// Gmail APIルート
const gmailRouter = require('./routes/gmail');
app.use('/api/gmail', gmailRouter);

// タスク・カレンダー関連ルート
const tasksRouter = require('./routes/tasks');
app.use('/api', tasksRouter);

// ルートパスはindex.htmlを返す
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT}`);
});
