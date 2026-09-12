export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(200).json({ ok: true });
    }

    const { message } = req.body;
    if (!message) return res.status(200).json({ ok: true });

    const chatId = message.chat.id;
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const groqKey = process.env.GROQ_API_KEY;
    const siteUrl = "https://ai-agent-tlb-agent.vercel.app";
    const supabaseUrl = "https://pfmgkdpvqqvlznogfuzi.supabase.co";
    const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBmbWdrZHB2cXF2bHpub2dmdXppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4ODE2ODIsImV4cCI6MjEwNDQ1NzY4Mn0.KAgI6CBPW9URVG0cf9qn2t2GHsgmZNCwymkuLVgojlE";

    let userText = null;
    let detectedLang = null;
    let isVoice = false; // <-- NOUVEAU

    try {
        if (message.text) {
            userText = message.text;
        } else if (message.voice) {
            isVoice = true; // <-- NOUVEAU
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

        // Récupération de l'historique complet
        const historyRes = await fetch(`${supabaseUrl}/rest/v1/messages?select=*&order=id.asc&limit=100`, {
            headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` }
        });
        const historyData = await historyRes.json();
        const history = Array.isArray(historyData) 
            ? historyData.map(msg => ({ role: msg.role, content: msg.content }))
            : [];

        // Appel à api/chat.js
        const chatResponse = await fetch(`${siteUrl}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
                message: userText, 
                history: history,
                forcedLang: detectedLang
            })
        });

        if (!chatResponse.ok) throw new Error(`Erreur API Chat: ${chatResponse.status}`);

        const data = await chatResponse.json();
        const botReply = data.reply;
        const replyLang = data.lang || detectedLang || "fr";

        // Sauvegarde dans Supabase
        await fetch(`${supabaseUrl}/rest/v1/messages`, {
            method: "POST",
            headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}`, "Content-Type": "application/json", "Prefer": "return=minimal" },
            body: JSON.stringify({ role: "user", content: userText })
        });
        await fetch(`${supabaseUrl}/rest/v1/messages`, {
            method: "POST",
            headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}`, "Content-Type": "application/json", "Prefer": "return=minimal" },
            body: JSON.stringify({ role: "assistant", content: botReply })
        });

        // Envoi de la réponse texte
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, text: botReply })
        });

        // Envoi de la voix UNIQUEMENT si le message était vocal
        if (isVoice) { // <-- CONDITION
            const ttsUrl = `${siteUrl}/api/tts?text=${encodeURIComponent(botReply)}&lang=${replyLang}`;
            const audioResponse = await fetch(ttsUrl);
            
            if (audioResponse.ok) {
                const audioBuffer = await audioResponse.arrayBuffer();
                const audioFormData = new FormData();
                audioFormData.append('chat_id', chatId);
                audioFormData.append('audio', new Blob([audioBuffer], { type: 'audio/mpeg' }), 'scoop_reply.mp3');
                await fetch(`https://api.telegram.org/bot${token}/sendAudio`, {
                    method: 'POST',
                    body: audioFormData
                });
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
