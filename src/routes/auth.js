const express = require('express');
const { google } = require('googleapis');
const router = express.Router();
const dbService = require('../services/dbService');

function createOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

// GET /auth/google - Google ログイン開始
// ?lineUserId=Uxxxx を受け取り、state に埋め込む
router.get('/google', (req, res) => {
  // LINE内ブラウザ（WebView）はGoogleがブロックするため案内ページを表示
  const ua = req.headers['user-agent'] || '';
  if (ua.includes('Line/')) {
    const currentUrl = process.env.BASE_URL + '/auth/google' + (req.query.lineUserId ? '?lineUserId=' + req.query.lineUserId : '');
    return res.send('<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ブラウザで開いてください</title><style>body{font-family:sans-serif;padding:24px;max-width:480px;margin:0 auto;line-height:1.6}h2{color:#333}a{color:#1a73e8;word-break:break-all}.box{background:#f5f5f5;border-radius:8px;padding:16px;margin:16px 0}</style></head><body><h2>⚠️ ブラウザで開いてください</h2><p>LINEアプリ内ではGoogleログインができません。</p><p>以下のURLをコピーして <strong>Safari</strong> または <strong>Chrome</strong> で開いてください：</p><div class="box"><a href="' + currentUrl + '">' + currentUrl + '</a></div><p>URLを長押しするとコピーできます。</p></body></html>');
  }

  const oauth2Client = createOAuth2Client();
  const scopes = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/tasks',
    'https://www.googleapis.com/auth/calendar'
  ];

  const lineUserId = req.query.lineUserId || req.session.lineUserId || '';
  const state = lineUserId ? Buffer.from(lineUserId).toString('base64') : '';

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: scopes,
    state: state || undefined
  });

  res.redirect(url);
});

// GET /auth/callback - OAuth コールバック
router.get('/callback', async (req, res) => {
  const { code, error, state } = req.query;

  if (error) {
    console.error('OAuth error:', error);
    return res.redirect('/?error=auth_failed');
  }

  if (!code) {
    return res.redirect('/?error=no_code');
  }

  try {
    const oauth2Client = createOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);

    req.session.googleTokens = tokens;

    if (state) {
      try {
        const lineUserId = Buffer.from(state, 'base64').toString('utf8');
        if (lineUserId && lineUserId.startsWith('U')) {
          if (!req.app.locals.googleTokens) {
            req.app.locals.googleTokens = {};
          }
          req.app.locals.googleTokens[lineUserId] = tokens;
          dbService.saveUserTokens(lineUserId, tokens);
          req.session.lineUserId = lineUserId; // Web画面のフィルタ用
          console.log('Google tokens linked to LINE user: ' + lineUserId);
        }
      } catch (e) {
        console.error('Failed to decode state:', e.message);
      }
    }

    res.redirect('/');
  } catch (err) {
    console.error('Token exchange error:', err.message);
    res.redirect('/?error=token_failed');
  }
});

// GET /auth/status
router.get('/status', (req, res) => {
  const loggedIn = !!(req.session && req.session.googleTokens);
  res.json({ loggedIn });
});

// GET /auth/logout
router.get('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) console.error('Session destroy error:', err.message);
    res.redirect('/');
  });
});

module.exports = router;
