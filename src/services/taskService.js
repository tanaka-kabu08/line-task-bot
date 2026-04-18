const { google } = require('googleapis');
const crypto = require('crypto');
const dbService = require('./dbService');
const calendarService = require('./calendarService');

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

const LIST_NAME_DATED = '📅 予定・期限あり';
const LIST_NAME_UNDATED = '🛒 買い物・やること';

/**
 * 指定名のタスクリストを取得、なければ作成してIDを返す
 */
async function getOrCreateTaskList(tasksApi, listName) {
  const res = await tasksApi.tasklists.list({ maxResults: 100 });
  const lists = res.data.items || [];
  const found = lists.find(l => l.title === listName);
  if (found) return found.id;

  const created = await tasksApi.tasklists.insert({ requestBody: { title: listName } });
  return created.data.id;
}

/**
 * Google Tasks にタスクを追加
 * @returns {string} 作成したタスクのID
 */
async function addGoogleTask(taskData, tokens) {
  const auth = createOAuth2Client(tokens);
  const tasksApi = google.tasks({ version: 'v1', auth });

  const listName = taskData.dueDate ? LIST_NAME_DATED : LIST_NAME_UNDATED;
  const tasklistId = await getOrCreateTaskList(tasksApi, listName);

  const task = {
    title: taskData.title,
    notes: taskData.notes || ''
  };

  if (taskData.dueDate) {
    task.due = `${taskData.dueDate}T00:00:00.000Z`;
  }

  try {
    const response = await tasksApi.tasks.insert({
      tasklist: tasklistId,
      requestBody: task
    });
    return response.data.id;
  } catch (error) {
    console.error('Google Tasks addGoogleTask error:', error.message);
    throw error;
  }
}

/**
 * タスクIDが属するリストIDを全リストから検索して返す
 */
async function findTaskListId(tasksApi, taskId) {
  const res = await tasksApi.tasklists.list({ maxResults: 100 });
  const lists = res.data.items || [];
  for (const list of lists) {
    try {
      await tasksApi.tasks.get({ tasklist: list.id, task: taskId });
      return list.id;
    } catch {
      // このリストには存在しない
    }
  }
  return '@default';
}

/**
 * Google Tasks のタスクを完了にする
 */
async function completeGoogleTask(taskId, tokens) {
  const auth = createOAuth2Client(tokens);
  const tasksApi = google.tasks({ version: 'v1', auth });

  try {
    const tasklistId = await findTaskListId(tasksApi, taskId);
    await tasksApi.tasks.patch({
      tasklist: tasklistId,
      task: taskId,
      requestBody: { status: 'completed' }
    });
  } catch (error) {
    console.error('Google Tasks completeGoogleTask error:', error.message);
    throw error;
  }
}

/**
 * Google Tasks のタスクを削除
 */
async function deleteGoogleTask(taskId, tokens) {
  const auth = createOAuth2Client(tokens);
  const tasksApi = google.tasks({ version: 'v1', auth });

  try {
    const tasklistId = await findTaskListId(tasksApi, taskId);
    await tasksApi.tasks.delete({
      tasklist: tasklistId,
      task: taskId
    });
  } catch (error) {
    console.error('Google Tasks deleteGoogleTask error:', error.message);
    throw error;
  }
}

/**
 * タスクをGoogle Tasks・Google Calendar・DBに一括登録するメイン関数
 * @param {Object} taskData - タスクデータ
 * @param {Object} tokens - Google OAuthトークン
 * @param {string} lineUserId - LINE ユーザーID（任意）
 * @returns {Object} 登録したタスクデータ
 */
async function registerTask(taskData, tokens, lineUserId) {
  const localId = crypto.randomUUID();

  let googleTaskId = null;
  let googleEventId = null;

  try {
    // Google Tasks に登録
    if (tokens) {
      googleTaskId = await addGoogleTask(taskData, tokens);

      // dueDate がある場合は Google Calendar にも登録
      if (taskData.dueDate) {
        console.log('[calendar] addEvent input:', JSON.stringify({ dueDate: taskData.dueDate, dueTime: taskData.dueTime }));
        googleEventId = await calendarService.addEvent(taskData, tokens);
        console.log('[calendar] addEvent success, eventId:', googleEventId);
      }
    }
  } catch (error) {
    console.error('registerTask Google API error:', error.message);
    // invalid_grant はトークン期限切れ → 上位に伝えて再認証を促す
    if (error.message && error.message.includes('invalid_grant')) {
      throw error;
    }
    // その他のGoogle APIエラーはログだけ残してDB保存は続行
  }

  const savedTask = {
    id: localId,
    title: taskData.title,
    dueDate: taskData.dueDate || null,
    dueTime: taskData.dueTime || null,
    priority: taskData.priority || 'medium',
    category: taskData.category || 'その他',
    status: 'pending',
    notes: taskData.notes || null,
    source: taskData.source || null,
    googleTaskId,
    googleEventId,
    lineUserId: lineUserId || null
  };

  // DB に保存
  await dbService.saveTask(savedTask);

  return savedTask;
}

module.exports = {
  addGoogleTask,
  completeGoogleTask,
  deleteGoogleTask,
  registerTask
};
