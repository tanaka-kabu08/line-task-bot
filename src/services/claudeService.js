const Groq = require('groq-sdk');

function getClient() {
  return new Groq({ apiKey: process.env.GROQ_API_KEY });
}

async function extractTasks(text, today) {
  const systemPrompt = `あなたはメールからタスク・予定を抽出するアシスタントです。

このメールはユーザーが「対応が必要」と判断してスターを付けたものです。
必ず何らかのタスクや予定を1件以上抽出してください。

抽出のルール：
- バス・飛行機・電車の予約 → タイトル例：「仙台→新宿 高速バス」、日付は出発日
- ホテル・宿泊の予約 → タイトル例：「THE UBUFURU ISHIGAKI チェックイン」、日付はチェックイン日
- 荷物の受け取り → タイトル例：「ヤマト便 受け取り」、日付は配達日
- 支払い・手続き → タイトル例：「〇〇の支払い期限」、日付は締め切り日
- その他 → 件名から具体的なタイトルをつける

日付は「〇月〇日」と書かれている通りに使う（ずらさない）。
タイトルは「予約確認」「お知らせ」などの汎用名は避け、具体的な内容にする。

{
  "tasks": [
    {
      "title": "タスクのタイトル（簡潔に）",
      "dueDate": "YYYY-MM-DD（不明ならnull）",
      "dueTime": "HH:MM（不明ならnull）",
      "priority": "high または medium または low",
      "category": "仕事 または 買い物 または 家事 または 学校 または 健康 または その他",
      "notes": "補足情報（あれば、なければnull）",
      "source": "メール件名やメッセージの要約（20文字以内）"
    }
  ],
  "command": null
}

優先度の判定基準:
- high: 「急ぎ」「至急」「ASAP」、期限が今日から2日以内
- medium: 期限が1週間以内、通常の依頼
- low: 期限が遠い、「いつか」「余裕があれば」

また、以下のコマンドを検出した場合はcommandフィールドに設定:
- 「タスク一覧」「未完了」「やること」→ { "tasks": [], "command": "list" }
- 「○○完了」「○○終わった」→ { "tasks": [{"title": "○○"}], "command": "complete" }
- 「○○削除」「○○取り消し」→ { "tasks": [{"title": "○○"}], "command": "delete" }

今日の日付: ${today}`;

  try {
    const response = await getClient().chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 1024,
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: text }]
    });
    const responseText = response.choices[0].message.content;
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { tasks: [], command: null };
    const parsed = JSON.parse(jsonMatch[0]);
    return { tasks: parsed.tasks || [], command: parsed.command || null };
  } catch (error) {
    console.error('Groq API error:', error.message);
    return { tasks: [], command: null };
  }
}

module.exports = { extractTasks };
