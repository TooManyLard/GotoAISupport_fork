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

        // ストリーミングを使わない場合（シンプルな応答の場合）
        const run = await openai.beta.threads.runs.create(threadId, {
            assistant_id: ASSISTANT_ID
        });

        // 実行完了を待つ
        let runStatus = await openai.beta.threads.runs.retrieve(
            threadId,
            run.id
        );

        // 応答待ち
        while (runStatus.status !== 'completed') {
            await new Promise(resolve => setTimeout(resolve, 1000));
            runStatus = await openai.beta.threads.runs.retrieve(threadId, run.id);
            
            if (['failed', 'cancelled', 'expired'].includes(runStatus.status)) {
                throw new Error(`Run ended with status: ${runStatus.status}`);
            }
        }

        // 完了した応答を取得
        let finalResponse = await openai.beta.threads.messages.list(run.thread_id);
        let responseText = finalResponse.data[0].content[0].text.value;
        
        // 【 または 〖 で始まる参照やメタデータを削除
        let index = responseText.indexOf('【');
        if (index !== -1) {
            responseText = responseText.substring(0, index) + '.';
        }
        
        // 〖...〗 で囲まれた部分を除去
        responseText = responseText.replace(/〖.*?〗/g, '');

        // 最終的なアシスタントの返信とセッションID（スレッドID）を返す
        return {
            statusCode: 200,
            body: JSON.stringify({
                response: responseText,
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
