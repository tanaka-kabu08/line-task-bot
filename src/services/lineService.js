/**
 * 日付を M/D(曜) 形式にフォーマット
 */
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
    return `${i + 1}. 📌 ${t.title}（${dateStr}）`;
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
function buildSelectMessage(tasks) {
  const items = tasks.map((t, i) => ({
    type: 'action',
    action: {
      type: 'message',
      label: `${t.selected ? '✅' : '☐'} ${i + 1}.${t.title.length > 7 ? t.title.substring(0, 7) + '…' : t.title}`,
      text: `${i + 1}番`
    }
  }));

  const maxItems = Math.min(items.length, 12);
  items.splice(maxItems);
  items.push({
    type: 'action',
    action: { type: 'message', label: '✅ 決定', text: '決定' }
  });

  const taskList = tasks.map((t, i) =>
    `${t.selected ? '✅' : '☐'} ${i + 1}. ${t.title}`
  ).join('\n');

  return {
    type: 'text',
    text: `登録するタスクを選んでください:\n\n${taskList}\n\n選び終わったら「決定」を押してください。`,
    quickReply: { items }
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
 * タスク一覧メッセージを作成
 */
function formatTaskList(tasks) {
  if (!tasks || tasks.length === 0) {
    return {
      type: 'text',
      text: 'タスクはありません。\nLINEで「買い物: 牛乳、卵」のように送ってみてください！'
    };
  }

  const taskLines = tasks.map(t => {
    const icon = priorityIcon(t.priority);
    const dateStr = t.due_date ? formatDateJP(t.due_date) : '期限なし';
    return `${icon} ${t.title} - ${dateStr}`;
  }).join('\n');

  return {
    type: 'text',
    text: `📋 タスク一覧\n\n${taskLines}\n\n「○○完了」で完了、「○○削除」で削除できます。`
  };
}

module.exports = {
  buildConfirmMessage,
  buildSelectMessage,
  buildResultMessage,
  formatTaskList
};
