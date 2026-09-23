const supabaseUrl = "https://pfmgkdpvqqvlznogfuzi.supabase.co";

// Ton chat Telegram par défaut (utilisé si le rappel n'a pas de chat_id)
const TELEGRAM_DEFAULT_CHAT = "1609620985";

function checkAuth(req) {
    const code = process.env.SCOOP_WEB_CODE;
    if (!code) return true;
    return req.headers['x-scoop-code'] === code;
}

async function fetchT(url, options, ms) {
    const opts = Object.assign({}, options || {}, { signal: AbortSignal.timeout(ms) });
    return fetch(url, opts);
}

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    if (!checkAuth(req)) return res.status(401).json({ error: 'Accès refusé' });

    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
    const token = process.env.TELEGRAM_BOT_TOKEN;

    try {
        // 1. Rappels arrivés à échéance et pas encore envoyés
        const nowIso = new Date().toISOString();
        const r = await fetchT(`${supabaseUrl}/rest/v1/reminders?done=eq.false&due_at=lte.${encodeURIComponent(nowIso)}&select=*`, {
            headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` }
        }, 4000);
        const due = await r.json();

        if (!Array.isArray(due) || due.length === 0) {
            return res.status(200).json({ ok: true, sent: 0 });
        }

        // 2. Envoyer chaque rappel sur Telegram, puis le marquer comme envoyé
        let sent = 0;
        for (const rem of due) {
            const chatId = rem.chat_id || TELEGRAM_DEFAULT_CHAT;
            try {
                await fetchT(`https://api.telegram.org/bot${token}/sendMessage`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ chat_id: chatId, text: "⏰ Rappel : " + rem.text })
                }, 4000);
                sent++;
            } catch (e) {
                console.error("Erreur envoi rappel:", e.message);
            }
            await fetchT(`${supabaseUrl}/rest/v1/reminders?id=eq.${rem.id}`, {
                method: "PATCH",
                headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}`, "Content-Type": "application/json", "Prefer": "return=minimal" },
                body: JSON.stringify({ done: true, sent_at: nowIso })
            }, 4000);
        }

        return res.status(200).json({ ok: true, sent: sent });
    } catch (error) {
        console.error("Erreur reminders-check:", error.message);
        return res.status(200).json({ ok: false, error: error.message });
    }
}
