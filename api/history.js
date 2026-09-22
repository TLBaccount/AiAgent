const supabaseUrl = "https://pfmgkdpvqqvlznogfuzi.supabase.co";

export default async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    const code = process.env.SCOOP_WEB_CODE;
    if (code && req.headers['x-scoop-code'] !== code) return res.status(401).json({ error: 'Accès refusé' });

    const url = new URL(req.url, "http://localhost");
    const ch = url.searchParams.get("channel") === "telegram" ? "telegram" : "web";

    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
    try {
        const r = await fetch(`${supabaseUrl}/rest/v1/messages?select=*&order=id.desc&limit=100&channel=eq.${ch}`, {
            headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` }
        });
        const data = await r.json();
        const messages = Array.isArray(data) ? data.reverse() : [];
        return res.status(200).json({ messages: messages });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}
