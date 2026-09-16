export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { type, data, title } = req.body;

    try {
        // ============================================
        // 1. QUICKCHART (graphiques, sans clé API)
        // ============================================
        if (type === 'chart') {
            const chartConfig = {
                type: data.chartType || 'bar',
                data: {
                    labels: data.labels || [],
                    datasets: data.datasets || []
                },
                options: {
                    title: {
                        display: !!title,
                        text: title || ''
                    }
                }
            };

            const chartUrl = `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(chartConfig))}&w=600&h=400&backgroundColor=white`;
            
            return res.status(200).json({ 
                share_url: chartUrl, 
                type: 'chart',
                tool: 'QuickChart'
            });
        }

        // ============================================
        // 2. JSONBIN (données JSON, avec clé API)
        // ============================================
        if (type === 'json') {
            const jsonbinKey = process.env.JSONBIN_API_KEY;
            if (!jsonbinKey) {
                throw new Error('Clé JSONBin manquante');
            }

            const response = await fetch("https://api.jsonbin.io/v3/b", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-Master-Key": jsonbinKey,
                    "X-Bin-Name": title || "Scoop Data",
                    "X-Bin-Private": "false"
                },
                body: JSON.stringify(data)
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Erreur JSONBin: ${response.status} - ${errorText}`);
            }

            const result = await response.json();
            const jsonbinUrl = `https://api.jsonbin.io/v3/b/${result.metadata.id}/latest`;

            return res.status(200).json({ 
                share_url: jsonbinUrl, 
                type: 'json',
                tool: 'JSONBin',
                bin_id: result.metadata.id
            });
        }

        // ============================================
        // 3. PASTEBIN (texte brut, avec clé API)
        // ============================================
        if (type === 'text') {
            const pastebinKey = process.env.PASTEBIN_API_KEY;
            if (!pastebinKey) {
                throw new Error('Clé Pastebin manquante');
            }

            const params = new URLSearchParams();
            params.append('api_dev_key', pastebinKey);
            params.append('api_option', 'paste');
            params.append('api_paste_code', data.content || data);
            params.append('api_paste_name', title || 'Scoop Data');
            params.append('api_paste_format', 'text');
            params.append('api_paste_expire_date', '1W');
            params.append('api_paste_private', '0');

            const response = await fetch("https://pastebin.com/api/api_post.php", {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: params.toString()
            });

            const pastebinUrl = await response.text();

            if (!pastebinUrl.startsWith('https://pastebin.com/')) {
                throw new Error(`Erreur Pastebin: ${pastebinUrl}`);
            }

            return res.status(200).json({ 
                share_url: pastebinUrl, 
                type: 'text',
                tool: 'Pastebin'
            });
        }

        return res.status(400).json({ error: 'Type non supporté. Utilisez : chart, json, text.' });

    } catch (error) {
        console.error("Erreur share:", error);
        return res.status(500).json({ error: error.message });
    }
}
