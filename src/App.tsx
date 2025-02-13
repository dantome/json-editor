import React, { useRef, useState, ChangeEvent } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import { availableFields } from './availableFields';

// Helper: Build a tree from a list of fields (all starting with baseKey + ".")
function buildTree(baseKey: string, fields: string[]): Record<string, any> {
  const tree: Record<string, any> = {};
  fields.forEach(field => {
    const remainder = field.substring(baseKey.length + 1); // remove baseKey + "."
    const parts = remainder.split('.');
    let node = tree;
    parts.forEach(part => {
      if (!node[part]) {
        node[part] = {};
      }
      node = node[part];
    });
  });
  return tree;
}

// Helper: Convert the tree into a snippet string using recursion.
// Pass the API so that each leaf's value is prefixed.
function treeToSnippet(prefix: string, tree: Record<string, any>, indent: string, api: string): string {
  let snippet = "";
  for (const key in tree) {
    const newPrefix = `${prefix}.${key}`;
    if (Object.keys(tree[key]).length === 0) {
      snippet += `${indent}"${key}": "${api}.${newPrefix}",\n`;
    } else {
      snippet += `${indent}"${key}": {\n`;
      snippet += treeToSnippet(newPrefix, tree[key], indent + "  ", api);
      snippet += `${indent}},\n`;
    }
  }
  return snippet;
}

