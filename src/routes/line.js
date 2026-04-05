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
    // 全件を「登録」確定で初期化
    const allSelected = pending.tasks.map(t => ({ ...t, selected: true }));
    await dbService.savePendingConfirmation(pending.id, userId, allSelected);
    return reply(lineService.buildSelectMessage(allSelected));
  }

  // 「決定」→ スキップがあれば確認画面、なければe��登録
  if (text === '決定') {
    if (!tokens) {
      return reply(buildAuthRequiredMessage(userId));
    }
    const pending = await dbService.getPendingConfirmation(userId);
    if (!pending) {
      return reply({ type: 'text', text: '登録待ちのタスクがありません。' });
    }

    const selectedTasks = pending.tasks.filter(t => t.selected === true);
    const skippedTasks = pending.tasks.filter(t => t.selected !== true);

    if (selectedTasks.length === 0) {
      await dbService.deletePendingConfirmation(userId);
      const emailIds = pending.tasks.map(t => t.emailId).filter(Boolean);
      if (emailIds.length > 0) await dbService.saveProcessedEmailIds(userId, emailIds);
      return reply({ type: 'text', text: '全てスキップしました。' });
    }

    // スキップがある場合は確認画面を表示
    if (skippedTasks.length > 0) {
      return reply(lineService.buildConfirmSelectMessage(pending.tasks));
    }

    // スキップなし → 即登録
    return reply(await doRegisterSelected(pending, tokens, userId));
  }

  // 「登録確定」（確認画面からの最終確定）
  if (text === '登録確定') {
    if (!tokens) {
      return reply(buildAuthRequiredMessage(userId));
    }
    const pending = await dbService.getPendingConfirmation(userId);
    if (!pending) {
      return reply({ type: 'text', text: '登録待ちのタスクがありません。' });
    }
    return reply(await doRegisterSelected(pending, tokens, userId));
  }

  // 「やり直す」→ 選択画面に戻る
  if (text === 'やり直す') {
    const pending = await dbService.getPendingConfirmation(userId);
    if (!pending) {
      return reply({ type: 'text', text: '登録待ちのタスクがありません。' });
    }
    return reply(lineService.buildSelectMessage(pending.tasks));
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
    return reply({ type: 'text', text: 'タスク名を指定してください。例��k�3���R�n�>C�胦&+�f��4�����(���((������
��
�
�����a��ex�8�g�h-9d"8���9论*�x��x�������8�8ऺ` x�Y�
�\�[�\���	���\�[�\��˛[���
HY�
]��[��H��:*�z*/8�c9o�z)�x�j�h-9d"8�i�࠹论*�x��x�������8�8�k�` x���"9�n�c,��`��j��8��x��8�j��j����"B���8�d��d��i��k�*�z*/:)�y�`���x�������8�8ऺ/�8�fB��]\���\J�Z[]]�\]Z\�YY\��Y�J\�\�Y
JNB���ۜ��ۙ�\�RYHܞ\˜�[��UURQ

N]�Z]��\��X�K��]�T[�[���ۙ�\�X][ۊ�ۙ�\�RY\�\�Y�\�[�\���N�]\���\J[�T�\��X�K��Z[�ۙ�\�SY\��Y�J�\�[�\���JNB����8���x���c:)���i8�b��x�j��b��h��g�h-9d"��]\���\J\N�	�^	��^�	����x���az*��W�
3���3�b;�^��Ӛf������2��7���
#�������������?���W���(�����)�((���(�����*{�&���
��
�
��
K�f�2ˎ_���nӢZ��
���
��
�
K��S�d(���)��幌��չ�ѥ�����I����ѕ�M����ѕ�����������ѽ���̰��͕�%����(������Ё͕���ѕ�Q�ͭ̀���������х̹ͭ���ѕȡЀ���й͕���ѕ�������Ք��(��������Ёɕ���ѕɕ�Q�ͭ̀�mt�(����Ȁ�����Ёхͬ����͕���ѕ�Q�̤ͭ��(��������(����������Ёɕ���ѕɕ���݅�ЁхͭM��٥���ɕ���ѕ�Q�ͬ�хͬ��ѽ���̰��͕�%���(������ɕ���ѕɕ�Q�̹ͭ��͠�ɕ���ѕɕ���(����􁍅э�����Ȥ��(���������ͽ�����ɽȠ�ɕ���ѕ�Q�ͬ���ɽ�蜰���ȹ���ͅ����(�����(���(������Ё�����%�̀���������х̹ͭ����Ѐ���й�����%������ѕȡ	��������(�����������%�̹����Ѡ�������݅�Ё��M��٥���ٕͅAɽ���͕�����%�̡�͕�%��������%�̤�(���݅�Ё��M��٥�������ѕA������
����ɵ�ѥ����͕�%���(��ɕ��ɸ�����M��٥����ե��I��ձ�5��ͅ���ɕ���ѕɕ�Q�̤ͭ�)�((���(����������7���3��������ӖB#������
��
�(���)�չ�ѥ����ե���ѡI��եɕ�5��ͅ����͕�%����(������Ё��͕Uɰ���ɽ���̹��ع	M}UI0���������輽����������������(������Ё�����Uɰ���͕�%�(��������퉅͕Uɱ����Ѡ������������U͕�%���핹����UI%
�������С�͕�%����(����聀�퉅͕Uɱ����Ѡ���������(��ɕ��ɸ��(��������耝ѕ�М�(����ѕ��聁������
��
��
��ώ#����7���3�������g�	q���/��UI3�
K�[���
��
����h�8N8n8:�8+8*N8;>8~8n8�88^8C���G���v��W&�� �Ӱ�Р���GV�R�W��'G2�&�WFW#�
