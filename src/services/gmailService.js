const { google } = require('googleapis');
const claudeService = require('./claudeService');

function createOAuth2Client(tokens) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  oauth2Client.setCredentials(tokens);
  return oauth2Client;
}

function decodeBase64Url(data) {
  if (!data) return '';
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + (4 - base64.length % 4) % 4, '=');
  return Buffer.from(padded, 'base64').toString('utf-8');
}

function extractTextFromParts(parts) {
  if (!parts) return '';
  let text = '';
  for (const part of parts) {
    if (part.mimeType === 'text/plain' && part.body && part.body.data) {
      text += decodeBase64Url(part.body.data);
    } else if (part.parts) {
      text += extractTextFromParts(part.parts);
    }
  }
  return text;
}

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
    if (messages.length === 0) {
      return [];
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

        let body = '';
        if (detail.data.payload.body && detail.data.payload.body.data) {
          body = decodeBase64Url(detail.data.payload.body.data);
        } else if (detail.data.payload.parts) {
          body = extractTextFromParts(detail.data.payload.parts);
        }

        const bodyTruncated = body.substring(0, 1000);
        const combinedText = '件名: ' + subject + '\n\n本文:\n' + bodyTruncated;

        const result = await claudeService.extractTasks(combinedText, today);

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

    return allTasks;
  } catch (error) {
    console.error('Gmail scanEmails error:', error.message);
    throw error;
  }
}

module.exports = { scanEmails };