const App: React.FC = () => {
  // State for selected APIs (default: all selected)
  const [selectedApis, setSelectedApis] = useState<string[]>(Object.keys(availableFields));
  // State for search query in the left panel
  const [searchQuery, setSearchQuery] = useState<string>('');
  // State for fields already added (to prevent duplicates)
  const [addedFields, setAddedFields] = useState<string[]>([]);
  // State to control collapse/expand for each API group
  const initialVisibility = Object.keys(availableFields).reduce((acc, api) => {
    acc[api] = true;
    return acc;
  }, {} as Record<string, boolean>);
  const [apiVisibility, setApiVisibility] = useState<Record<string, boolean>>(initialVisibility);
  // Store the current JSON editor content (the schema)
  const [editorContent, setEditorContent] = useState<string>('{\n  \n}');
  // NEW: Global state for required inputs (merged across APIs)
  const [globalInputs, setGlobalInputs] = useState<Record<string, string>>({});
  // NEW: State to track if the JSON in the editor is valid
  const [isJsonValid, setIsJsonValid] = useState<boolean>(true);

  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);

  const handleEditorDidMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    editor.setValue('{\n  \n}');
    editor.setPosition({ lineNumber: 2, column: 3 });
  };

  // Update addedFields and store editor content when changes occur.
  const handleEditorChange = (value?: string) => {
    if (!value) return;
    setEditorContent(value);
    try {
      const parsed = JSON.parse(value);
      setIsJsonValid(true);
      const extractKeys = (obj: any, prefix = ""): string[] => {
        let keys: string[] = [];
        for (const key in obj) {
          const fullKey = prefix ? `${prefix}.${key}` : key;
          if (typeof obj[key] === "object" && obj[key] !== null) {
            keys.push(fullKey);
            keys = keys.concat(extractKeys(obj[key], fullKey));
          } else {
            keys.push(fullKey);
          }
        }
        return keys;
      };
      const keys = extractKeys(parsed);
      setAddedFields(keys);
    } catch (error) {
      setIsJsonValid(false);
      // When JSON is invalid, we don't update the addedFields.
    }
  };

  // Returns the indent for the current cursor line.
  const getCurrentIndent = (): string => {
    const position = editorRef.current.getPosition();
    if (!position) return '  ';
    if (position.lineNumber === 2 && position.column === 3) {
      return "";
    }
    const currentLine = editorRef.current.getModel()?.getLineContent(position.lineNumber) || '';
    const match = currentLine.match(/^\s*/);
    return match ? match[0] : '  ';
  };

  // Formats the JSON in the editor with 2-space indent.
  const handleFormatJSON = () => {
    if (!editorRef.current) return;
    const value = editorRef.current.getValue();
    try {
      const parsed = JSON.parse(value);
      const formatted = JSON.stringify(parsed, null, 2);
      editorRef.current.setValue(formatted);
    } catch (error) {
      alert("Invalid JSON. Please fix the errors before formatting.");
    }
  };

  // --- Insertion Handlers (all now include the API name) ---

  // Inserts a simple field.
  const handleFieldClick = (api: string, field: string) => {
    if (!editorRef.current || !monacoRef.current) return;
    if (addedFields.includes(field)) return;
    const position = editorRef.current.getPosition();
    if (!position) return;
    const currentIndent = getCurrentIndent();
    const snippet = `${currentIndent}"${field}": "${api}.${field}",\n${currentIndent}`;
    const range = new monacoRef.current.Range(
      position.lineNumber,
      position.column,
      position.lineNumber,
      position.column
    );
    editorRef.current.executeEdits(null, [{ range, text: snippet, forceMoveMarkers: true }]);
    editorRef.current.focus();
    setAddedFields(prev => [...prev, field]);
  };

  // Inserts a base object in flattened mode.
  const handleAddBaseObjectFlatten = (api: string, baseKey: string) => {
    if (!editorRef.current || !monacoRef.current) return;
    const groupFields = availableFields[api].outputFields;
    const subfields = groupFields.filter(f =>
      f.startsWith(`${baseKey}.`) && !groupFields.some(other => other.startsWith(`${f}.`))
    );
    if (subfields.length === 0) return;
    const currentIndent = getCurrentIndent();
    let snippet = "";
    subfields.forEach(field => {
      snippet += `${currentIndent}"${field}": "${api}.${field}",\n${currentIndent}`;
    });
    const pos = editorRef.current.getPosition();
    if (!pos) return;
    const range = new monacoRef.current.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column);
    editorRef.current.executeEdits(null, [{ range, text: snippet, forceMoveMarkers: true }]);
    editorRef.current.focus();
    setAddedFields(prev => [...prev, ...subfields]);
  };

  // Inserts a base object with nested structure.
  const handleAddBaseObjectStructured = (api: string, baseKey: string) => {
    if (!editorRef.current || !monacoRef.current) return;
    const groupFields = availableFields[api].outputFields;
    const subfields = groupFields.filter(f => f.startsWith(`${baseKey}.`));
    if (subfields.length === 0) return;
    const currentIndent = getCurrentIndent();
    const nestedIndent = currentIndent + "  ";
    const tree = buildTree(baseKey, subfields);
    const structuredContent = treeToSnippet(baseKey, tree, nestedIndent, api);
    const snippet = `${currentIndent}"${baseKey}": {\n${structuredContent}${currentIndent}},\n${currentIndent}`;
    const pos = editorRef.current.getPosition();
    if (!pos) return;
    const range = new monacoRef.current.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column);
    editorRef.current.executeEdits(null, [{ range, text: snippet, forceMoveMarkers: true }]);
    editorRef.current.focus();
    setAddedFields(prev => [...prev, baseKey, ...subfields]);
  };

  // --- End of Insertion Handlers ---

  // Clears the JSON editor.
  const handleClearJSON = () => {
    if (!editorRef.current) return;
    editorRef.current.setValue('{\n  \n}');
    editorRef.current.setPosition({ lineNumber: 2, column: 3 });
    setAddedFields([]);
  };

  // Toggle API checkbox selection.
  const handleToggleApi = (api: string) => {
    setSelectedApis(prev =>
      prev.includes(api) ? prev.filter(item => item !== api) : [...prev, api]
    );
  };

  // Clears the search box.
  const handleClearSearch = () => {
    setSearchQuery('');
  };

  // Toggle collapse/expand for an API group.
  const toggleApiVisibility = (api: string) => {
    setApiVisibility(prev => ({ ...prev, [api]: !prev[api] }));
  };

  // --- Required Fields UI and Submission ---

  // Determine which APIs are used in the schema (if "api." appears in the editor content).
  const usedApis = Object.keys(availableFields).filter(api => editorContent.includes(api + "."));

  // NEW: Compute the unique required fields across all used APIs
  const uniqueRequiredFields: string[] = Array.from(
    new Set(usedApis.flatMap(api => availableFields[api].requiredFields))
  );

  // NEW: Global change handler for required field inputs.
  const handleInputChange = (field: string, e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setGlobalInputs(prev => ({ ...prev, [field]: value }));
  };

  // Check if every required field (merged across all used APIs) is non-empty.
  const allRequiredFilled = uniqueRequiredFields.every(field => 
    globalInputs[field] && globalInputs[field].trim() !== ""
  );

  // On submit, combine the JSON schema from the editor with the global required inputs.
  const handleSubmit = async () => {
    if (!editorRef.current) return;
    try {
      const schema = JSON.parse(editorRef.current.getValue());
      const payload = {
        schema,
        apis: {} as Record<string, { inputs: Record<string, string> }>
      };
      usedApis.forEach(api => {
        const required = availableFields[api].requiredFields;
        payload.apis[api] = {
          inputs: {}
        };
        required.forEach(field => {
          // Use the same global input for all APIs that require this field.
          payload.apis[api].inputs[field] = globalInputs[field] || "";
        });
      });
      console.log('Payload to submit:', payload);
      // Uncomment and update below to send to your backend.
      // const response = await fetch('YOUR_API_URL', {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify(payload),
      // });
      // const data = await response.json();
      // console.log('API Response:', data);
    } catch (error) {
      console.error('Error submitting JSON:', error);
    }
  };

  return (
    <div style={styles.appContainer}>
      {/* Top Bar with API selection */}
      <div style={styles.topBar}>
        <span style={styles.topBarLabel}>Available APIs</span>
        {Object.keys(availableFields).map(api => (
          <label key={api} style={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={selectedApis.includes(api)}
              onChange={() => handleToggleApi(api)}
            />
            {api}
          </label>
        ))}
      </div>

      <div style={styles.mainContainer}>
        {/* Left Panel: Search and Field Selector */}
        <div style={styles.leftPanel}>
          <div style={styles.searchContainer}>
            <input
              type="text"
              placeholder="Search fields..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={styles.searchBar}
            />
            {searchQuery && (
              <button style={styles.clearSearchButton} onClick={handleClearSearch}>
                ×
              </button>
            )}
          </div>
          {selectedApis.map(api => {
            const apiData = availableFields[api];
            const groupFields = apiData.outputFields;
            const filteredFields = groupFields.filter(field =>
              field.toLowerCase().includes(searchQuery.toLowerCase()) &&
              !addedFields.includes(field)
            );
            if (filteredFields.length === 0) return null;
            return (
              <div key={api} style={styles.apiGroup}>
                <div style={styles.apiHeaderRow}>
                  <div style={styles.apiHeaderWithToggle}>
                    <span style={styles.toggleIcon} onClick={() => toggleApiVisibility(api)}>
                      {apiVisibility[api] ? "▼" : "►"}
                    </span>
                    <h4 style={styles.apiHeader}>{api}</h4>
                  </div>
                  <button
                    style={styles.selectAllButton}
                    onClick={(e) => {
                      e.stopPropagation();
                      filteredFields.forEach(field => {
                        handleFieldClick(api, field);
                      });
                    }}
                  >
                    Select All
                  </button>
                </div>
                {/* Required Inputs line for this API */}
                <div style={styles.apiRequiredFieldsContainer}>
                  <span style={styles.apiRequiredFieldsTitle}>Required Input(s): </span>
                  <span style={styles.apiRequiredFieldsList}>
                    {apiData.requiredFields.join(', ')}
                  </span>
                </div>
                {apiVisibility[api] && (
                  <ul style={styles.fieldList}>
                    {filteredFields.map((field, index) => {
                      const isBaseObject = groupFields.some(sub => sub.startsWith(`${field}.`));
                      return (
                        <li
                          key={`${field}-${index}`}
                          style={styles.fieldItem}
                          onClick={() => { if (!isBaseObject) handleFieldClick(api, field); }}
                        >
                          <span>{field}</span>
                          {isBaseObject && (
                            <div style={styles.baseObjectButtons}>
                              <button
                                style={styles.smallButton}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleAddBaseObjectFlatten(api, field);
                                }}
                              >
                                Flatten &amp; Add
                              </button>
                              <button
                                style={styles.smallButton}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleAddBaseObjectStructured(api, field);
                                }}
                              >
                                Add w/ Structure
                              </button>
                            </div>
                          )}
                          {!isBaseObject && (
                            <span style={styles.arrow}>→</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>

        {/* Right Panel: Editor and Required Fields Inputs */}
        <div style={styles.rightPanel}>
          <div style={styles.instructions}>
            Select the fields on the left to build your output schema.
          </div>
          <div style={styles.editorContainer}>
            <Editor
              height="100%"
              defaultLanguage="json"
              defaultValue="{}"
              onMount={handleEditorDidMount}
              onChange={handleEditorChange}
              options={{
                automaticLayout: true,
                tabSize: 2,
              }}
            />
          </div>
          {/* --- Merged Required Fields Inputs --- */}
          <div style={styles.requiredInputsContainer}>
            <h4 style={styles.requiredInputsTitle}>API Required Inputs</h4>
            {uniqueRequiredFields.length === 0 ? (
              <p style={{ margin: 0 }}>No API inputs required (no API prefix found in schema yet).</p>
            ) : (
              uniqueRequiredFields.map(field => (
                <div key={field} style={styles.requiredFieldRow}>
                  <label style={styles.requiredFieldLabel}>{field}:</label>
                  <input
                    type="text"
                    value={globalInputs[field] || ''}
                    onChange={(e) => handleInputChange(field, e)}
                    style={styles.requiredFieldInput}
                  />
                </div>
              ))
            )}
          </div>
          <div style={styles.buttonBar}>
            <button style={styles.clearButton} onClick={handleClearJSON}>Clear</button>
            <button style={styles.formatButton} onClick={handleFormatJSON}>Format JSON</button>
            <button
              style={{ 
                ...styles.submitButton, 
                opacity: (allRequiredFilled && isJsonValid) ? 1 : 0.5, 
                cursor: (allRequiredFilled && isJsonValid) ? 'pointer' : 'not-allowed' 
              }}
              onClick={handleSubmit}
              disabled={!(allRequiredFilled && isJsonValid)}
            >
              Submit
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const styles: { [key: string]: React.CSSProperties } = {
  appContainer: {
    margin: 0, // remove any outer margin/padding
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    fontFamily: 'Arial, sans-serif',
    backgroundColor: '#f0f2f5',
  },
  topBar: {
    padding: '10px 20px',
    borderBottom: '1px solid #ccc',
    backgroundColor: '#fff',
    display: 'flex',
    alignItems: 'center',
    gap: '20px',
  },
  topBarLabel: {
    fontWeight: 'bold',
    fontSize: '16px',
    marginRight: '20px',
  },
  checkboxLabel: {
    fontSize: '14px',
    color: '#333',
  },
  mainContainer: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
  },
  leftPanel: {
    width: '30%',
    borderRight: '1px solid #ccc',
    padding: '1rem',
    overflowY: 'auto',
    backgroundColor: '#fff',
    boxShadow: '2px 0 5px rgba(0,0,0,0.1)',
  },
  searchContainer: {
    position: 'relative',
    marginBottom: '10px',
  },
  searchBar: {
    width: '100%',
    padding: '10px 40px 10px 15px',
    border: '1px solid #ccc',
    borderRadius: '4px',
    fontSize: '16px',
    boxSizing: 'border-box',
  },
  clearSearchButton: {
    position: 'absolute',
    right: '10px',
    top: '50%',
    transform: 'translateY(-50%)',
    border: 'none',
    background: 'transparent',
    fontSize: '18px',
    cursor: 'pointer',
    color: '#888',
  },
  apiGroup: {
    marginBottom: '20px',
  },
  apiHeaderRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '5px',
  },
  apiHeaderWithToggle: {
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
  },
  toggleIcon: {
    cursor: 'pointer',
    fontSize: '16px',
    color: '#000',
  },
  apiHeader: {
    fontSize: '16px',
    fontWeight: 'bold',
    color: '#444',
    margin: 0,
  },
  selectAllButton: {
    backgroundColor: '#007bff',
    color: '#fff',
    border: 'none',
    padding: '5px 10px',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '12px',
  },
  fieldList: {
    listStyleType: 'none',
    padding: 0,
    margin: 0,
  },
  fieldItem: {
    padding: '0.5rem',
    cursor: 'pointer',
    borderBottom: '1px solid #eee',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: '14px',
    transition: 'background-color 0.2s',
  },
  baseObjectButtons: {
    display: 'flex',
    gap: '5px',
  },
  smallButton: {
    fontSize: '12px',
    padding: '2px 6px',
    borderRadius: '4px',
    border: 'none',
    cursor: 'pointer',
    backgroundColor: '#007bff',
    color: '#fff',
  },
  arrow: {
    marginLeft: '10px',
    color: '#888',
  },
  apiRequiredFieldsContainer: {
    marginTop: '5px',
    marginBottom: '10px',
  },
  apiRequiredFieldsTitle: {
    fontWeight: 'bold',
    fontSize: '14px',
    marginRight: '4px',
  },
  apiRequiredFieldsList: {
    fontSize: '14px',
    color: '#555',
  },
  rightPanel: {
    width: '70%',
    display: 'flex',
    flexDirection: 'column',
    padding: '1rem',
    backgroundColor: '#fff',
    boxShadow: '-2px 0 5px rgba(0,0,0,0.1)',
  },
  instructions: {
    marginBottom: '10px',
    padding: '10px',
    backgroundColor: '#eef',
    border: '1px solid #ccd',
    borderRadius: '4px',
    fontSize: '14px',
    color: '#333',
  },
  editorContainer: {
    flex: 1,
    border: '1px solid #ccc',
    borderRadius: '4px',
    overflow: 'hidden',
    marginBottom: '10px',
  },
  requiredInputsContainer: {
    padding: '1rem',
    border: '1px solid #ccc',
    borderRadius: '4px',
    marginBottom: '10px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  requiredInputsTitle: {
    margin: '0 0 8px 0',
    fontSize: '16px',
    fontWeight: 'bold',
  },
  requiredFieldRow: {
    display: 'flex',
    alignItems: 'center',
  },
  requiredFieldLabel: {
    width: '150px',
    marginRight: '12px',
    fontWeight: 'bold',
  },
  requiredFieldInput: {
    width: '60%',
    padding: '4px',
    fontSize: '14px',
  },
  buttonBar: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '10px',
  },
  clearButton: {
    backgroundColor: 'red',
    color: '#fff',
    border: 'none',
    padding: '10px 20px',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '16px',
  },
  formatButton: {
    backgroundColor: '#000',
    color: '#fff',
    border: 'none',
    padding: '10px 20px',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '16px',
  },
  submitButton: {
    backgroundColor: '#000',
    color: '#fff',
    border: 'none',
    padding: '10px 20px',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '16px',
  },
};

export default App;
