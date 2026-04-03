function formatDateJP(dateStr) {
  if (!dateStr) return '期限なし';
  const days = ['日','月','火','水','木','金','土'];
  const d = new Date(dateStr + 'T00:00:00+09:00');
  return `${d.getMonth()+1}/${d.getDate()}(${days[d.getDay()]})`;
}

function priorityIcon(p) { return { high:'🔴', medium:'🟡', low:'🟢' }[p] || '🟡'; }
function priorityLabel(p) { return { high:'高', medium:'中', low:'低' }[p] || '中'; }

function buildConfirmMessage(tasks) {
  const tasksText = tasks.map((t,i) => `${i+1}. 📌 ${t.title}（${t.dueDate ? formatDateJP(t.dueDate) : '期限なし'}・${priorityIcon(t.priority)}${priorityLabel(t.priority)}）`).join('\n');
  return {
    type: 'text',
    text: `以下のタスクを登録してよいですか？\n\n${tasksText}\n`,
    quickReply: { items: [
      { type:'action', action:{ type:'message', label:'✅ 全て登録', text:'全て登録' } },
      { type:'action', action:{ type:'message', label:'❌ キャンセル', text:'キャンセル' } },
      { type:'action', action:{ type:'message', label:'✏️ 選んで登録', text:'選んで登録' } }
    ]}
  };
}

function buildSelectMessage(tasks) {
  const items = tasks.map((t,i) => ({ type:'action', action:{ type:'message', label:`${i+1}番: ${t.title.length>10?t.title.substring(0,10)+'…':t.title}`, text:`${i+1}番` } }));
  const maxItems = Math.min(items.length, 12);
  items.splice(maxItems);
  items.push({ type:'action', action:{ type:'message', label:'✅ 決定', text:'決定' } });
  return { type:'text', text:'番号をタップして選択し、✅ 決定を押してください\n（タップするたびに選択/解除が切り替わります）', quickReply: { items } };
}

function buildResultMessage(registeredTasks) {
  const taskLines = registeredTasks.map((t,i) => {
    const dateStr = t.dueDate ? formatDateJP(t.dueDate) : '期限なし';
    const calendarNote = t.googleEventId ? ' → カレンダーにも追加' : '';
    return `${i+1}. ${t.title}（${dateStr}）${calendarNote}`;
  }).join('\n');
  return { type:'text', text:`✅ 以下のタスクを登録しました！\n\n${taskLines}\n\n「タスク一覧」で確認できます。` };
}

function formatTaskList(tasks) {
  if (!tasks || tasks.length === 0) return { type:'text', text:'タスクはありません。\nLINEで「買い物: 牛乳、卵」のように送ってみてください！' };
  const taskLines = tasks.map(t => `${priorityIcon(t.priority)} ${t.title} - ${t.due_date ? formatDateJP(t.due_date) : '期限なし'}`).join('\n');
  return { type:'text', text:`📋 タスク一覧\n\n${taskLines}\n\n「○○完了」で完了、「○○削除」で削除できます。` };
}

module.exports = { buildConfirmMessage, buildSelectMessage, buildResultMessage, formatTaskList };
