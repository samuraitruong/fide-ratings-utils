
import fetch from 'node-fetch';
import AdmZip from 'adm-zip';
import fs from 'fs';
import path from 'path';

/**
 * Download, extract, split by federation, and save files for FIDE ratings.
 * @param {string} url - The URL to download the ZIP file from.
 * @param {string} ratingType - The rating type (standard, blitz, rapid).
 * @returns {Promise<void>}
 */
export async function processFideRatings(url, ratingType) {
    // Download ZIP
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to download: ${res.status}`);
    const buffer = await res.buffer();

    // Extract TXT from ZIP
    const zip = new AdmZip(buffer);
    const zipEntries = zip.getEntries();
    const txtEntry = zipEntries.find(e => e.entryName.endsWith('.txt'));
    if (!txtEntry) throw new Error('No .txt file found in ZIP');
    const txtContent = txtEntry.getData().toString('utf8');

    // Parse header and lines
    const lines = txtContent.split(/\r?\n/).filter(Boolean);
    const header = lines[0];
    const dataLines = lines.slice(1);

    // Find Fed column index
    const fedStart = header.indexOf('Fed');
    const fedEnd = fedStart + 'Fed'.length;

    // Group lines by federation
    const fedMap = {};
    for (const line of dataLines) {
        const fed = line.substring(fedStart, fedEnd).trim();
        if (!fed) continue;
        if (!fedMap[fed]) fedMap[fed] = [];
        fedMap[fed].push(line);
    }

    // Collect summary for index.html
    if (!global.fedSummary) global.fedSummary = {};
    for (const [fed, fedLines] of Object.entries(fedMap)) {
        const dir = path.join('data', fed, ratingType);
        fs.mkdirSync(dir, { recursive: true });
        const txtPath = path.join(dir, `${ratingType}.txt`);
        const txtZipPath = path.join(dir, `${ratingType}.txt.zip`);
        const jsonPath = path.join(dir, `${ratingType}.json`);
        const jsonZipPath = path.join(dir, `${ratingType}.json.zip`);
        const csvPath = path.join(dir, `${ratingType}.csv`);
        const csvZipPath = path.join(dir, `${ratingType}.csv.zip`);

        // Write TXT
        fs.writeFileSync(txtPath, [header, ...fedLines].join('\n'));

        // Write TXT ZIP
        const txtZip = new AdmZip();
        txtZip.addFile(`${ratingType}.txt`, Buffer.from([header, ...fedLines].join('\n'), 'utf8'));
        txtZip.writeZip(txtZipPath);

        // Improved: Parse header into columns and use fixed-width slicing for each line
        const colRegex = /(\S[\S ]*?)(?=\s{2,}|$)/g;
        let match;
        let columns = [];
        let colPositions = [];
        while ((match = colRegex.exec(header)) !== null) {
            columns.push(match[1].trim());
            colPositions.push(match.index);
        }
        colPositions.push(header.length);

        const jsonData = fedLines.map(line => {
            let obj = {};
            for (let i = 0; i < columns.length; i++) {
                const start = colPositions[i];
                const end = colPositions[i + 1];
                let value = line.substring(start, end).trim();
                if (columns[i] === 'Fed Sex Tit') {
                    const fed = value.substring(0, 3).trim();
                    let rest = value.substring(3).trim();
                    let [sex, ...titles] = rest.split(/\s+/);
                    obj['Fed'] = fed;
                    obj['Sex'] = sex || '';
                    obj['Title'] = titles.join(' ') || '';
                } else if (columns[i] === 'WTit OTit') {
                    let [wtit, otit] = value.split(/\s+/);
                    obj['WTit'] = wtit || '';
                    obj['OTit'] = otit || '';
                } else if (columns[i].startsWith('FOA AUG')) {
                    const headerParts = columns[i].split(/\s+/);
                    let [foa, gms, k] = value.split(/\s+/);
                    obj['FOA'] = foa || '';
                    obj['Rating'] = headerParts[1] || '';
                    obj['Gms'] = gms || '';
                    obj['K'] = k || '';
                } else if (columns[i] === 'B-day Flag') {
                    let [bday, ...flag] = value.split(/\s+/);
                    obj['B-day'] = bday || '';
                    obj['Flag'] = flag.join(' ') || '';
                } else {
                    obj[columns[i]] = value;
                }
                return obj;
            }
        });

        // Write JSON
        fs.writeFileSync(jsonPath, JSON.stringify(jsonData, null, 2));

        // Write JSON ZIP
        const jsonZip = new AdmZip();
        jsonZip.addFile(`${ratingType}.json`, Buffer.from(JSON.stringify(jsonData, null, 2), 'utf8'));
        jsonZip.writeZip(jsonZipPath);

        // Write CSV
        if (jsonData.length > 0) {
            const csvColumns = Object.keys(jsonData[0]);
            const csvRows = [csvColumns.join(','), ...jsonData.map(row => csvColumns.map(col => {
                let val = row[col] ?? '';
                if (typeof val === 'string' && (val.includes(',') || val.includes('"') || val.includes('\n'))) {
                    val = '"' + val.replace(/"/g, '""') + '"';
                }
                return val;
            }).join(','))];
            fs.writeFileSync(csvPath, csvRows.join('\n'));

            // Write CSV ZIP
            const csvZip = new AdmZip();
            csvZip.addFile(`${ratingType}.csv`, Buffer.from(csvRows.join('\n'), 'utf8'));
            csvZip.writeZip(csvZipPath);
        }

        // Collect summary for index.html
        if (!global.fedSummary[fed]) global.fedSummary[fed] = {};
        global.fedSummary[fed][ratingType] = {
            count: jsonData.length,
            txt: `${fed}/${ratingType}/${ratingType}.txt`,
            txtzip: `${fed}/${ratingType}/${ratingType}.txt.zip`,
            csv: `${fed}/${ratingType}/${ratingType}.csv`,
            csvzip: `${fed}/${ratingType}/${ratingType}.csv.zip`,
            json: `${fed}/${ratingType}/${ratingType}.json`,
            jsonzip: `${fed}/${ratingType}/${ratingType}.json.zip`
        };
    }
    // ...existing code up to generateIndexHtml...
}

// Generate index.html after all rating types processed
function generateIndexHtml() {
    const summary = global.fedSummary || {};
    const ratingTypes = ['standard', 'rapid', 'blitz'];
        let html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>FIDE Ratings Index</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
</head>
<body class="bg-light">
<div class="container py-4">
    <h1 class="mb-4">FIDE Ratings by Federation</h1>
    <div class="table-responsive">
        <table class="table table-bordered table-striped align-middle">
            <thead class="table-dark">
                <tr><th>FED</th>`;
        for (const rt of ratingTypes) html += `<th>${rt}</th>`;
        html += `</tr></thead><tbody>`;
        for (const fed of Object.keys(summary).sort()) {
                html += `<tr><td><strong>${fed}</strong></td>`;
                for (const rt of ratingTypes) {
                        const info = summary[fed][rt];
                        if (info) {
                                html += `<td>
                                    <div><span class="badge bg-primary">Count: ${info.count}</span></div>
                                    <div class="mt-2">
                                        <a class="btn btn-sm btn-outline-secondary" href="${info.txt}">TXT</a>
                                        <a class="btn btn-sm btn-outline-secondary" href="${info.txtzip}">TXT.zip</a>
                                        <a class="btn btn-sm btn-outline-success" href="${info.csv}">CSV</a>
                                        <a class="btn btn-sm btn-outline-success" href="${info.csvzip}">CSV.zip</a>
                                        <a class="btn btn-sm btn-outline-info" href="${info.json}">JSON</a>
                                        <a class="btn btn-sm btn-outline-info" href="${info.jsonzip}">JSON.zip</a>
                                    </div>
                                </td>`;
                        } else {
                                html += `<td>-</td>`;
                        }
                }
                html += `</tr>`;
        }
        html += `</tbody></table>
    </div>
</div>
</body>
</html>`;
        fs.writeFileSync(path.join('data', 'index.html'), html);
}


// Main runner to process all rating types and generate index.html
const ratingSources = [
    { url: 'http://ratings.fide.com/download/standard_rating_list.zip', type: 'standard' },
    { url: 'http://ratings.fide.com/download/rapid_rating_list.zip', type: 'rapid' },
    { url: 'http://ratings.fide.com/download/blitz_rating_list.zip', type: 'blitz' }
];

(async function main() {
    for (const { url, type } of ratingSources) {
        await processFideRatings(url, type);
    }
    generateIndexHtml();
})()

// Run main if this is the entry point
