const { google } = require('googleapis');
const crypto = require('crypto');
const dbService = require('./dbService');
const calendarService = require('./calendarService');

function createOAuth2Client(tokens) {
  const oauth2Client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI);
  oauth2Client.setCredentials(tokens);
  return oauth2Client;
}

async function addGoogleTask(taskData, tokens) {
  const auth = createOAuth2Client(tokens);
  const tasksApi = google.tasks({ version: 'v1', auth });
  const task = { title: taskData.title, notes: taskData.notes || '' };
  if (taskData.dueDate) task.due = `${taskData.dueDate}T00:00:00.000Z`;
  try {
    const response = await tasksApi.tasks.insert({ tasklist: '@default', resource: task });
    return response.data.id;
  } catch (error) {
    console.error('Google Tasks addGoogleTask error:', error.message);
    throw error;
  }
}

async function completeGoogleTask(taskId, tokens) {
  const auth = createOAuth2Client(tokens);
  const tasksApi = google.tasks({ version: 'v1', auth });
  try { await tasksApi.tasks.patch({ tasklist: '@default', task: taskId, resource: { status: 'completed' } }); }
  catch (error) { console.error('Google Tasks completeGoogleTask error:', error.message); throw error; }
}

async function deleteGoogleTask(taskId, tokens) {
  const auth = createOAuth2Client(tokens);
  const tasksApi = google.tasks({ version: 'v1', auth });
  try { await tasksApi.tasks.delete({ tasklist: '@default', task: taskId }); }
  catch (error) { console.error('Google Tasks deleteGoogleTask error:', error.message); throw error; }
}

async function registerTask(taskData, tokens, lineUserId) {
  const localId = crypto.randomUUID();
  let googleTaskId = null;
  let googleEventId = null;
  try {
    if (tokens) {
      googleTaskId = await addGoogleTask(taskData, tokens);
      if (taskData.dueDate) googleEventId = await calendarService.addEvent(taskData, tokens);
    }
  } catch (error) {
    console.error('registerTask Google API error:', error.message);
  }
  const savedTask = {
    id: localId, title: taskData.title, dueDate: taskData.dueDate||null, dueTime: taskData.dueTime||null,
    priority: taskData.priority||'medium', category: taskData.category||'その他', status: 'pending',
    notes: taskData.notes||null, source: taskData.source||null, googleTaskId, googleEventId, lineUserId: lineUserId||null
  };
  await dbService.saveTask(savedTask);
  return savedTask;
}

module.exports = { addGoogleTask, completeGoogleTask, deleteGoogleTask, registerTask };
