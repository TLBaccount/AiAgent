export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(200).json({ ok: true });
    }

    const update = req.body;

    // ===== 🆕 GESTION DES BOUTONS (callback_query) =====
    if (update.callback_query) {
        const cq = update.callback_query;
        const chatId = cq.message.chat.id;
        const messageId = cq.message.message_id;
        const token = process.env.TELEGRAM_BOT_TOKEN;
        const siteUrl = "https://ai-agent-tlb-agent.vercel.app";
        const data = cq.data || "";

        // 1. Stoppe le "chargement" du bouton
        await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ callback_query_id: cq.id })
        }).catch(() => {});

        // 2. Retire les boutons du message original (anti double-clic)
        await fetch(`https://api.telegram.org/bot${token}/editMessageReplyMarkup`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } })
        }).catch(() => {});

        // 3. Traduit le clic en message que chat.js comprend déjà
        const actionText = data === "wf_confirm" ? "oui" : data === "wf_cancel" ? "annule" : null;
        if (!actionText) return res.status(200).json({ ok: true });

        try {
            const chatResponse = await fetch(`${siteUrl}/api/chat`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-scoop-code": process.env.SCOOP_WEB_CODE || "" },
                body: JSON.stringify({ message: actionText, channel: "telegram" })
            });
            let replyText = "❌ Erreur interne.";
            if (chatResponse.ok) {
                const d = await chatResponse.json();
                replyText = d.reply || replyText;
            }
            await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ chat_id: chatId, text: replyText, parse_mode: "Markdown" })
            });
        } catch (e) {
            console.error("Erreur callback:", e.message);
        }
        return res.status(200).json({ ok: true });
    }

    const message = update.message;
    if (!message) return res.status(200).json({ ok: true });

    const chatId = message.chat.id;
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const groqKey = process.env.GROQ_API_KEY;
    const siteUrl = "https://ai-agent-tlb-agent.vercel.app";

    let userText = null;
    let detectedLang = null;
    let isVoice = false;

    try {
        if (message.text) {
            userText = message.text;
        } else if (message.voice) {
            isVoice = true;
            const fileId = message.voice.file_id;
            const fileInfoRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`);
            const fileInfo = await fileInfoRes.json();
            const filePath = fileInfo.result.file_path;

            const audioRes = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
            const audioBuffer = await audioRes.arrayBuffer();

            const formData = new FormData();
            formData.append('file', new Blob([audioBuffer], { type: 'audio/ogg' }), 'voice.ogg');
            formData.append('model', 'whisper-large-v3-turbo');
            formData.append('response_format', 'verbose_json');

            const whisperRes = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
                method: "POST",
                headers: { "Authorization": `Bearer ${groqKey}` },
                body: formData
            });

            if (!whisperRes.ok) throw new Error(`Erreur Whisper: ${whisperRes.status}`);

            const whisperData = await whisperRes.json();
            userText = whisperData.text;
            detectedLang = whisperData.language || null;

            if (detectedLang) {
                const l = detectedLang.toLowerCase();
                if (l.startsWith('fr') || l === 'french') detectedLang = 'fr';
                else if (l.startsWith('en') || l === 'english') detectedLang = 'en';
                else if (l.startsWith('ar') || l === 'arabic') detectedLang = 'ar';
                else detectedLang = null;
            }

            await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    chat_id: chatId,
                    text: `🎤 J'ai entendu (${detectedLang || 'inconnu'}) : "${userText}"`
                })
            });
        } else {
            return res.status(200).json({ ok: true });
        }

        if (!userText || userText.trim() === "") return res.status(200).json({ ok: true });

        // Appel à api/chat.js (chat.js charge l'historique ET sauvegarde lui-même)
        const chatResponse = await fetch(`${siteUrl}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-scoop-code": process.env.SCOOP_WEB_CODE || "" },
            body: JSON.stringify({
                message: userText,
                forcedLang: detectedLang,
                channel: "telegram"
            })
        });

        if (!chatResponse.ok) throw new Error(`Erreur API Chat: ${chatResponse.status}`);

        const data = await chatResponse.json();
        const botReply = data.reply;
        const replyLang = data.lang || detectedLang || "fr";

        // ===== 🆕 BOUTONS si résumé de confirmation détecté =====
        const needsButtons = /oui ou non|yes or no|نعم أو لا/.test(botReply);

        const payload = { chat_id: chatId, text: botReply, parse_mode: "Markdown" };
        if (needsButtons) {
            payload.reply_markup = {
                inline_keyboard: [[
                    { text: "✅ Confirmer", callback_data: "wf_confirm" },
                    { text: "❌ Annuler", callback_data: "wf_cancel" }
                ]]
            };
        }

        // Envoi de la réponse texte (avec Markdown + boutons éventuels)
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        // Envoi de la voix UNIQUEMENT si le message était vocal
        if (isVoice) {
            const ttsUrl = `${siteUrl}/api/tts?text=${encodeURIComponent(botReply)}&lang=${replyLang}`;
            const audioResponse = await fetch(ttsUrl);

            if (audioResponse.ok) {
                const audioBuffer = await audioResponse.arrayBuffer();
                const audioFormData = new FormData();
                audioFormData.append('chat_id', chatId);
                audioFormData.append('voice', new Blob([audioBuffer], { type: 'audio/mpeg' }), 'scoop_reply.ogg');
                await fetch(`https://api.telegram.org/bot${token}/sendVoice`, { method: 'POST', body: audioFormData });
            }
        }

        return res.status(200).json({ ok: true });

    } catch (error) {
        console.error("Erreur Telegram:", error);
        try {
            await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ chat_id: chatId, text: `❌ Erreur : ${error.message}` })
            });
        } catch (e) { console.error("Impossible d'envoyer l'erreur:", e); }
        return res.status(200).json({ ok: true });
    }
}
