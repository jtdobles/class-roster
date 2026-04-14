import { useMemo, useState } from 'react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist/legacy/build/pdf';

GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.12.313/pdf.worker.min.js';

const GROUP_LIMIT = 6;

function normalizeRow(row) {
  const normalized = {};
  Object.entries(row).forEach(([key, value]) => {
    normalized[key.trim()] = typeof value === 'string' ? value.trim() : value;
  });
  return normalized;
}

function parseCSV(file, onComplete) {
  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    complete: (results) => {
      const rows = results.data.map(normalizeRow);
      onComplete(rows, results.meta.fields || []);
    },
    error: (error) => {
      console.error(error);
      onComplete([], []);
    },
  });
}

function parseExcel(file, onComplete) {
  const reader = new FileReader();

  reader.onload = (event) => {
    const data = new Uint8Array(event.target.result);
    const workbook = XLSX.read(data, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });

    if (rows.length === 0) {
      onComplete([], []);
      return;
    }

    const headers = rows[0].map((header) => String(header).trim());
    const parsedRows = rows.slice(1).map((row) => {
      const normalized = {};
      headers.forEach((header, index) => {
        normalized[header] = row[index] != null ? String(row[index]).trim() : '';
      });
      return normalized;
    });

    onComplete(parsedRows, headers);
  };

  reader.onerror = () => {
    console.error('Unable to read Excel file.');
    onComplete([], []);
  };

  reader.readAsArrayBuffer(file);
}

function groupTextItemsByLine(items) {
  const lines = [];

  items.forEach((item) => {
    if (!item.str?.trim()) return;
    const y = item.transform?.[5] ?? 0;
    const x = item.transform?.[4] ?? 0;
    const normalizedY = Math.round(y * 10) / 10;
    const existing = lines.find((line) => Math.abs(line.y - normalizedY) < 2);

    if (existing) {
      existing.items.push({ x, str: item.str });
    } else {
      lines.push({ y: normalizedY, items: [{ x, str: item.str }] });
    }
  });

  return lines
    .sort((a, b) => b.y - a.y)
    .map((line) => line.items.sort((a, b) => a.x - b.x).map((item) => item.str).join(' '));
}

function splitLine(line) {
  if (line.includes(',')) return line.split(',').map((value) => value.trim());
  if (line.includes('\t')) return line.split('\t').map((value) => value.trim());
  if (/ {2,}/.test(line)) return line.split(/ {2,}/).map((value) => value.trim());
  return line.split(/\s+/).map((value) => value.trim());
}

function parsePDF(file, onComplete) {
  const reader = new FileReader();

  reader.onload = async (event) => {
    try {
      const buffer = event.target.result;
      const document = await getDocument({ data: buffer }).promise;
      const page = await document.getPage(1);
      const content = await page.getTextContent();
      const lines = groupTextItemsByLine(content.items);

      if (lines.length < 2) {
        onComplete([], []);
        return;
      }

      const headerCells = splitLine(lines[0]).filter(Boolean);
      const parsedRows = lines.slice(1).map((line) => {
        const values = splitLine(line);
        const row = {};
        headerCells.forEach((header, index) => {
          row[header] = values[index] != null ? values[index] : '';
        });
        return normalizeRow(row);
      }).filter((row) => Object.values(row).some((value) => value !== ''));

      onComplete(parsedRows, headerCells);
    } catch (error) {
      console.error(error);
      onComplete([], []);
    }
  };

  reader.onerror = () => {
    console.error('Unable to read PDF file.');
    onComplete([], []);
  };

  reader.readAsArrayBuffer(file);
}

function getNumericFields(rows, fields) {
  return fields.filter((field) => {
    const values = rows.slice(0, 10).map((row) => row[field]);
    return values.every((value) => value !== undefined && value !== '' && !Number.isNaN(Number(value)));
  });
}

function createEmptyRow(fields) {
  return fields.reduce((acc, field) => {
    acc[field] = '';
    return acc;
  }, {});
}

