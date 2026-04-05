const { google } = require('googleapis');
const claudeService = require('./claudeService');

/**
 * Google OAuth2クライアントを作成
 */
function createOAuth2Client(tokens) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  oauth2Client.setCredentials(tokens);
  return oauth2Client;
}

/**
 * base64url をデコードしてUTF-8文字列に変換
 */
function decodeBase64Url(data) {
  if (!data) return '';
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + (4 - base64.length % 4) % 4, '=');
  return Buffer.from(padded, 'base64').toString('utf-8');
}

/**
 * HTMLタグを除去してプレーンテキストに変換
 */
function stripHtml(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * メールパーツからテキストを再帰的に抽出（text/plain優先、なければtext/html）
 */
function extractTextFromParts(parts) {
  if (!parts) return '';
  let plainText = '';
  let htmlText = '';
  for (const part of parts) {
    if (part.mimeType === 'text/plain' && part.body && part.body.data) {
      plainText += decodeBase64Url(part.body.data);
    } else if (part.mimeType === 'text/html' && part.body && part.body.data) {
      htmlText += decodeBase64Url(part.body.data);
    } else if (part.parts) {
      const nested = extractTextFromParts(part.parts);
      plainText += nested;
    }
  }
  return plainText || stripHtml(htmlText);
}

/**
 * スター付きメールを取得してタスクを抽出
 */
async function scanEmails(tokens) {
  const auth = createOAuth2Client(tokens);
  const gmail = google.gmail({ version: 'v1', auth });

  try {
    const listResponse = await gmail.users.messages.list({
      userId: 'me',
      q: 'is:starred',
      maxResults: 20
    });

    const messages = listResponse.data.messages || [];
    console.log('[Gmail] starred messages found: ' + messages.length);
    if (messages.length === 0) {
      return { tasks: [], scannedCount: 0 };
    }

    const today = new Date().toISOString().split('T')[0];
    const allTasks = [];

    for (const msg of messages) {
      try {
        const detail = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id,
          format: 'full'
        });

        const headers = detail.data.payload.headers || [];
        const subjectHeader = headers.find(h => h.name.toLowerCase() === 'subject');
        const subject = subjectHeader ? subjectHeader.value : '（件名なし）';

        // 本文を抽出
        let body = '';
        const mimeType = detail.data.payload.mimeType || '';
        if (detail.data.payload.body && detail.data.payload.body.data) {
          const raw = decodeBase64Url(detail.data.payload.body.data);
          body = mimeType.includes('html') ? stripHtml(raw) : raw;
        } else if (detail.data.payload.parts) {
          body = extractTextFromParts(detail.data.payload.parts);
        }

        const bodyTruncated = body.substring(0, 1500);
        const combinedText = '件名: ' + subject + '\n\n本文:\n' + bodyTruncated;

        const result = await claudeService.extractTasks(combinedText, today);

        console.log('[Gmail] subject: ' + subject + ', bodyLen: ' + body.length);
        if (result.tasks && result.tasks.length > 0) {
          const tasksWithSource = result.tasks.map(t => ({
            ...t,
            source: t.source || subject.substring(0, 20)
          }));
          allTasks.push(...tasksWithSource);
        }
      } catch (msgError) {
        console.error('Error processing message ' + msg.id + ':', msgError.message);
      }
    }

    return { tasks: allTasks, scannedCount: messages.length };
  } catch (error) {
    console.error('Gmail scanEmails error:', error.message);
    throw error;
  }
}

module.exports = { scanEmails };
