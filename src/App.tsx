import React, { useRef, useState } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import { availableFields as allAvailableFields } from './availableFields';

// Helper: Build a tree from a list of fields (which all start with baseKey + ".")
function buildTree(baseKey: string, fields: string[]): Record<string, any> {
  const tree: Record<string, any> = {};
  fields.forEach(field => {
    // Remove the baseKey plus the following dot
    const remainder = field.substring(baseKey.length + 1);
    const parts = remainder.split('.');
    let node = tree;
    parts.forEach((part) => {
      if (!node[part]) {
        node[part] = {};
      }
      node = node[part];
    });
  });
  return tree;
}

// Helper: Convert the tree into a snippet string using recursion.
// `prefix` is the full key up to this level; `indent` is the current indent string.
function treeToSnippet(prefix: string, tree: Record<string, any>, indent: string): string {
  let snippet = "";
  for (const key in tree) {
    const fullField = `${prefix}.${key}`;
    if (Object.keys(tree[key]).length === 0) {
      // Leaf: output as a key/value pair.
      snippet += `${indent}"${key}": "${fullField}",\n`;
    } else {
      snippet += `${indent}"${key}": {\n`;
      snippet += treeToSnippet(fullField, tree[key], indent + "  ");
      snippet += `${indent}},\n`;
    }
  }
  return snippet;
}

