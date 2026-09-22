export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(200).json({ ok: true });
    }

    const update = req.body;

    // ===== GESTION DES BOUTONS (callback_query) =====
    if (update.callback_query) {
        const cq = update.callback_query;
        const chatId = cq.message.chat.id;
        const messageId = cq.message.message_id;
        const token = process.env.TELEGRAM_BOT_TOKEN;
        const siteUrl = "https://ai-agent-tlb-agent.vercel.app";
        const data = cq.data || "";

        await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ callback_query_id: cq.id })
        }).catch(() => {});

        await fetch(`https://api.telegram.org/bot${token}/editMessageReplyMarkup`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } })
        }).catch(() => {});

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
        } catch (e) { console.error("Erreur callback:", e.message); }
        return res.status(200).json({ ok: true });
    }

    const message = update.message;
    if (!message) return res.status(200).json({ ok: true });

    const chatId = message.chat.id;
    console.log("TELEGRAM_CHAT_ID:", chatId);
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const groqKey = process.env.GROQ_API_KEY;
    const siteUrl = "https://ai-agent-tlb-agent.vercel.app";
    const supabaseUrl = "https://pfmgkdpvqqvlznogfuzi.supabase.co";
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
    // ===== PHOTOS 📸 : Scoop regarde et répond =====
    if (message.photo && message.photo.length > 0) {
        const best = message.photo[message.photo.length - 1];
        let reply = "❌ Je n'ai pas pu analyser la photo.";
        try {
            const vRes = await fetch(`${siteUrl}/api/vision`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-scoop-code": process.env.SCOOP_WEB_CODE || "" },
                body: JSON.stringify({ fileId: best.file_id, caption: message.caption || "", channel: "telegram" })
            });
            if (vRes.ok) {
                const vData = await vRes.json();
                if (vData.reply) reply = vData.reply;
            }
        } catch (e) { console.error("Erreur vision:", e.message); }
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, text: reply })
        });
        return res.status(200).json({ ok: true });
    }

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
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    chat_id: chatId,
                    text: `🎤 J'ai entendu (${detectedLang || 'inconnu'}) : "${userText}"`
                })
            });
        } else if (message.location) {
            // ===== 🆕 POSITION : enregistrement et confirmation =====
            const lat = message.location.latitude;
            const lon = message.location.longitude;
            try {
                await fetch(`${supabaseUrl}/rest/v1/secrets?user_id=eq.fatah&key=eq.position_actuelle`, {
                    method: "DELETE", headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` }
                });
                await fetch(`${supabaseUrl}/rest/v1/secrets`, {
                    method: "POST",
                    headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}`, "Content-Type": "application/json", "Prefer": "return=minimal" },
                    body: JSON.stringify({ user_id: "fatah", key: "position_actuelle", value: `${lat},${lon}`, is_secret: true })
                });
                await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        chat_id: chatId,
                        text: `📍 Position enregistrée !\n\nDemande-moi maintenant : « temps ici ? », « je peux courir ? », « vagues près de moi ? » 😊`
                    })
                });
            } catch (e) { console.error("Erreur position:", e.message); }
            return res.status(200).json({ ok: true });
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

        // Envoi de la réponse texte + boutons si résumé de confirmation
        const sendPayload = { chat_id: chatId, text: botReply, parse_mode: "Markdown" };
        if (botReply.includes("Répondez oui ou non") || botReply.includes("Reply yes or no")) {
            sendPayload.reply_markup = { inline_keyboard: [[
                { text: "✅ Confirmer", callback_data: "wf_confirm" },
                { text: "❌ Annuler", callback_data: "wf_cancel" }
            ]] };
        }
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(sendPayload)
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
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ chat_id: chatId, text: `❌ Erreur : ${error.message}` })
            });
        } catch (e) { console.error("Impossible d'envoyer l'erreur:", e); }
        return res.status(200).json({ ok: true });
    }
}
