const express = require('express');
const router = express.Router();
const line = require('@line/bot-sdk');
const crypto = require('crypto');

const claudeService = require('../services/claudeService');
const lineService = require('../services/lineService');
const dbService = require('../services/dbService');
const taskService = require('../services/taskService');
const calendarService = require('../services/calendarService');
const gmailService = require('../services/gmailService');

const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET
};

// LINE SDK クライアント
const client = new line.messagingApi.MessagingApiClient({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN
});

// LINE Webhook のミドルウェア（署名検証 + rawBody解析）
router.post(
  '/',
  line.middleware(lineConfig),
  async (req, res) => {
    // 即座に200を返す（LINEの仕様）
    res.status(200).end();

    const events = req.body.events || [];
    for (const event of events) {
      try {
        await handleEvent(event, req.app);
      } catch (err) {
        console.error('LINE event handling error:', err.message, err.stack);
      }
    }
  }
);

/**
 * LINE イベントを処理するメイン関数
 */
async function handleEvent(event, app) {
  if (event.type !== 'message' || event.message.type !== 'text') return;

  const userId = event.source.userId;
  const replyToken = event.replyToken;
  const text = event.message.text.trim();
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }); // YYYY-MM-DD

  // LINE ユーザーに紐づく Google トークンをメモリ→DBの順で取得
  const googleTokens = app.locals.googleTokens || {};
  let tokens = googleTokens[userId] || null;
  if (!tokens) {
    tokens = await dbService.getUserTokens(userId);
    if (tokens) {
      // メモリにキャッシュ
      if (!app.locals.googleTokens) app.locals.googleTokens = {};
      app.locals.googleTokens[userId] = tokens;
    }
  }
  console.log(`[LINE] userId=${userId}, hasToken=${!!tokens}`);

  /**
   * LINEに返信するヘルパー
   */
  async function reply(messages) {
    const messageArray = Array.isArray(messages) ? messages : [messages];
    await client.replyMessage({
      replyToken,
      messages: messageArray
    });
  }

  // --- コマンド分岐 ---

  // 「メール確認」
  if (text === 'メール確認') {
    if (!tokens) {
      return reply(buildAuthRequiredMessage(userId));
    }
    await reply({ type: 'text', text: 'スター付きメールをスキャン中です。少々お待ちください...' });
    const processedIds = await dbService.getProcessedEmailIds(userId);
    gmailService.scanEmails(tokens, processedIds).then(async ({ tasks, scannedCount }) => {
      if (!tasks || tasks.length === 0) {
        const msg = scannedCount === 0
          ? 'スター付きメールが見つかりませんでした。\nGmailでメールに⭐スターを付けてから試してください。'
          : `${scannedCount}件のスター付きメールをスキャンしましたが、タスクは見つかりませんでした。`;
        await client.pushMessage({ to: userId, messages: [{ type: 'text', text: msg }] });
        return;
      }
      const confirmId = crypto.randomUUID();
      await dbService.savePendingConfirmation(confirmId, userId, tasks);
      await client.pushMessage({ to: userId, messages: [lineService.buildConfirmMessage(tasks)] });
    }).catch(async (err) => {
      console.error('Gmail scan error:', err.message);
      await client.pushMessage({ to: userId, messages: [{ type: 'text', text: 'エラー: ' + err.message }] });
    });
    return;
  }

  // 「全て登録」
  if (text === '全て登録') {
    if (!tokens) {
      return reply(buildAuthRequiredMessage(userId));
    }
    const pending = await dbService.getPendingConfirmation(userId);
    if (!pending) {
      return reply({ type: 'text', text: '登録待ちのタスクがありません。' });
    }

    const registeredTasks = [];
    for (const task of pending.tasks) {
      try {
        const registered = await taskService.registerTask(task, tokens, userId);
        registeredTasks.push(registered);
      } catch (err) {
        console.error('registerTask error:', err.message);
      }
    }

    const emailIds = pending.tasks.map(t => t.emailId).filter(Boolean);
    if (emailIds.length > 0) await dbService.saveProcessedEmailIds(userId, emailIds);

    await dbService.deletePendingConfirmation(userId);
    return reply(lineService.buildResultMessage(registeredTasks));
  }

  // 「キャンセル」
  if (text === 'キャンセル') {
    await dbService.deletePendingConfirmation(userId);
    return reply({ type: 'text', text: 'キャンセルしました。' });
  }

  // 「選んで登録」
  if (text === '選んで登録') {
    const pending = await dbService.getPendingConfirmation(userId);
    if (!pending) {
      return reply({ type: 'text', text: '登録待ちのタスクがありません。' });
    }
    // 全タスクの selected を false に初期化
    const initializedTasks = pending.tasks.map(t => ({ ...t, selected: false }));
    await dbService.savePendingConfirmation(pending.id, userId, initializedTasks);
    return reply(lineService.buildSelectMessage(initializedTasks));
  }

  // 「決定」（選んで登録モードで選択済みタスクを登録）
  if (text === '決定') {
    if (!tokens) {
      return reply(buildAuthRequiredMessage(userId));
    }
    const pending = await dbService.getPendingConfirmation(userId);
    if (!pending) {
      return reply({ type: 'text', text: '登録待ちのタスクがありません。' });
    }

    const selectedTasks = pending.tasks.filter(t => t.selected === true);
    if (selectedTasks.length === 0) {
      return reply({ type: 'text', text: 'タスクが選択されていません。番号をタップして選んでください。' });
    }

    const registeredTasks = [];
    for (const task of selectedTasks) {
      try {
        const registered = await taskService.registerTask(task, tokens, userId);
        registeredTasks.push(registered);
      } catch (err) {
        console.error('registerTask error:', err.message);
      }
    }

    // 選択されたタスクのemailIdのみ処理済みに記録
    const emailIds = selectedTasks.map(t => t.emailId).filter(Boolean);
    if (emailIds.length > 0) await dbService.saveProcessedEmailIds(userId, emailIds);

    await dbService.deletePendingConfirmation(userId);
    return reply(lineService.buildResultMessage(registeredTasks));
  }

  // 「N番」（タスク番号の選択/解除）
  const numberMatch = text.match(/^(\d+)番$/);
  if (numberMatch) {
    const pending = await dbService.getPendingConfirmation(userId);
    if (!pending) {
      return reply({ type: 'text', text: '登録待ちのタスクがありません。' });
    }

    const index = parseInt(numberMatch[1], 10) - 1;
    if (index < 0 || index >= pending.tasks.length) {
      return reply({ type: 'text', text: `${numberMatch[1]}番のタスクは存在しません。` });
    }

    // selected フラグをトグル
    const updatedTasks = pending.tasks.map((t, i) => {
      if (i === index) {
        return { ...t, selected: !t.selected };
      }
      return t;
    });

    await dbService.savePendingConfirmation(pending.id, userId, updatedTasks);
    return reply(lineService.buildSelectMessage(updatedTasks));
  }

  // --- Claude でタスク解析 ---
  const result = await claudeService.extractTasks(text, today);

  // コマンド: list
  if (result.command === 'list') {
    const tasks = await dbService.getAllTasks(userId);
    return reply(lineService.formatTaskList(tasks));
  }

  // コマンド: complete
  if (result.command === 'complete') {
    if (result.tasks && result.tasks.length > 0) {
      const titleToFind = result.tasks[0].title;
      const found = await dbService.findTaskByTitle(titleToFind, userId);

      if (!found) {
        return reply({ type: 'text', text: `「${titleToFind}」に一致するタスクが見つかりませんでした。` });
      }

      // Google Tasks を完了にする
      if (found.google_task_id && tokens) {
        try {
          await taskService.completeGoogleTask(found.google_task_id, tokens);
        } catch (e) {
          console.error('Google Tasks complete error:', e.message);
        }
      }

      // Google Calendar に完了マークを付ける
      if (found.google_event_id && tokens) {
        try {
          await calendarService.markEventDone(found.google_event_id, tokens);
        } catch (e) {
          console.error('Calendar mark done error:', e.message);
        }
      }

      await dbService.updateTaskStatus(found.id, 'completed');
      return reply({ type: 'text', text: `✅「${found.title}」を完了しました！` });
    }
    return reply({ type: 'text', text: 'タスク名を指定してください。例：「企画書提出 完了」' });
  }

  // コマンド: delete
  if (result.command === 'delete') {
    if (result.tasks && result.tasks.length > 0) {
      const titleToFind = result.tasks[0].title;
      const found = await dbService.findTaskByTitle(titleToFind, userId);

      if (!found) {
        return reply({ type: 'text', text: `「${titleToFind}」に一致するタスクが見つかりませんでした。` });
      }

      // Google Tasks から削除
      if (found.google_task_id && tokens) {
        try {
          await taskService.deleteGoogleTask(found.google_task_id, tokens);
        } catch (e) {
          console.error('Google Tasks delete error:', e.message);
        }
      }

      // Google Calendar から削除
      if (found.google_event_id && tokens) {
        try {
          await calendarService.deleteEvent(found.google_event_id, tokens);
        } catch (e) {
          console.error('Calendar delete event error:', e.message);
        }
      }

      await dbService.deleteTask(found.id);
      return reply({ type: 'text', text: `🗑️「${found.title}」を削除しました。` });
    }
    return reply({ type: 'text', text: 'タスク名を指定してください。例：「企画書提出 削除」' });
  }

  // タスクが抽出された場合 → 確認メッセージを送る
  if (result.tasks && result.tasks.length > 0) {
    if (!tokens) {
      return reply(buildAuthRequiredMessage(userId));
    }

    const confirmId = crypto.randomUUID();
    await dbService.savePendingConfirmation(confirmId, userId, result.tasks);
    return reply(lineService.buildConfirmMessage(result.tasks));
  }

  // タスクが見つからなかった場合
  return reply({
    type: 'text',
    text: 'タスクが見つかりませんでした。「明日14時に歯医者」のように送ってみてください。'
  });
}

/**
 * Google認証が必要な場合のメッセージ
 */
function buildAuthRequiredMessage(userId) {
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  const loginUrl = userId
    ? `${baseUrl}/auth/google?lineUserId=${encodeURIComponent(userId)}`
    : `${baseUrl}/auth/google`;
  return {
    type: 'text',
    text: `Googleアカウントの認証が必要です。\n以下のURLをブラウザで開いてログインしてください:\n${loginUrl}`
  };
}

module.exports = router;