const App: React.FC = () => {
  // State for which APIs are selected (default: all selected)
  const [selectedApis, setSelectedApis] = useState<string[]>(Object.keys(allAvailableFields));
  // State for the search query in the left panel
  const [searchQuery, setSearchQuery] = useState<string>('');
  // State for fields that have been added to the JSON mapping
  const [addedFields, setAddedFields] = useState<string[]>([]);
  // State to control visibility (expanded/collapsed) for each API group
  const initialVisibility = Object.keys(allAvailableFields).reduce((acc, api) => {
    acc[api] = true;
    return acc;
  }, {} as Record<string, boolean>);
  const [apiVisibility, setApiVisibility] = useState<Record<string, boolean>>(initialVisibility);

  // Refs for the Monaco editor and instance
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);

  // Called when the editor mounts
  const handleEditorDidMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    // Set initial value with proper formatting.
    editor.setValue('{\n  \n}');
    // Position cursor after the opening bracket.
    editor.setPosition({ lineNumber: 2, column: 3 });
  };

  // Update addedFields based on current JSON keys when editor changes.
  const handleEditorChange = (value?: string) => {
    if (!value) return;
    try {
      const parsed = JSON.parse(value);
      // For structured objects, also mark all nested keys as added.
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
      // If JSON is invalid, do nothing.
    }
  };

  // Determines the correct indent. If the editor is in its initial state, returns "".
  const getCurrentIndent = (): string => {
    const position = editorRef.current.getPosition();
    if (!position) return '  ';
    // If at the initial position, remove the extra indent.
    if (position.lineNumber === 2 && position.column === 3) {
      return "";
    }
    const currentLine = editorRef.current.getModel()?.getLineContent(position.lineNumber) || '';
    const indentMatch = currentLine.match(/^\s*/);
    return indentMatch ? indentMatch[0] : '  ';
  };

  // Inserts a single field snippet at the current cursor position.
  const handleFieldClick = (field: string) => {
    if (!editorRef.current || !monacoRef.current) return;
    if (addedFields.includes(field)) return; // prevent duplicate

    const position = editorRef.current.getPosition();
    if (!position) return;

    const currentIndent = getCurrentIndent();
    const snippet = `"${field}": "${field}",\n${currentIndent}`;

    const range = new monacoRef.current.Range(
      position.lineNumber,
      position.column,
      position.lineNumber,
      position.column
    );

    editorRef.current.executeEdits(null, [{
      range,
      text: snippet,
      forceMoveMarkers: true,
    }]);

    editorRef.current.focus();
    setAddedFields(prev => [...prev, field]);
  };

  // Handler to add a base object in flattened mode.
  const handleAddBaseObjectFlatten = (baseKey: string, api: string) => {
    if (!editorRef.current || !monacoRef.current) return;
    const groupFields = allAvailableFields[api];
    const subfields = groupFields.filter(f => f.startsWith(`${baseKey}.`));
    if (subfields.length === 0) return;
    const currentIndent = getCurrentIndent();
    let snippet = "";
    subfields.forEach(field => {
      snippet += `${currentIndent}"${field}": "${field}",\n`;
    });
    const range = new monacoRef.current.Range(
      editorRef.current.getPosition().lineNumber,
      editorRef.current.getPosition().column,
      editorRef.current.getPosition().lineNumber,
      editorRef.current.getPosition().column
    );
    editorRef.current.executeEdits(null, [{
      range,
      text: snippet,
      forceMoveMarkers: true,
    }]);
    editorRef.current.focus();
    // Mark all subfields as added.
    setAddedFields(prev => [...prev, ...subfields]);
  };

  // Handler to add a base object with nested structure (recursively).
  const handleAddBaseObjectStructured = (baseKey: string, api: string) => {
    if (!editorRef.current || !monacoRef.current) return;
    const groupFields = allAvailableFields[api];
    const subfields = groupFields.filter(f => f.startsWith(`${baseKey}.`));
    if (subfields.length === 0) return;
    const currentIndent = getCurrentIndent();

    // Build a tree from the subfields.
    const tree = buildTree(baseKey, subfields);
    // Build a snippet recursively.
    const structuredContent = treeToSnippet(baseKey, tree, currentIndent + "  ");
    const snippet = `${currentIndent}"${baseKey}": {\n${structuredContent}${currentIndent}},\n${currentIndent}`;

    const range = new monacoRef.current.Range(
      editorRef.current.getPosition().lineNumber,
      editorRef.current.getPosition().column,
      editorRef.current.getPosition().lineNumber,
      editorRef.current.getPosition().column
    );
    editorRef.current.executeEdits(null, [{
      range,
      text: snippet,
      forceMoveMarkers: true,
    }]);
    editorRef.current.focus();
    // Mark the baseKey and all its subfields as added.
    setAddedFields(prev => [...prev, baseKey, ...subfields]);
  };

  // Formats the JSON in the editor with an indent of 2.
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

  // Clears the JSON editor back to the initial state.
  const handleClearJSON = () => {
    if (!editorRef.current) return;
    editorRef.current.setValue('{\n  \n}');
    editorRef.current.setPosition({ lineNumber: 2, column: 3 });
    setAddedFields([]);
  };

  // Toggles the selection of an API checkbox.
  const handleToggleApi = (api: string) => {
    setSelectedApis(prev =>
      prev.includes(api) ? prev.filter(item => item !== api) : [...prev, api]
    );
  };

  // Clears the search query.
  const handleClearSearch = () => {
    setSearchQuery('');
  };

  // Toggle the visibility (collapse/expand) of an API group.
  const toggleApiVisibility = (api: string) => {
    setApiVisibility(prev => ({ ...prev, [api]: !prev[api] }));
  };

  // Skeleton function for submitting the JSON to an API.
  const handleSubmit = async () => {
    if (!editorRef.current) return;
    const jsonData = editorRef.current.getValue();
    try {
      const parsed = JSON.parse(jsonData);
      // Replace 'YOUR_API_URL' with your actual API endpoint.
      const response = await fetch('YOUR_API_URL', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
      });
      const data = await response.json();
      console.log('API Response:', data);
    } catch (error) {
      console.error('Error submitting JSON:', error);
    }
  };

  return (
    <div style={styles.appContainer}>
      {/* Top Bar: "Available APIs" label and API Checkboxes */}
      <div style={styles.topBar}>
        <span style={styles.topBarLabel}>Available APIs</span>
        {Object.keys(allAvailableFields).map(api => (
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
        {/* Left Panel: Search Bar and Fields Grouped by API */}
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
            const groupFields = allAvailableFields[api];
            // Filter fields based on search and not already added.
            const filteredFields = groupFields.filter(field =>
              field.toLowerCase().includes(searchQuery.toLowerCase()) &&
              !addedFields.includes(field)
            );
            if (filteredFields.length === 0) return null;
            return (
              <div key={api} style={styles.apiGroup}>
                <div style={styles.apiHeaderRow}>
                  <div style={styles.apiHeaderWithToggle}>
                    <span 
                      style={styles.toggleIcon}
                      onClick={() => toggleApiVisibility(api)}
                    >
                      {apiVisibility[api] ? "▼" : "►"}
                    </span>
                    <h4 style={styles.apiHeader}>{api}</h4>
                  </div>
                  <button style={styles.selectAllButton} onClick={() => {
                    groupFields.forEach(field => {
                      if (!addedFields.includes(field)) {
                        handleFieldClick(field);
                      }
                    });
                  }}>
                    Select All
                  </button>
                </div>
                {apiVisibility[api] && (
                  <ul style={styles.fieldList}>
                    {filteredFields.map((field, index) => {
                      // A field is considered a base object if there is at least one other field in the group starting with "field."
                      const isBaseObject = groupFields.some(sub => sub.startsWith(`${field}.`));
                      return (
                        <li 
                          key={`${field}-${index}`} 
                          style={styles.fieldItem}
                          onClick={() => { if (!isBaseObject) handleFieldClick(field); }}
                        >
                          <span>{field}</span>
                          {isBaseObject && (
                            <div style={styles.baseObjectButtons}>
                              <button
                                style={styles.smallButton}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleAddBaseObjectFlatten(field, api);
                                }}
                              >
                                Flatten &amp; Add
                              </button>
                              <button
                                style={styles.smallButton}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleAddBaseObjectStructured(field, api);
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

        {/* Right Panel: Instructions, JSON Editor, and Buttons */}
        <div style={styles.rightPanel}>
          <div style={styles.instructions}>
            Select the fields on the left that you would like to query, and specify your output schema.
            When you're ready to fetch the fields, click Submit!
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
          <div style={styles.buttonBar}>
            <button style={styles.clearButton} onClick={handleClearJSON}>
              Clear
            </button>
            <button style={styles.formatButton} onClick={handleFormatJSON}>
              Format JSON
            </button>
            <button style={styles.submitButton} onClick={handleSubmit}>
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
    color: '#007bff',
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
    height: '500px',
    border: '1px solid #ccc',
    borderRadius: '4px',
    overflow: 'hidden',
    marginBottom: '10px',
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
