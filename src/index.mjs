
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
            }
            return obj;
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

            // Write Parquet (all fields as UTF8 strings)
            try {
                const parquetModule = await import('parquetjs-lite');
                const parquet = parquetModule.default || parquetModule;
                const schemaFields = {};
                for (const col of csvColumns) {
                    schemaFields[col] = { type: 'UTF8' };
                }
                const parquetPath = path.join(dir, `${ratingType}.parquet`);
                const schema = new parquet.ParquetSchema(schemaFields);
                const writer = await parquet.ParquetWriter.openFile(schema, parquetPath);
                for (const row of jsonData) {
                    // Ensure all values are strings for the defined schema
                    const strRow = {};
                    for (const col of csvColumns) {
                        const v = row[col];
                        strRow[col] = v === undefined || v === null ? '' : String(v);
                    }
                    await writer.appendRow(strRow);
                }
                await writer.close();
            } catch (err) {
                console.error('Failed to write Parquet:', err);
            }
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
            jsonzip: `${fed}/${ratingType}/${ratingType}.json.zip`,
            parquet: `${fed}/${ratingType}/${ratingType}.parquet`
        };
    }
    // ...existing code up to generateIndexHtml...
}

// Generate index.html after all rating types processed
async function generateIndexHtml() {
    const summary = global.fedSummary || {};
    const ratingTypes = ['standard', 'rapid', 'blitz'];
    const templateSrc = fs.readFileSync(path.join(path.dirname(import.meta.url.replace('file://', '')), 'index.template.html'), 'utf8');
    const Handlebars = (await import('handlebars')).default;
    const template = Handlebars.compile(templateSrc);
    // Prepare federations data for template
    const federations = Object.keys(summary).sort().map(fed => ({
        fed,
        ratings: ratingTypes.map(rt => ({ info: summary[fed][rt] || null }))
    }));
    const html = template({ ratingTypes, federations });
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
    await generateIndexHtml();
})()

// Run main if this is the entry point
