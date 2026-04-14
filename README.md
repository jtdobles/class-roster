# Class Roster Generator MVP

A simple React + Vite prototype for importing class rosters from CSV, generating suggested class groups, and exporting the grouped roster.

## Getting started

1. Install dependencies:
   ```bash
   npm install
   ```

2. Run the dev server:
   ```bash
   npm run dev
   ```

3. Open the local URL shown in the terminal.

## Features

- CSV import using header row
- Excel import from `.xlsx` / `.xls`
- PDF text import for roster tables
- Manual roster entry with custom headers
- Roster preview
- Multi-criteria numeric grouping with field direction and weight
- Suggested class assignment generation
- Export grouped roster as CSV or Excel
- Manually adjust students between suggested classes after generation

## Sample data

A sample roster file is available at `sample-roster.csv`.
Use it to verify the import flow and experiment with grouping rules.

## Usage examples

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the dev server:
   ```bash
   npm run dev
   ```

3. In the web app:
   - Choose `Upload file`.
   - Select `sample-roster.csv`.
   - Add one or more grouping criteria.
   - Set the group count.
   - Click `Generate Suggested Classes`.
   - Review the suggested classes and adjust assignments using the dropdowns if needed.
   - Download the result as CSV or Excel.

4. For manual entry:
   - Choose `Manual entry`.
   - Enter column headers such as `Name,Math Score,Reading Score`.
   - Add each student row.
   - Generate suggested classes and export.
