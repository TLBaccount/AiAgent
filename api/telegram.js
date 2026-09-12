export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(200).json({ ok: true });
    }

    const { message } = req.body;

    if (!message) {
        return res.status(200).json({ ok: true });
    }

    const chatId = message.chat.id;
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const groqKey = process.env.GROQ_API_KEY;
    const siteUrl = "https://ai-agent-tlb-agent.vercel.app";

    let userText = null;

    try {
        // --- 1. RÉCUPÉRATION DU TEXTE (Vocal OU Écrit) ---
        
        if (message.text) {
            // Cas simple : message écrit
            userText = message.text;
        } else if (message.voice) {
            // Cas vocal : on télécharge le fichier et on le transcrit avec Whisper (Groq)
            const fileId = message.voice.file_id;
            
            // Étape 1 : Récupérer le chemin du fichier sur les serveurs Telegram
            const fileInfoRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`);
            const fileInfo = await fileInfoRes.json();
            const filePath = fileInfo.result.file_path;
            
            // Étape 2 : Télécharger le fichier audio
            const audioRes = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
            const audioBuffer = await audioRes.arrayBuffer();
            
            // Étape 3 : Envoyer l'audio à Whisper de Groq pour transcription
            const formData = new FormData();
            formData.append('file', new Blob([audioBuffer], { type: 'audio/ogg' }), 'voice.ogg');
            formData.append('model', 'whisper-large-v3-turbo');
            formData.append('response_format', 'json');
            
            const whisperRes = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
                method: "POST",
                headers: { "Authorization": `Bearer ${groqKey}` },
                body: formData
            });
            
            if (!whisperRes.ok) {
                throw new Error(`Erreur Whisper: ${whisperRes.status}`);
            }
            
            const whisperData = await whisperRes.json();
            userText = whisperData.text;
            
            // Informer l'utilisateur de ce qui a été compris
            await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    chat_id: chatId,
                    text: `🎤 J'ai entendu : "${userText}"`
                })
            });
        } else {
            // Ni texte ni vocal → on ignore
            return res.status(200).json({ ok: true });
        }

        if (!userText || userText.trim() === "") {
            return res.status(200).json({ ok: true });
        }

        // --- 2. APPEL À NOTRE API DE CHAT (Logique principale) ---
        
        const chatResponse = await fetch(`${siteUrl}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
                message: userText, 
                history: []
            })
        });

        if (!chatResponse.ok) {
            throw new Error(`Erreur API Chat: ${chatResponse.status}`);
        }

        const data = await chatResponse.json();
        const botReply = data.reply;
        const botLang = data.lang || "fr";

        // --- 3. ENVOI DE LA RÉPONSE TEXTE ---
        
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chat_id: chatId,
                text: botReply
            })
        });

        // --- 4. GÉNÉRATION ET ENVOI DE LA VOIX (Option A : Fichier MP3) ---
        
        const ttsUrl = `${siteUrl}/api/tts?text=${encodeURIComponent(botReply)}&lang=${botLang}`;
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

        return res.status(200).json({ ok: true });

    } catch (error) {
        console.error("Erreur Telegram:", error);
        
        try {
            await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    chat_id: chatId,
                    text: `❌ Erreur : ${error.message}`
                })
            });
        } catch (e) {
            console.error("Impossible d'envoyer l'erreur:", e);
        }
        
        return res.status(200).json({ ok: true });
    }
}
