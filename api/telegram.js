// Anti-spam : mémorise les erreurs par utilisateur
const errorCounts = {};

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(200).json({ ok: true });
    }

    const { message } = req.body;

    if (!message || !message.text) {
        return res.status(200).json({ ok: true });
    }

    const chatId = message.chat.id;
    const userText = message.text;
    const token = process.env.TELEGRAM_BOT_TOKEN;

    try {
        // 1. Appel à notre API de chat (avec toute la logique)
        const chatResponse = await fetch("https://ai-agent-tlb-agent.vercel.app/api/chat", {
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

        // Réinitialiser le compteur d'erreurs en cas de succès
        errorCounts[chatId] = 0;

        // 2. Envoi de la réponse à Telegram
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chat_id: chatId,
                text: botReply
            })
        });

        return res.status(200).json({ ok: true });

    } catch (error) {
        console.error("Erreur Telegram:", error);
        
        // Incrémenter le compteur d'erreurs pour ce chat
        if (!errorCounts[chatId]) {
            errorCounts[chatId] = 0;
        }
        errorCounts[chatId]++;

        // Si moins de 3 erreurs, on envoie le message d'erreur
        if (errorCounts[chatId] <= 3) {
            try {
                await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        chat_id: chatId,
                        text: `⚠️ Erreur (${errorCounts[chatId]}/3) : Une erreur s'est produite.`
                    })
                });
            } catch (e) {
                console.error("Impossible d'envoyer le message d'erreur:", e);
            }
        }

        // On renvoie toujours 200 pour éviter que Telegram ne réessaie
        return res.status(200).json({ ok: true });
    }
}
