function sanitizeHeader(text) {
    if (!text) return "Scoop Data";
    return text.replace(/[–—]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[^\x00-\x7F]/g, '').trim() || "Scoop Data";
}

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { type, data, title } = req.body;

    try {
        if (type === 'chart') {
            const chartConfig = {
                type: data.chartType || 'bar',
                data: { labels: data.labels || [], datasets: data.datasets || [] },
                options: { title: { display: !!title, text: title || '' } }
            };
            const chartUrl = `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(chartConfig))}&w=600&h=400&backgroundColor=white`;
            return res.status(200).json({ share_url: chartUrl, tool: 'QuickChart' });
        }

        if (type === 'json') {
            // Convertir les données en CSV
            const headers = data.headers || [];
            const rows = data.rows || [];
            
            let csvContent = headers.join(',') + '\n';
            rows.forEach(row => {
                csvContent += row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',') + '\n';
            });

            // Créer un Gist GitHub avec le CSV
            const githubToken = process.env.GITHUB_TOKEN;
            if (!githubToken) throw new Error('Token GitHub manquant');

            const gistResponse = await fetch("https://api.github.com/gists", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${githubToken}`,
                    "Content-Type": "application/json",
                    "User-Agent": "Scoop"
                },
                body: JSON.stringify({
                    description: sanitizeHeader(title) + " - Données CSV",
                    public: true,
                    files: {
                        "donnees.csv": {
                            content: csvContent
                        }
                    }
                })
            });

            if (!gistResponse.ok) {
                const errorText = await gistResponse.text();
                throw new Error(`Erreur GitHub Gist: ${gistResponse.status} - ${errorText}`);
            }

            const gistData = await gistResponse.json();
            const csvUrl = gistData.files["donnees.csv"].raw_url;

            return res.status(200).json({ share_url: csvUrl, tool: 'CSV' });
        }

        if (type === 'text') {
            const pastebinKey = process.env.PASTEBIN_API_KEY;
            if (!pastebinKey) throw new Error('Clé Pastebin manquante');
            
            const params = new URLSearchParams();
            params.append('api_dev_key', pastebinKey);
            params.append('api_option', 'paste');
            params.append('api_paste_code', data.content || data);
            params.append('api_paste_name', sanitizeHeader(title));
            params.append('api_paste_format', 'text');
            params.append('api_paste_expire_date', '1W');
            params.append('api_paste_private', '0');

            const response = await fetch("https://pastebin.com/api/api_post.php", {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: params.toString()
            });

            const pastebinUrl = await response.text();
            return res.status(200).json({ share_url: pastebinUrl, tool: 'Pastebin' });
        }

        return res.status(400).json({ error: 'Type non supporté.' });
    } catch (error) {
        console.error("Erreur share:", error);
        return res.status(500).json({ error: error.message });
    }
}
