export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL manquante' });

    const supabaseUrl = "https://pfmgkdpvqqvlznogfuzi.supabase.co";
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    try {
        // 1. Vérifier le cache
        const cacheRes = await fetch(
            `${supabaseUrl}/rest/v1/short_links?original_url=eq.${encodeURIComponent(url)}&select=short_url`,
            { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
        );
        const cached = await cacheRes.json();

        if (Array.isArray(cached) && cached.length > 0) {
            return res.status(200).json({ short_url: cached[0].short_url, cached: true });
        }

        // 2. Cascade de raccourcisseurs SANS clé API
        let shortUrl = null;
        let provider = null;

        // --- FOURNISSEUR 1 : TinyURL ---
        if (!shortUrl) {
            try {
                const tinyRes = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`);
                const tinyText = await tinyRes.text();
                if (tinyText && tinyText.startsWith('https://tinyurl.com/')) {
                    shortUrl = tinyText.trim();
                    provider = 'TinyURL';
                }
            } catch (e) { console.error("Erreur TinyURL:", e.message); }
        }

        // --- FOURNISSEUR 2 : is.gd ---
        if (!shortUrl) {
            try {
                const isgdRes = await fetch(`https://is.gd/create.php?format=json&url=${encodeURIComponent(url)}`);
                const isgdData = await isgdRes.json();
                if (isgdData.shorturl) {
                    shortUrl = isgdData.shorturl;
                    provider = 'is.gd';
                }
            } catch (e) { console.error("Erreur is.gd:", e.message); }
        }

        // --- FOURNISSEUR 3 : Short.gy (par Short.io, sans clé API) ---
        if (!shortUrl) {
            try {
                const shortgyRes = await fetch(`https://short.gy/api/shorten?url=${encodeURIComponent(url)}`);
                const shortgyData = await shortgyRes.json();
                if (shortgyData && shortgyData.link) {
                    shortUrl = shortgyData.link;
                    provider = 'Short.gy';
                }
            } catch (e) { console.error("Erreur Short.gy:", e.message); }
        }

        // 3. Stocker en cache si un raccourcisseur a fonctionné
        if (shortUrl) {
            try {
                await fetch(`${supabaseUrl}/rest/v1/short_links`, {
                    method: "POST",
                    headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}`, "Content-Type": "application/json" },
                    body: JSON.stringify({ original_url: url, short_url: shortUrl })
                });
            } catch (e) { console.error("Erreur cache Supabase:", e.message); }

            return res.status(200).json({ short_url: shortUrl, cached: false, provider: provider });
        }

        // 4. Fallback : URL originale
        return res.status(200).json({ short_url: url, cached: false, provider: 'none', warning: 'Aucun raccourcisseur n\'a fonctionné' });

    } catch (error) {
        console.error("Erreur shorten:", error);
        return res.status(200).json({ short_url: url, error: error.message, provider: 'error' });
    }
}
