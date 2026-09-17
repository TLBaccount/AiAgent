function sanitizeHeader(text) {
    if (!text) return "Scoop Data";
    return text.replace(/[–—]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[^\x00-\x7F]/g, '').trim() || "Scoop Data";
}

function buildHtmlTable(data, title) {
    let html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title>`;
    html += `<style>body{font-family:Arial,sans-serif;padding:20px;} table{border-collapse:collapse;width:100%;} th,td{border:1px solid #ddd;padding:8px;text-align:left;} th{background:#1e3c72;color:white;} tr:nth-child(even){background:#f2f2f2;}</style>`;
    html += `</head><body><h2>${title}</h2><table>`;
    
    if (data.headers && data.rows) {
        html += '<thead><tr>';
        data.headers.forEach(h => html += `<th>${h}</th>`);
        html += '</tr></thead><tbody>';
        data.rows.forEach(row => {
            html += '<tr>';
            row.forEach(cell => html += `<td>${cell}</td>`);
            html += '</tr>';
        });
        html += '</tbody>';
    }
    html += '</table></body></html>';
    return html;
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
            const htmlContent = buildHtmlTable(data, title || 'Tableau');
            
            const brewResponse = await fetch("https://brewpage.app/api/html", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "User-Agent": "Scoop/1.0"
                },
                body: JSON.stringify({ content: htmlContent, ttlDays: 30 })
            });

            if (!brewResponse.ok) throw new Error(`Erreur BrewPage: ${brewResponse.status}`);
            const brewData = await brewResponse.json();
            return res.status(200).json({ share_url: brewData.link, tool: 'BrewPage' });
        }

        if (type === 'text') {
            const pastebinKey = process.env.PASTEBIN_API_KEY;
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
