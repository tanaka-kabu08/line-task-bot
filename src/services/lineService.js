/**
 * 日付を M/D(曜) 形式にフォーマット
 */
function stripDomains(str) {
  if (!str) return str;
  return str
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\b[\w.-]+\.(co\.jp|com|jp|net|org|io|app)\b\S*/g, '')
    .replace(/\s{2,}/g, ' ').trim();
}

function formatDateJP(dateStr) {
  if (!dateStr) return '期限なし';
  const days = ['日', '月', '火', '水', '木', '金', '土'];
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  const dow = days[d.getDay()];
  return `${month}/${day}(${dow})`;
}

/**
 * 優先度アイコンを返す
 */
function priorityIcon(priority) {
  const icons = { high: '🔴', medium: '🟡', low: '🟢' };
  return icons[priority] || '🟡';
}

/**
 * 優先度ラベルを返す
 */
function priorityLabel(priority) {
  const labels = { high: '高', medium: '中', low: '低' };
  return labels[priority] || '中';
}

/**
 * タスク確認用のQuick Replyメッセージを作成
 */
function buildConfirmMessage(tasks) {
  const tasksText = tasks.map((t, i) => {
    const dateStr = t.dueDate ? formatDateJP(t.dueDate) : '期限なし';
    return `${i + 1}. ✅ ${stripDomains(t.title)}（${dateStr}）`;
  }).join('\n');

  return {
    type: 'text',
    text: `以下のタスクを登録してよいですか？\n\n${tasksText}\n`,
    quickReply: {
      items: [
        {
          type: 'action',
          action: { type: 'message', label: '✅ 全て登録', text: '全て登録' }
        },
        {
          type: 'action',
          action: { type: 'message', label: '❌ キャンセル', text: 'キャンセル' }
        },
        {
          type: 'action',
          action: { type: 'message', label: '✏️ 選んで登録', text: '選んで登録' }
        }
      ]
    }
  };
}

/**
 * 選んで登録用のQuick Replyメッセージを作成（選択状態を反映）
 */
function buildSelectMessage(tasks, page = 0) {
  const PAGE_SIZE = 10;
  const usePagination = tasks.length > 12;

  let displayTasks, hasPrev, hasNext;

  if (!usePagination) {
    displayTasks = tasks.map((t, i) => ({ ...t, globalIndex: i }));
    hasPrev = false;
    hasNext = false;
  } else {
    const start = page * PAGE_SIZE;
    const end = start + PAGE_SIZE;
    displayTasks = tasks.slice(start, end).map((t, i) => ({ ...t, globalIndex: start + i }));
    hasPrev = page > 0;
    hasNext = end < tasks.length;
  }

  const items = [];
  if (hasPrev) {
    items.push({
      type: 'action',
      action: { type: 'message', label: '← 前の10件', text: '前へ' }
    });
  }
  displayTasks.forEach(t => {
    const i = t.globalIndex;
    items.push({
      type: 'action',
      action: {
        type: 'message',
        label: `${i + 1}番 ${t.title.length > 9 ? t.title.substring(0, 9) + '…' : t.title}`,
        text: `${i + 1}番`
      }
    });
  });
  if (hasNext) {
    items.push({
      type: 'action',
      action: { type: 'message', label: '次の10件 →', text: '次へ' }
    });
  }
  items.push({
    type: 'action',
    action: { type: 'message', label: '決定する', text: '決定' }
  });

  const skipCount = tasks.filter(t => !t.selected).length;
  const taskList = tasks.map((t, i) =>
    `${t.selected ? '✅' : '⏭️'} ${i + 1}. ${stripDomains(t.title)}`
  ).join('\n');
  const pageInfo = usePagination
    ? `\n\nページ ${page + 1}/${Math.ceil(tasks.length / PAGE_SIZE)}（全${tasks.length}件）`
    : '';

  return {
    type: 'text',
    text: `番号をタップで✅登録/⏭️スキップを切り替えられます（もう一度タップで戻せます）:\n\n${taskList}${pageInfo}\n\nスキップ: ${skipCount}件 → 終わったら「決定する」を押してください。`,
    quickReply: { items }
  };
}

/**
 * 選んで登録の最終確認メッセージ（登録/スキップの内訳を表示）
 */
function buildConfirmSelectMessage(tasks) {
  const selected = tasks.filter(t => t.selected === true);
  const skipped = tasks.filter(t => t.selected !== true);
  const lines = [
    `✅ 登録: ${selected.length}件 / ⏭️ スキップ: ${skipped.length}件\n`,
    ...selected.map(t => `✅ ${stripDomains(t.title)}`),
    ...skipped.map(t => `⏭️ ${stripDomains(t.title)}`)
  ].join('\n');

  return {
    type: 'text',
    text: `${lines}\n\nよろしいですか？`,
    quickReply: {
      items: [
        { type: 'action', action: { type: 'message', label: '登録確定', text: '登録確定' } },
        { type: 'action', action: { type: 'message', label: 'やり直す', text: 'やり直す' } }
      ]
    }
  };
}

/**
 * 登録完了メッセージを作成
 */
function buildResultMessage(registeredTasks) {
  const taskLines = registeredTasks.map((t, i) => {
    const dateStr = t.dueDate ? formatDateJP(t.dueDate) : '期限なし';
    const calendarNote = t.googleEventId ? ' → カレンダーにも追加' : '';
    return `${i + 1}. ${t.title}（${dateStr}）${calendarNote}`;
  }).join('\n');

  return {
    type: 'text',
    text: `✅ 以下のタスクを登録しました！\n\n${taskLines}\n\n「タスク一覧」で確認できます。`
  };
}

/**
 * タスク一覧メッセージを作成（日付あり/なしでセクション分け）
 */
function formatTaskList(tasks) {
  if (!tasks || tasks.length === 0) {
    return {
      type: 'text',
      text: 'タスクはありません。\nLINEで「買い物: 牛乳、卵」のように送ってみてください！'
    };
  }

  const withDate = tasks.filter(t => t.due_date);
  const withoutDate = tasks.filter(t => !t.due_date);

  let text = '📋 タスク一覧\n';

  if (withDate.length > 0) {
    text += '\n📅 予定・期限あり\n';
    text += withDate.map(t => {
      const icon = priorityIcon(t.priority);
      const dateStr = formatDateJP(t.due_date);
      const timeStr = t.due_time ? ` ${t.due_time}` : '';
      return `${icon} ${t.title} - ${dateStr}${timeStr}`;
    }).join('\n');
  }

  if (withoutDate.length > 0) {
    text += '\n\n🛒 いつでもやること\n';
    text += withoutDate.map(t => {
      const icon = priorityIcon(t.priority);
      return `${icon} ${t.title}`;
    }).join('\n');
  }

  text += '\n\n「○○完了」で完了、「○○削除」で削除できます。';

  return { type: 'text', text };
}

module.exports = {
  buildConfirmMessage,
  buildSelectMessage,
  buildConfirmSelectMessage,
  buildResultMessage,
  formatTaskList
};
