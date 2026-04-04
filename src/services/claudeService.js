const Groq = require('groq-sdk');

function getClient() {
  return new Groq({ apiKey: process.env.GROQ_API_KEY });
}

async function extractTasks(text, today) {
  const systemPrompt = `あなたはテキストからタスク情報を抽出するアシスタントです。

与えられたテキストからタスクを抽出し、以下のJSON形式のみで返してください。
タスクが複数ある場合は配列に含めてください。
タスクが見つからない場合は空配列を返してください。

【重要】以下のものはタスクとして抽出しないでください：
- 広告・キャンペーン・セール・ポイント還元などの販促メール
- ニュースレター・メルマガ
- 「エントリーすると〇〇」など任意参加のキャンペーン
- 自動通知メール（配送通知・ポイント付与通知など）
- システムエラー通知（deploy failed など）

【タスクとして抽出してよいもの】：
- 予約・アポイント・フライト・ホテルなど日程が決まっているもの
- 「〇〇までに提出」「〇〇を返送してください」など明確な行動依頼
- 支払い・手続きの締め切りがあるもの
- 荷物の受け取りなど自分が能動的に動く必要があるもの

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
