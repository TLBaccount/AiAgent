const siteUrl = "https://ai-agent-tlb-agent.vercel.app";

// Villes du briefing matinal (extensible : ajoute/retire simplement, séparées par des virgules)
const CITIES_BRIEFING = "sidi bel abbes,oran,alger,adrar";

async function getMultiWeather() {
    try {
        const r = await fetch(`${siteUrl}/api/weather?cities=${encodeURIComponent(CITIES_BRIEFING)}&air=1`);
        if (!r.ok) return null;
        const d = await r.json();
        if (!d.meteo || !Array.isArray(d.meteo) || d.meteo.length === 0) return null;
        return d;
    } catch (e) { return null; }
}

function weatherText(d) {
    const lines = [];
    for (const m of d.meteo) {
        lines.push(`• ${m.ville} : maintenant ${m.maintenant.temp_c}°C ${m.maintenant.temps} ; aujourd'hui ${m.aujourdhui.min_c}–${m.aujourdhui.max_c}°C, pluie ${m.aujourdhui.pluie_pct}%, rafales ${m.aujourdhui.rafales_kmh} km/h, UV ${m.aujourdhui.uv_max}`);
    }
    if (d.air) lines.push(`• Qualité de l'air (${d.meteo[0].ville}) : indice ${d.air.aqi_europeen} — ${d.air.qualite}`);
    return lines.join("\n");
}

async function generate(kind, weatherStr) {
    const groqKey = process.env.GROQ_API_KEY;
    const now = new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Algiers', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
    const fallback = kind === 'briefing'
        ? `☀️ Bonjour Fateh !\n${weatherStr || "Météo momentanément indisponible."}\nBelle journée à toi !`
        : "💪 Garde le sourire, chaque jour compte !";
    if (!groqKey) return fallback;
    const prompts = {
        joke: `Génère un COURT message (max 2 phrases) : une blague drôle et bienveillante OU une pensée positive motivante, en FRANÇAIS, 1 emoji max. Chaleureux, personnel, signé "Scoop". Pas d'introduction, juste le contenu.`,
        briefing: `Rédige un briefing matinal en FRANÇAIS (max 10 lignes) à partir de ces données :
${weatherStr || "météo indisponible"}
Consignes :
- Commence par une salutation PERSONNELLE adressée à Fateh, toi son utilisateur unique (ex: "Bonjour Fateh ☀️" ou une variante douce : "Réveil en douceur, Fateh"). Tu t'occupes de LUI seul : jamais de "à tous", jamais de pluriel. Ton ton : chaleureux, attentionné, comme un assistant dévoué qui prend soin de lui.
- Une ligne par ville, lisible (températures, pluie, point pratique).
- Termine par UN conseil pratique (course à pied, camping, sorties) basé sur l'air et le vent.
- Date : ${now}. Pas de titre, pas d'introduction, pas de tableau.`
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

    let weatherStr = null;
    if (kind === 'briefing') {
        const d = await getMultiWeather();
        if (d) weatherStr = weatherText(d);
    }
    const text = await generate(kind, weatherStr);

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
