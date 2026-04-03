const express = require('express');
const router = express.Router();
const line = require('@line/bot-sdk');
const crypto = require('crypto');

const claudeService = require('../services/claudeService');
const lineService = require('../services/lineService');
const dbService = require('../services/dbService');
const taskService = require('../services/taskService');
const calendarService = require('../services/calendarService');

const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET
};

const client = new line.messagingApi.MessagingApiClient({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN
});

router.post('/', line.middleware(lineConfig), async (req, res) => {
  res.status(200).end();
  const events = req.body.events || [];
  for (const event of events) {
    try { await handleEvent(event, req.app); }
    catch (err) { console.error('LINE event handling error:', err.message); }
  }
});

async function handleEvent(event, app) {
  if (event.type !== 'message' || event.message.type !== 'text') return;

  const userId = event.source.userId;
  const replyToken = event.replyToken;
  const text = event.message.text.trim();
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });

  const googleTokens = app.locals.googleTokens || {};
  let tokens = googleTokens[userId] || null;
  if (!tokens) {
    tokens = await dbService.getUserTokens(userId);
    if (tokens) {
      if (!app.locals.googleTokens) app.locals.googleTokens = {};
      app.locals.googleTokens[userId] = tokens;
    }
  }
  console.log(`[LINE] userId=${userId}, hasToken=${!!tokens}`);

  async function reply(messages) {
    const messageArray = Array.isArray(messages) ? messages : [messages];
    await client.replyMessage({ replyToken, messages: messageArray });
  }

  if (text === '全て登録') {
    if (!tokens) return reply(buildAuthRequiredMessage(userId));
    const pending = await dbService.getPendingConfirmation(userId);
    if (!pending) return reply({ type: 'text', text: '登録待ちのタスクがありません。' });
    const registeredTasks = [];
    for (const task of pending.tasks) {
      try { registeredTasks.push(await taskService.registerTask(task, tokens, userId)); }
      catch (err) { console.error('registerTask error:', err.message); }
    }
    await dbService.deletePendingConfirmation(userId);
    return reply(lineService.buildResultMessage(registeredTasks));
  }

  if (text === 'キャンセル') {
    await dbService.deletePendingConfirmation(userId);
    return reply({ type: 'text', text: 'キャンセルしました。' });
  }

  if (text === '選んで登録') {
    const pending = await dbService.getPendingConfirmation(userId);
    if (!pending) return reply({ type: 'text', text: '登録待ちのタスクがありません。' });
    return reply(lineService.buildSelectMessage(pending.tasks));
  }

  if (text === '決定') {
    if (!tokens) return reply(buildAuthRequiredMessage(userId));
    const pending = await dbService.getPendingConfirmation(userId);
    if (!pending) return reply({ type: 'text', text: '登録待ちのタスクがありません。' });
    const selectedTasks = pending.tasks.filter(t => t.selected === true);
    if (selectedTasks.length === 0) return reply({ type: 'text', text: 'タスクが選択されていません。番号をタップして選んでください。' });
    const registeredTasks = [];
    for (const task of selectedTasks) {
      try { registeredTasks.push(await taskService.registerTask(task, tokens, userId)); }
      catch (err) { console.error('registerTask error:', err.message); }
    }
    await dbService.deletePendingConfirmation(userId);
    return reply(lineService.buildResultMessage(registeredTasks));
  }

  const numberMatch = text.match(/^(\d+)番$/);
  if (numberMatch) {
    const pending = await dbService.getPendingConfirmation(userId);
    if (!pending) return reply({ type: 'text', text: '登録待ちのタスクがありません。' });
    const index = parseInt(numberMatch[1], 10) - 1;
    if (index < 0 || index >= pending.tasks.length) return reply({ type: 'text', text: `${numberMatch[1]}番のタスクは存在しません。` });
    const updatedTasks = pending.tasks.map((t, i) => i === index ? { ...t, selected: !t.selected } : t);
    await dbService.savePendingConfirmation(pending.id, userId, updatedTasks);
    const selectedList = updatedTasks.map((t, i) => `${t.selected ? '✅' : '　'} ${i + 1}. ${t.title}`).join('\n');
    return reply({ type: 'text', text: `選択状態を更新しました:\n\n${selectedList}\n\n選び終わったら「決定」を押してください。` });
  }

  const result = await claudeService.extractTasks(text, today);

  if (result.command === 'list') {
    const tasks = await dbService.getAllTasks(userId);
    return reply(lineService.formatTaskList(tasks));
  }

  if (result.command === 'complete') {
    if (result.tasks && result.tasks.length > 0) {
      const found = await dbService.findTaskByTitle(result.tasks[0].title, userId);
      if (!found) return reply({ type: 'text', text: `「${result.tasks[0].title}」に一致するタスクが見つかりませんでした。` });
      if (found.google_task_id && tokens) { try { await taskService.completeGoogleTask(found.google_task_id, tokens); } catch(e) {} }
      if (found.google_event_id && tokens) { try { await calendarService.markEventDone(found.google_event_id, tokens); } catch(e) {} }
      await dbService.updateTaskStatus(found.id, 'completed');
      return reply({ type: 'text', text: `✅「${found.title}」を完了しました！` });
    }
    return reply({ type: 'text', text: 'タスク名を指定してください。例：「企画書提出 完了」' });
  }

  if (result.command === 'delete') {
    if (result.tasks && result.tasks.length > 0) {
      const found = await dbService.findTaskByTitle(result.tasks[0].title, userId);
      if (!found) return reply({ type: 'text', text: `「${result.tasks[0].title}」に一致するタスクが見つかりませんでした。` });
      if (found.google_task_id && tokens) { try { await taskService.deleteGoogleTask(found.google_task_id, tokens); } catch(e) {} }
      if (found.google_event_id && tokens) { try { await calendarService.deleteEvent(found.google_event_id, tokens); } catch(e) {} }
      await dbService.deleteTask(found.id);
      return reply({ type: 'text', text: `🗑️「${found.title}」を削除しました。` });
    }
    return reply({ type: 'text', text: 'タスク名を指定してください。例：「企画書提出 削除」' });
  }

  if (result.tasks && result.tasks.length > 0) {
    if (!tokens) return reply(buildAuthRequiredMessage(userId));
    const confirmId = crypto.randomUUID();
    await dbService.savePendingConfirmation(confirmId, userId, result.tasks);
    return reply(lineService.buildConfirmMessage(result.tasks));
  }

  return reply({ type: 'text', text: 'タスクが見つかりませんでした。「明日14時に歯医者」のように送ってみてください。' });
}

function buildAuthRequiredMessage(userId) {
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  const loginUrl = userId ? `${baseUrl}/auth/google?lineUserId=${encodeURIComponent(userId)}` : `${baseUrl}/auth/google`;
  return { type: 'text', text: `Googleアカウントの認証が必要です。\n以下のURLをブラウザで開いてログインしてください:\n${loginUrl}` };
}

module.exports = router;