function computeCompositeScore(student, criteria) {
  return criteria.reduce((score, criterion) => {
    if (!criterion.field) return score;
    const value = Number(student[criterion.field]);
    if (Number.isNaN(value)) return score;
    const weight = Number(criterion.weight) || 1;
    return score + weight * (criterion.direction === 'desc' ? value : -value);
  }, 0);
}

function buildGroups(students, criteria, groupCount) {
  if (criteria.length === 0 || students.length === 0) return [];

  const sorted = [...students]
    .map((student) => ({ student, score: computeCompositeScore(student, criteria) }))
    .sort((a, b) => b.score - a.score)
    .map((item) => item.student);

  const groups = Array.from({ length: groupCount }, (_, index) => ({
    name: `Class ${index + 1}`,
    students: [],
  }));

  sorted.forEach((student, index) => {
    const groupIndex = Math.floor((index * groupCount) / sorted.length);
    groups[groupIndex].students.push(student);
  });

  return groups;
}

function downloadCSV(rows, fields, filename = 'grouped-roster.csv') {
  const csvRows = [fields.join(','), ...rows.map((row) => fields.map((field) => `"${String(row[field] ?? '').replace(/"/g, '""')}"`).join(','))];
  const csv = csvRows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function downloadExcel(rows, fields, filename = 'grouped-roster.xlsx') {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(rows, { header: fields });
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Suggested Classes');
  XLSX.writeFile(workbook, filename);
}

export default function App() {
  const [mode, setMode] = useState('upload');
  const [students, setStudents] = useState([]);
  const [fields, setFields] = useState([]);
  const [criteria, setCriteria] = useState([]);
  const [groupCount, setGroupCount] = useState(2);
  const [groups, setGroups] = useState([]);
  const [error, setError] = useState('');
  const [manualHeaders, setManualHeaders] = useState('Name,Math Score,Reading Score');
  const [manualRow, setManualRow] = useState({});

  const numericFields = useMemo(() => getNumericFields(students, fields), [students, fields]);

  const initializeFields = (parsedFields, initialRows = []) => {
    setFields(parsedFields);
    const defaultField = getNumericFields(initialRows, parsedFields)[0] || parsedFields[0] || '';
    setCriteria(defaultField ? [{ field: defaultField, direction: 'desc', weight: 1 }] : []);
    setManualRow(createEmptyRow(parsedFields));
    setGroups([]);
  };

  const handleFileChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError('');
    const extension = file.name.split('.').pop()?.toLowerCase();

    const complete = (rows, parsedFields) => {
      if (rows.length === 0 || parsedFields.length === 0) {
        setError('The file did not contain any valid rows or headers.');
        setStudents([]);
        setFields([]);
        setCriteria([]);
        setGroups([]);
        return;
      }
      setStudents(rows);
      initializeFields(parsedFields, rows);
    };

    if (extension === 'xlsx' || extension === 'xls') {
      parseExcel(file, complete);
    } else if (extension === 'pdf') {
      parsePDF(file, complete);
    } else {
      parseCSV(file, complete);
    }
  };

  const handleManualHeaderSubmit = () => {
    const parsedFields = manualHeaders
      .split(',')
      .map((header) => header.trim())
      .filter(Boolean);

    if (parsedFields.length === 0) {
      setError('Enter at least one header name for manual entry.');
      return;
    }

    setError('');
    setStudents([]);
    initializeFields(parsedFields, []);
  };

  const handleManualRowChange = (field, value) => {
    setManualRow((current) => ({ ...current, [field]: value }));
  };

  const handleAddManualRow = () => {
    if (fields.length === 0) {
      setError('Define manual headers before adding a student.');
      return;
    }

    const cleanedRow = createEmptyRow(fields);
    fields.forEach((field) => {
      cleanedRow[field] = manualRow[field]?.trim() ?? '';
    });

    if (Object.values(cleanedRow).every((value) => value === '')) {
      setError('Enter at least one value for the manual student row.');
      return;
    }

    setError('');
    setStudents((current) => [...current, cleanedRow]);
    setManualRow(createEmptyRow(fields));
    setGroups([]);
  };

  const handleClearRoster = () => {
    setStudents([]);
    setFields([]);
    setCriteria([]);
    setGroups([]);
    setError('');
    setManualRow({});
  };

  const handleAddCriterion = () => {
    const defaultField = numericFields[0] || fields[0] || '';
    setCriteria((current) => [...current, { field: defaultField, direction: 'desc', weight: 1 }]);
  };

  const handleRemoveCriterion = (index) => {
    setCriteria((current) => current.filter((_, idx) => idx !== index));
  };

  const handleCriteriaChange = (index, key, value) => {
    setCriteria((current) =>
      current.map((item, idx) => (idx === index ? { ...item, [key]: value } : item))
    );
  };

  const handleGenerate = () => {
    const validCriteria = criteria.filter((criterion) => criterion.field && criterion.weight !== 0);
    if (validCriteria.length === 0) {
      setError('Choose at least one grouping criterion.');
      return;
    }
    if (students.length < 2) {
      setError('Add at least two students before generating groups.');
      return;
    }
    setError('');
    setGroups(buildGroups(students, validCriteria, groupCount));
  };

  const handleExportCSV = () => {
    if (groups.length === 0) return;
    const exportRows = groups.flatMap((group) =>
      group.students.map((student) => ({ ...student, Class: group.name }))
    );
    const exportFields = [...fields.filter((field) => field !== 'Class'), 'Class'];
    downloadCSV(exportRows, exportFields);
  };

  const handleExportExcel = () => {
    if (groups.length === 0) return;
    const exportRows = groups.flatMap((group) =>
      group.students.map((student) => ({ ...student, Class: group.name }))
    );
    const exportFields = [...fields.filter((field) => field !== 'Class'), 'Class'];
    downloadExcel(exportRows, exportFields);
  };

  const moveStudentToGroup = (fromGroupName, studentIndex, toGroupName) => {
    if (fromGroupName === toGroupName) return;
    const source = groups.find((group) => group.name === fromGroupName);
    if (!source) return;
    const student = source.students[studentIndex];
    if (!student) return;

    setGroups((currentGroups) =>
      currentGroups.map((group) => {
        if (group.name === fromGroupName) {
          return {
            ...group,
            students: group.students.filter((_, index) => index !== studentIndex),
          };
        }
        if (group.name === toGroupName) {
          return {
            ...group,
            students: [...group.students, student],
          };
        }
        return group;
      })
    );
  };

  const availableGroups = Math.min(GROUP_LIMIT, Math.max(2, students.length));

  return (
    <div className="app-shell">
      <header>
        <h1>Class Roster Generator MVP</h1>
        <p>Import roster data from CSV, Excel, or PDF; add students manually; then group and export.</p>
      </header>

      <section className="card">
        <h2>Roster Source</h2>
        <div className="form-grid">
          <button
            type="button"
            className={mode === 'upload' ? 'primary-button' : ''}
            onClick={() => setMode('upload')}
          >
            Upload file
          </button>
          <button
            type="button"
            className={mode === 'manual' ? 'primary-button' : ''}
            onClick={() => setMode('manual')}
          >
            Manual entry
          </button>
        </div>

        {mode === 'upload' ? (
          <>
            <input type="file" accept=".csv,.xlsx,.xls,.pdf" onChange={handleFileChange} />
            <p className="hint">Upload CSV, Excel, or text-based PDF tables. Headers are required.</p>
          </>
        ) : (
          <>
            <label>
              Manual headers
              <input
                type="text"
                value={manualHeaders}
                onChange={(event) => setManualHeaders(event.target.value)}
                placeholder="Name,Math Score,Reading Score"
              />
            </label>
            <button className="primary-button" type="button" onClick={handleManualHeaderSubmit}>
              Start manual roster
            </button>

            {fields.length > 0 && (
              <div className="card" style={{ marginTop: '1rem' }}>
                <h3>New student row</h3>
                <div className="form-grid">
                  {fields.map((field) => (
                    <label key={field}>
                      {field}
                      <input
                        type="text"
                        value={manualRow[field] ?? ''}
                        onChange={(event) => handleManualRowChange(field, event.target.value)}
                      />
                    </label>
                  ))}
                </div>
                <button className="primary-button" type="button" onClick={handleAddManualRow}>
                  Add student row
                </button>
              </div>
            )}
          </>
        )}
      </section>

      {(students.length > 0 || error) && (
        <section className="card">
          <div className="groups-header">
            <h2>Roster Preview</h2>
            <button type="button" onClick={handleClearRoster}>
              Clear roster
            </button>
          </div>
          {students.length > 0 ? (
            <>
              <p>{students.length} student{students.length === 1 ? '' : 's'} loaded.</p>
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      {fields.map((field) => (
                        <th key={field}>{field}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {students.slice(0, 10).map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {fields.map((field) => (
                          <td key={field}>{row[field]}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {students.length > 10 && <p className="hint">Showing first 10 rows.</p>}
              </div>
            </>
          ) : (
            <p>No roster loaded yet. Upload a file or start manual entry.</p>
          )}
        </section>
      )}

      {students.length > 0 && (
        <section className="card">
          <h2>Grouping Rules</h2>
          <div className="hint">
            Add criteria, select ascending or descending order for each, and assign weights.
          </div>

          {criteria.map((criterion, index) => (
            <div key={index} className="criterion-card">
              <div className="form-grid">
                <label>
                  Field
                  <select
                    value={criterion.field}
                    onChange={(event) => handleCriteriaChange(index, 'field', event.target.value)}
                  >
                    {(numericFields.length > 0 ? numericFields : fields).map((field) => (
                      <option key={field} value={field}>
                        {field}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Direction
                  <select
                    value={criterion.direction}
                    onChange={(event) => handleCriteriaChange(index, 'direction', event.target.value)}
                  >
                    <option value="desc">High values first</option>
                    <option value="asc">Low values first</option>
                  </select>
                </label>

                <label>
                  Weight
                  <input
                    className="small-input"
                    type="number"
                    min="0"
                    step="0.1"
                    value={criterion.weight}
                    onChange={(event) => handleCriteriaChange(index, 'weight', event.target.value)}
                  />
                </label>
              </div>
              <button className="link-button" type="button" onClick={() => handleRemoveCriterion(index)}>
                Remove criterion
              </button>
            </div>
          ))}

          <button type="button" className="primary-button" onClick={handleAddCriterion}>
            Add grouping criterion
          </button>

          <div className="form-grid" style={{ marginTop: '1rem' }}>
            <label>
              Group count
              <input
                type="number"
                min="2"
                max={availableGroups}
                value={groupCount}
                onChange={(event) => setGroupCount(Number(event.target.value))}
              />
            </label>
          </div>

          <button className="primary-button" onClick={handleGenerate}>
            Generate Suggested Classes
          </button>
        </section>
      )}

      {groups.length > 0 && (
        <section className="card">
          <div className="groups-header">
            <h2>Suggested Classes</h2>
            <div className="export-row">
              <button onClick={handleExportCSV}>Export CSV</button>
              <button onClick={handleExportExcel}>Export Excel</button>
            </div>
          </div>
          <div className="groups-grid">
            {groups.map((group) => (
              <div key={group.name} className="group-card">
                <h3>{group.name}</h3>
                <p>{group.students.length} students</p>
                <ul>
                  {group.students.map((student, index) => (
                    <li key={index} className="student-row">
                      <span>{student[fields[0]] || `Student ${index + 1}`}</span>
                      <select
                        value={group.name}
                        onChange={(event) => moveStudentToGroup(group.name, index, event.target.value)}
                      >
                        {groups.map((target) => (
                          <option key={target.name} value={target.name}>
                            {target.name}
                          </option>
                        ))}
                      </select>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      {error && <div className="error-banner">{error}</div>}
    </div>
  );
}
