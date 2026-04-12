const { google } = require('googleapis');

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
 * 今週（月曜〜日曜）のカレンダーイベントを取得
 */
async function getThisWeekEvents(tokens) {
  const auth = createOAuth2Client(tokens);
  const calendar = google.calendar({ version: 'v3', auth });

  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=日, 1=月, ...
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

  const monday = new Date(now);
  monday.setDate(now.getDate() - daysFromMonday);
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  try {
    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: monday.toISOString(),
      timeMax: sunday.toISOString(),
      singleEvents: true,
      orderBy: 'startTime'
    });
    return response.data.items || [];
  } catch (error) {
    console.error('Calendar getThisWeekEvents error:', error.message);
    throw error;
  }
}

/**
 * カレンダーにイベントを追加
 * @returns {string} 作成したイベントのID
 */
async function addEvent(taskData, tokens) {
  const auth = createOAuth2Client(tokens);
  const calendar = google.calendar({ version: 'v3', auth });

  // colorId: priority=high→"11", medium→"5", low→"2"
  const colorMap = { high: '11', medium: '5', low: '2' };
  const colorId = colorMap[taskData.priority] || '5';

  let start, end;

  if (taskData.dueDate && taskData.dueTime) {
    // dateTime形式（時刻あり）
    const startDateTime = `${taskData.dueDate}T${taskData.dueTime}:00+09:00`;
    const [h, m] = taskData.dueTime.split(':').map(Number);
    const endH = String(h + 1).padStart(2, '0');
    const endDateTime = `${taskData.dueDate}T${endH}:${String(m).padStart(2, '0')}:00+09:00`;

    start = { dateTime: startDateTime, timeZone: 'Asia/Tokyo' };
    end = { dateTime: endDateTime, timeZone: 'Asia/Tokyo' };
  } else if (taskData.dueDate) {
    // date形式（終日イベント）
    start = { date: taskData.dueDate };
    end = { date: taskData.dueDate };
  } else {
    // 期限なし → 今日の終日イベントとして登録
    const today = new Date().toISOString().split('T')[0];
    start = { date: today };
    end = { date: today };
  }

  const event = {
    summary: `📌 ${taskData.title}`,
    description: taskData.notes || '',
    start,
    end,
    colorId,
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: 60 },  // 1時間前
        { method: 'popup', minutes: 1440 }  // 1日前
      ]
    }
  };

  try {
    const response = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: event
    });
    return response.data.id;
  } catch (error) {
    console.error('Calendar addEvent error:', error.message);
    throw error;
  }
}

/**
 * イベントのsummaryの先頭に「✅ 」を追加（完了マーク）
 */
async function markEventDone(eventId, tokens) {
  const auth = createOAuth2Client(tokens);
  const calendar = google.calendar({ version: 'v3', auth });

  try {
    const { data: event } = await calendar.events.get({
      calendarId: 'primary',
      eventId
    });

    if (!event.summary.startsWith('✅')) {
      event.summary = `✅ ${event.summary}`;
    }

    await calendar.events.update({
      calendarId: 'primary',
      eventId,
      requestBody: event
    });
  } catch (error) {
    console.error('Calendar markEventDone error:', error.message);
    throw error;
  }
}

/**
 * イベントを削除
 */
async function deleteEvent(eventId, tokens) {
  const auth = createOAuth2Client(tokens);
  const calendar = google.calendar({ version: 'v3', auth });

  try {
    await calendar.events.delete({
      calendarId: 'primary',
      eventId
    });
  } catch (error) {
    console.error('Calendar deleteEvent error:', error.message);
    throw error;
  }
}

module.exports = { getThisWeekEvents, addEvent, markEventDone, deleteEvent };
