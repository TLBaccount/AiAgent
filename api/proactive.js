const supabaseUrl = "https://pfmgkdpvqqvlznogfuzi.supabase.co";

async function getWeather() {
    try {
        const r = await fetch("https://api.open-meteo.com/v1/forecast?latitude=36.7538&longitude=3.0588&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Africa%2FAlgiers&forecast_days=1");
        if (!r.ok) return null;
        const d = await r.json();
        return {
            max: Math.round(d.daily.temperature_2m_max[0]),
            min: Math.round(d.daily.temperature_2m_min[0]),
            rain: d.daily.precipitation_probability_max[0]
        };
    } catch (e) { return null; }
}

async function generate(kind, weather) {
    const groqKey = process.env.GROQ_API_KEY;
    const now = new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Algiers', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
    const meteo = weather ? `Météo Alger aujourd'hui : min ${weather.min}°C, max ${weather.max}°C, risque de pluie ${weather.rain}%.` : "";
    const fallback = kind === 'briefing' ? `☀️ Bonjour ! ${meteo} Belle journée !` : "💪 Garde le sourire, chaque jour compte !";
    if (!groqKey) return fallback;
    const prompts = {
        joke: `Génère un COURT message (max 2 phrases) : une blague drôle et bienveillante OU une pensée positive motivante, en FRANÇAIS, 1 emoji max. Chaleureux, personnel, signé "Scoop". Pas d'introduction, juste le contenu.`,
        briefing: `Rédige un COURT briefing matinal (max 4 lignes) en FRANÇAIS : salue chaleureusement, donne la météo en une ligne pratique (conseil vêtements si pertinent), termine par une motivation courte. Contexte météo : ${meteo}. Date/heure : ${now}. Pas de titre, pas d'introduction.`
    };
    try {
        const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${groqKey}` },
            body: JSON.stringify({ model: "openai/gpt-oss-20b", reasoning_effort: "low", messages: [{ role: "user", content: prompts[kind] || prompts.joke }] })
        });
        if (!r.ok) throw new Error(String(r.status));
        const d = await r.json();
        return d.choices[0].message.content.trim();
    } catch (e) { return fallback; }
}

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const code = process.env.SCOOP_WEB_CODE;
    if (code && req.headers['x-scoop-code'] !== code) return res.status(401).json({ error: 'Accès refusé' });

    const kind = (req.body && req.body.kind) === 'briefing' ? 'briefing' : 'joke';
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!chatId) return res.status(200).json({ ok: false, error: 'TELEGRAM_CHAT_ID manquant' });

    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return res.status(200).json({ ok: false, error: 'TELEGRAM_BOT_TOKEN manquant' });

    const weather = kind === 'briefing' ? await getWeather() : null;
    const text = await generate(kind, weather);

    try {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, text: text })
        });
        return res.status(200).json({ ok: true, kind: kind });
    } catch (e) {
        return res.status(200).json({ ok: false, error: e.message });
    }
}
