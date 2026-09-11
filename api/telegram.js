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
        // 1. Appel à notre API de chat (avec toute la logique : langues, actions, etc.)
        const chatResponse = await fetch("https://ai-agent-tlb-agent.vercel.app/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
                message: userText, 
                history: [] // Historique vide pour Telegram (pour l'instant)
            })
        });

        if (!chatResponse.ok) {
            throw new Error(`Erreur API Chat: ${chatResponse.status}`);
        }

        const data = await chatResponse.json();
        const botReply = data.reply;

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
        
        // Envoi d'un message d'erreur à l'utilisateur
        try {
            await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    chat_id: chatId,
                    text: "Désolé, une erreur s'est produite. Réessayez plus tard."
                })
            });
        } catch (e) {
            console.error("Impossible d'envoyer le message d'erreur:", e);
        }
        
        return res.status(500).json({ error: "Erreur serveur" });
    }
}
