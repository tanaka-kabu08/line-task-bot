const Groq = require('groq-sdk');

function getClient() {
  return new Groq({ apiKey: process.env.GROQ_API_KEY });
}

async function extractTasks(text, today) {
  const systemPrompt = `あなたはテキストからタスク情報を抽出するアシスタントです。

与えられたテキストからタスクを抽出し、以下のJSON形式のみで返してください。
タスクが複数ある場合は配列に含めてください。
タスクが見つからない場合は空配列を返してください。

【抽出しないもの】：
- セール・キャンペーン・ポイント還元・クーポンなどの販促メール
- メルマガ・ニュースレター
- 「パスワード変更を推奨します」「不審メールに注意」など、注意喚起・推奨系のセキュリティメール
- 「〇〇をご利用ください」「設定をお勧めします」など、サービス側からの一般的なお知らせ
- システム通知・エラー通知

【抽出するもの】：
- 交通・宿泊の予約確認（バス・飛行機・ホテルなど、日時が書かれているもの）
- 荷物の配達・受け取り（日付が指定されているもの）
- 相手から求められている締め切り付きの作業（書類提出、返送、支払いなど）
- 会議・打ち合わせの日程（日時が明確なもの）
- 解約・更新などの手続き期限（具体的な日付があるもの）

【タイトルの付け方】：
- バス・電車・飛行機：「出発地→到着地 交通手段」例：「仙台→新宿 高速バス」
- ホテル・宿泊：「施設名 チェックイン」例：「安心お宿新宿 チェックイン」
- 荷物：「荷物受け取り」＋配達業者名があれば追記
- その他：具体的な内容がわかるタイトルにする（「予約確認」「お知らせ」などの汎用タイトルは避ける）

【日付の抽出ルール】：
- メールに明記されている日付をそのまま使う
- バス・飛行機は出発日、ホテルはチェックイン日、荷物は配達日を使う
- 「〇月〇日」と書かれていたら必ずその日付を使う（前後にずらさない）

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
