export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL manquante' });

    const supabaseUrl = "https://pfmgkdpvqqvlznogfuzi.supabase.co";
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    try {
        // 1. Vérifier si l'URL a déjà été raccourcie (cache)
        const cacheRes = await fetch(
            `${supabaseUrl}/rest/v1/short_links?original_url=eq.${encodeURIComponent(url)}&select=short_url`,
            { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
        );
        const cached = await cacheRes.json();

        if (Array.isArray(cached) && cached.length > 0) {
            return res.status(200).json({ short_url: cached[0].short_url, cached: true });
        }

        // 2. Choisir le raccourcisseur selon la longueur de l'URL
        let shortUrl = null;
        let provider = null;

        // Si l'URL fait moins de 2000 caractères → is.gd (rapide)
        if (url.length < 2000) {
            try {
                const isgdRes = await fetch(
                    `https://is.gd/create.php?format=json&url=${encodeURIComponent(url)}`
                );
                const isgdData = await isgdRes.json();
                if (isgdData.shorturl) {
                    shortUrl = isgdData.shorturl;
                    provider = 'is.gd';
                }
            } catch (e) {
                console.error("Erreur is.gd:", e.message);
            }
        }

        // Si is.gd a échoué ou URL longue → TinyURL
        if (!shortUrl) {
            try {
                const tinyRes = await fetch(
                    `https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`
                );
                const tinyText = await tinyRes.text();
                if (tinyText && tinyText.startsWith('https://tinyurl.com/')) {
                    shortUrl = tinyText.trim();
                    provider = 'TinyURL';
                }
            } catch (e) {
                console.error("Erreur TinyURL:", e.message);
            }
        }

        // 3. Si un raccourcisseur a fonctionné, on stocke en cache
        if (shortUrl) {
            try {
                await fetch(`${supabaseUrl}/rest/v1/short_links`, {
                    method: "POST",
                    headers: { 
                        "apikey": supabaseKey, 
                        "Authorization": `Bearer ${supabaseKey}`, 
                        "Content-Type": "application/json" 
                    },
                    body: JSON.stringify({ 
                        original_url: url, 
                        short_url: shortUrl 
                    })
                });
            } catch (e) {
                console.error("Erreur cache Supabase:", e.message);
            }

            return res.status(200).json({ 
                short_url: shortUrl, 
                cached: false, 
                provider: provider 
            });
        }

        // 4. Si tout échoue, on renvoie l'URL originale
        return res.status(200).json({ 
            short_url: url, 
            cached: false, 
            provider: 'none',
            warning: 'Aucun raccourcisseur n\'a fonctionné' 
        });

    } catch (error) {
        console.error("Erreur shorten:", error);
        return res.status(200).json({ 
            short_url: url, 
            error: error.message,
            provider: 'error'
        });
    }
}
