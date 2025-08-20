## FIDE Ratings Utils

Generate a browsable, per-federation mirror of the official FIDE rating lists. The script downloads the latest Standard, Rapid, and Blitz rating ZIPs from FIDE, splits the data by federation, exports TXT/CSV/JSON (and zipped variants), and builds an `index.html` to explore the results. The site is published to GitHub Pages.

### Features
- Split official FIDE rating lists by federation (e.g., `USA`, `VIE`, `IND`).
- Export each federation and rating type to TXT, CSV, JSON, plus `.zip` archives.
- Export Parquet (`.parquet`) for each federation and rating type (no zip).
- Auto-generate an `index.html` to browse and download files.
- Automated CI to generate, commit with "[skip ci]", and deploy to GitHub Pages.

### Data sources
- Standard: `http://ratings.fide.com/download/standard_rating_list.zip`
- Rapid: `http://ratings.fide.com/download/rapid_rating_list.zip`
- Blitz: `http://ratings.fide.com/download/blitz_rating_list.zip`

### Output structure
The generator writes everything under `./data` and produces an `index.html` at the site root (deployed from the `data` directory):

```text
data/
  index.html
  USA/
    standard/
      standard.txt
      standard.txt.zip
      standard.csv
      standard.csv.zip
      standard.json
      standard.json.zip
      standard.parquet
    rapid/
      ...
    blitz/
      ...
  VIE/
    standard/
      ...
  ...
```

### Requirements
- Node.js 20+ (ESM/"type": "module")

### Local setup and usage
1. Install dependencies:

```bash
npm ci
```

2. Run the generator:

```bash
node src/index.mjs
```

3. Preview the output locally:
   - Open `data/index.html` in your browser, or
   - Serve the folder locally, e.g.:

```bash
cd data && python3 -m http.server 8000
# then visit http://localhost:8000
```

### CI/CD (GitHub Actions)
- Workflow: `.github/workflows/static.yml`
  - Triggers on pushes to `main`, a manual dispatch, and a schedule.
  - Sets up Node 20 with npm cache, installs deps, and runs `node src/index.mjs`.
  - Commits any changes to `data/` with message `chore: update generated data [skip ci]` to avoid CI loops.
  - Uploads `./data` as the Pages artifact and deploys to GitHub Pages.

Published site: `https://samuraitruong.github.io/fide-ratings-utils/`

### Customization
- To change sources or add new rating types, edit `ratingSources` in `src/index.mjs`.
- The index page layout is rendered from `src/index.template.html` using Handlebars.

### Notes
- Source data and formats are defined by FIDE; fields may change over time.
- Be considerate of FIDE servers; this project includes a schedule to limit runs.

### License
MIT

### Acknowledgements
Data provided by FIDE (`ratings.fide.com`). This project is not affiliated with FIDE.



