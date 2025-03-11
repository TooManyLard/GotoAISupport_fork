const { OpenAI } = require('openai');

// OpenAI クライアントの初期化
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// Netlify 等の環境変数からアシスタントIDを取得
const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID;

exports.handler = async function (event, context) {
    // POSTリクエスト以外は拒否
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method Not Allowed' })
        };
    }

    try {
        const { message, sessionId, language } = JSON.parse(event.body);
        if (!message) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Message is required' })
            };
        }

        let threadId = sessionId;
        let thread;

        // 新規スレッド作成または既存スレッドの取得
        if (!threadId) {
            thread = await openai.beta.threads.create();
            threadId = thread.id;
            console.log(`New thread created: ${threadId}`);
        } else {
            try {
                thread = await openai.beta.threads.retrieve(threadId);
                console.log(`Using existing thread: ${threadId}`);
            } catch (error) {
                console.log(`Thread ${threadId} not found, creating a new one`);
                thread = await openai.beta.threads.create();
                threadId = thread.id;
            }
        }

        // 言語情報を含めたメッセージコンテンツの作成
        const userMessageContent = `[LANGUAGE: ${language || 'ja'}] ${message}`;

        // ユーザーのメッセージをスレッドに追加
        await openai.beta.threads.messages.create(threadId, {
            role: 'user',
            content: userMessageContent
        });

        // アシスタントの返信をストリーミングで取得
        const stream = await openai.beta.threads.runs.create(threadId, {
            assistant_id: ASSISTANT_ID,
            stream: true
        });

        // 返信のテキストを蓄積する変数
        let assistantReply = "";
        
        // Streamlitバージョンを参考にしたより具体的な正規表現パターン
        // 【数字:数字†source】 のような形式に対応
        // 非貪欲マッチング（*?）を使用して最小限の一致を確保
        const regexPattern = /【.*?】|〖.*?〗/g;

        // ストリームから順次イベントを受け取る
        for await (const event of stream) {
            if (event && event.data && event.data.delta && Array.isArray(event.data.delta.content)) {
                for (const block of event.data.delta.content) {
                    if (block.type === 'text' && block.text && block.text.value) {
                        // テキストチャンクから不要な部分を除去
                        // undefinedを防ぐため、置換前に文字列が存在することを確認
                        const textValue = block.text.value || "";
                        const cleanedChunk = textValue.replace(regexPattern, '');
                        assistantReply += cleanedChunk;
                    }
                }
            }
        }

        // 最終的なアシスタントの返信全体に対しても正規表現を適用
        // 複数チャンクにまたがったタグに対応するため
        const finalCleanedReply = assistantReply.replace(regexPattern, '');

        // 最終的なアシスタントの返信とセッションID（スレッドID）を返す
        return {
            statusCode: 200,
            body: JSON.stringify({
                response: finalCleanedReply,
                sessionId: threadId
            })
        };

    } catch (error) {
        console.error('Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Internal Server Error' })
        };
    }
};
