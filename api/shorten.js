export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL manquante' });

    const supabaseUrl = "https://pfmgkdpvqqvlznogfuzi.supabase.co";
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    let debugInfo = { step: "start", url_length: url.length };

    try {
        // 1. Vérifier le cache
        debugInfo.step = "check_cache";
        const cacheRes = await fetch(
            `${supabaseUrl}/rest/v1/short_links?original_url=eq.${encodeURIComponent(url)}&select=short_url`,
            { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
        );
        const cached = await cacheRes.json();
        debugInfo.cache_status = cacheRes.status;
        debugInfo.cache_result = cached;

        if (Array.isArray(cached) && cached.length > 0) {
            debugInfo.step = "cache_hit";
            return res.status(200).json({ short_url: cached[0].short_url, cached: true, debug: debugInfo });
        }

        // 2. Cascade de raccourcisseurs
        let shortUrl = null;
        let provider = null;

        // --- FOURNISSEUR 1 : TinyURL ---
        debugInfo.step = "try_tinyurl";
        try {
            const tinyRes = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`);
            const tinyText = await tinyRes.text();
            debugInfo.tinyurl_status = tinyRes.status;
            debugInfo.tinyurl_response = tinyText.substring(0, 100);
            
            if (tinyText && tinyText.startsWith('https://tinyurl.com/')) {
                shortUrl = tinyText.trim();
                provider = 'TinyURL';
            }
        } catch (e) { 
            debugInfo.tinyurl_error = e.message; 
        }

        // --- FOURNISSEUR 2 : is.gd ---
        if (!shortUrl) {
            debugInfo.step = "try_isgd";
            try {
                const isgdRes = await fetch(`https://is.gd/create.php?format=json&url=${encodeURIComponent(url)}`);
                const isgdText = await isgdRes.text();
                debugInfo.isgd_status = isgdRes.status;
                debugInfo.isgd_response = isgdText.substring(0, 100);
                
                const isgdData = JSON.parse(isgdText);
                if (isgdData.shorturl) {
                    shortUrl = isgdData.shorturl;
                    provider = 'is.gd';
                }
            } catch (e) { 
                debugInfo.isgd_error = e.message; 
            }
        }

        // --- FOURNISSEUR 3 : Short.gy ---
        if (!shortUrl) {
            debugInfo.step = "try_shortgy";
            try {
                const shortgyRes = await fetch(`https://short.gy/api/shorten?url=${encodeURIComponent(url)}`);
                const shortgyText = await shortgyRes.text();
                debugInfo.shortgy_status = shortgyRes.status;
                debugInfo.shortgy_response = shortgyText.substring(0, 100);
                
                const shortgyData = JSON.parse(shortgyText);
                if (shortgyData && shortgyData.link) {
                    shortUrl = shortgyData.link;
                    provider = 'Short.gy';
                }
            } catch (e) { 
                debugInfo.shortgy_error = e.message; 
            }
        }

        // 3. Stocker en cache si un raccourcisseur a fonctionné
        if (shortUrl) {
            debugInfo.step = "store_cache";
            debugInfo.provider = provider;
            try {
                const storeRes = await fetch(`${supabaseUrl}/rest/v1/short_links`, {
                    method: "POST",
                    headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}`, "Content-Type": "application/json" },
                    body: JSON.stringify({ original_url: url, short_url: shortUrl })
                });
                debugInfo.store_status = storeRes.status;
            } catch (e) { 
                debugInfo.store_error = e.message; 
            }

            return res.status(200).json({ short_url: shortUrl, cached: false, provider: provider, debug: debugInfo });
        }

        // 4. Fallback : URL originale
        debugInfo.step = "fallback_original";
        return res.status(200).json({ short_url: url, cached: false, provider: 'none', debug: debugInfo });

    } catch (error) {
        debugInfo.step = "catch_error";
        debugInfo.error = error.message;
        return res.status(200).json({ short_url: url, error: error.message, debug: debugInfo });
    }
}
