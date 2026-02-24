import { Check, AlertCircle, X, Upload } from 'lucide-react';
import { useState } from 'react';

export function DataIngestionWizard() {
  const [currentStep] = useState(2); // Starting at Validate step for demo
  const [hoveredError, setHoveredError] = useState<{ row: number; col: number } | null>(null);

  const steps = [
    { id: 1, name: 'Upload', completed: true },
    { id: 2, name: 'Validate', completed: false },
    { id: 3, name: 'Map Columns', completed: false },
    { id: 4, name: 'Finish', completed: false },
  ];

  // Mock data with some errors
  const tableData = [
    { id: 1, date: '2024-01-15 08:00', pm25: '35.2', pm10: '52.1', stationId: 'QTO-001', temp: '18.5' },
    { id: 2, date: '2024-01-15 09:00', pm25: 'NaN', pm10: '61.3', stationId: 'QTO-001', temp: '19.2', error: { col: 'pm25' } },
    { id: 3, date: '2024-01-15 10:00', pm25: '38.7', pm10: '55.8', stationId: 'QTO-001', temp: '20.1' },
    { id: 4, date: 'Invalid Date', pm25: '45.3', pm10: '68.2', stationId: 'QTO-001', temp: '21.0', error: { col: 'date' } },
    { id: 5, date: '2024-01-15 12:00', pm25: '39.1', pm10: 'text', stationId: 'QTO-001', temp: '21.8', error: { col: 'pm10' } },
    { id: 6, date: '2024-01-15 13:00', pm25: '36.5', pm10: '53.4', stationId: 'QTO-001', temp: '22.3' },
    { id: 7, date: '2024-01-15 14:00', pm25: '41.2', pm10: '62.7', stationId: 'QTO-001', temp: '22.9' },
    { id: 8, date: '2024-01-15 15:00', pm25: '37.8', pm10: '54.1', stationId: 'QTO-001', temp: '22.5' },
  ];

  const columnMappings = [
    { name: 'date', type: 'Timestamp', ignore: false },
    { name: 'pm25', type: 'Float', ignore: false },
    { name: 'pm10', type: 'Float', ignore: false },
    { name: 'stationId', type: 'String', ignore: false },
    { name: 'temp', type: 'Float', ignore: false },
  ];

  const [mappings, setMappings] = useState(columnMappings);

  const getErrorMessage = (row: any, col: string) => {
    if (col === 'pm25' && row.pm25 === 'NaN') {
      return 'Invalid Format: Expected Float';
    }
    if (col === 'date' && row.date === 'Invalid Date') {
      return 'Invalid Format: Expected Timestamp';
    }
    if (col === 'pm10' && row.pm10 === 'text') {
      return 'Invalid Format: Expected Float';
    }
    return null;
  };

  return (
    <div className="p-8 h-full flex flex-col">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-foreground">Data Ingestion & Validation</h1>
        <p className="text-muted-foreground mt-1">Upload and validate your environmental data</p>
      </div>

      {/* Progress Stepper */}
      <div className="mb-6">
        <div className="flex items-center justify-center">
          {steps.map((step, index) => (
            <div key={step.id} className="flex items-center">
              <div className="flex flex-col items-center">
                <div
                  className={`
                    w-10 h-10 rounded-full flex items-center justify-center border-2 transition-colors
                    ${step.completed
                      ? 'bg-primary border-primary'
                      : currentStep === step.id
                      ? 'border-primary bg-primary/10'
                      : 'border-border bg-card'
                    }
                  `}
                >
                  {step.completed ? (
                    <Check className="w-5 h-5 text-primary-foreground" />
                  ) : (
                    <span
                      className={`text-sm ${
                        currentStep === step.id ? 'text-primary font-semibold' : 'text-muted-foreground'
                      }`}
                    >
                      {step.id}
                    </span>
                  )}
                </div>
                <span className="text-xs mt-2 text-muted-foreground">{step.name}</span>
              </div>
              {index < steps.length - 1 && (
                <div
                  className={`w-24 h-0.5 mb-6 mx-4 ${
                    step.completed ? 'bg-primary' : 'bg-border'
                  }`}
                ></div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex gap-6 overflow-hidden">
        {/* Data Preview Grid */}
        <div className="flex-1 bg-card border border-border rounded-lg p-6 overflow-hidden flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-foreground">Data Preview</h2>
            <div className="flex items-center gap-2 text-sm">
              <AlertCircle className="w-4 h-4 text-destructive" />
              <span className="text-destructive">3 errors detected</span>
            </div>
          </div>

          {/* Spreadsheet Grid */}
          <div className="flex-1 overflow-auto border border-border rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-secondary sticky top-0">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-foreground border-b border-border">#</th>
                  <th className="px-4 py-3 text-left font-semibold text-foreground border-b border-border">Date</th>
                  <th className="px-4 py-3 text-left font-semibold text-foreground border-b border-border">PM2.5</th>
                  <th className="px-4 py-3 text-left font-semibold text-foreground border-b border-border">PM10</th>
                  <th className="px-4 py-3 text-left font-semibold text-foreground border-b border-border">Station ID</th>
                  <th className="px-4 py-3 text-left font-semibold text-foreground border-b border-border">Temp</th>
                </tr>
              </thead>
              <tbody>
                {tableData.map((row) => (
                  <tr key={row.id} className="hover:bg-secondary/50">
                    <td className="px-4 py-2 border-b border-border text-muted-foreground">{row.id}</td>
                    <td
                      className={`px-4 py-2 border-b border-border relative ${
                        getErrorMessage(row, 'date') ? 'bg-red-50' : ''
                      }`}
                      onMouseEnter={() => getErrorMessage(row, 'date') && setHoveredError({ row: row.id, col: 0 })}
                      onMouseLeave={() => setHoveredError(null)}
                    >
                      {row.date}
                      {hoveredError?.row === row.id && hoveredError?.col === 0 && (
                        <div className="absolute z-10 bottom-full left-0 mb-2 px-3 py-2 bg-foreground text-background text-xs rounded-lg whitespace-nowrap shadow-lg">
                          <div className="flex items-center gap-2">
                            <AlertCircle className="w-3 h-3" />
                            {getErrorMessage(row, 'date')}
                          </div>
                          <div className="absolute top-full left-4 border-4 border-transparent border-t-foreground"></div>
                        </div>
                      )}
                    </td>
                    <td
                      className={`px-4 py-2 border-b border-border relative ${
                        getErrorMessage(row, 'pm25') ? 'bg-red-50' : ''
                      }`}
                      onMouseEnter={() => getErrorMessage(row, 'pm25') && setHoveredError({ row: row.id, col: 1 })}
                      onMouseLeave={() => setHoveredError(null)}
                    >
                      {row.pm25}
                      {hoveredError?.row === row.id && hoveredError?.col === 1 && (
                        <div className="absolute z-10 bottom-full left-0 mb-2 px-3 py-2 bg-foreground text-background text-xs rounded-lg whitespace-nowrap shadow-lg">
                          <div className="flex items-center gap-2">
                            <AlertCircle className="w-3 h-3" />
                            {getErrorMessage(row, 'pm25')}
                          </div>
                          <div className="absolute top-full left-4 border-4 border-transparent border-t-foreground"></div>
                        </div>
                      )}
                    </td>
                    <td
                      className={`px-4 py-2 border-b border-border relative ${
                        getErrorMessage(row, 'pm10') ? 'bg-red-50' : ''
                      }`}
                      onMouseEnter={() => getErrorMessage(row, 'pm10') && setHoveredError({ row: row.id, col: 2 })}
                      onMouseLeave={() => setHoveredError(null)}
                    >
                      {row.pm10}
                      {hoveredError?.row === row.id && hoveredError?.col === 2 && (
                        <div className="absolute z-10 bottom-full left-0 mb-2 px-3 py-2 bg-foreground text-background text-xs rounded-lg whitespace-nowrap shadow-lg">
                          <div className="flex items-center gap-2">
                            <AlertCircle className="w-3 h-3" />
                            {getErrorMessage(row, 'pm10')}
                          </div>
                          <div className="absolute top-full left-4 border-4 border-transparent border-t-foreground"></div>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2 border-b border-border">{row.stationId}</td>
                    <td className="px-4 py-2 border-b border-border">{row.temp}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Column Mapping Sidebar */}
        <div className="w-80 bg-card border border-border rounded-lg p-6 overflow-y-auto">
          <h2 className="font-semibold text-foreground mb-4">Variable Identification</h2>
          <p className="text-xs text-muted-foreground mb-4">
            Configure column data types and mappings
          </p>

          <div className="space-y-4">
            {mappings.map((mapping, index) => (
              <div key={mapping.name} className="pb-4 border-b border-border last:border-b-0">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-foreground">{mapping.name}</label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <span className="text-xs text-muted-foreground">Ignore</span>
                    <div className="relative">
                      <input
                        type="checkbox"
                        checked={mapping.ignore}
                        onChange={(e) => {
                          const newMappings = [...mappings];
                          newMappings[index].ignore = e.target.checked;
                          setMappings(newMappings);
                        }}
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-secondary rounded-full peer peer-checked:bg-primary transition-colors"></div>
                      <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-card rounded-full transition-transform peer-checked:translate-x-4 shadow-sm"></div>
                    </div>
                  </label>
                </div>

                <select
                  value={mapping.type}
                  onChange={(e) => {
                    const newMappings = [...mappings];
                    newMappings[index].type = e.target.value;
                    setMappings(newMappings);
                  }}
                  disabled={mapping.ignore}
                  className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-sm cursor-pointer hover:bg-secondary/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <option>Float</option>
                  <option>Integer</option>
                  <option>String</option>
                  <option>Timestamp</option>
                  <option>Boolean</option>
                </select>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Action Bar */}
      <div className="mt-6 pt-6 border-t border-border flex items-center justify-between">
        <button className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg hover:bg-secondary transition-colors">
          <X className="w-4 h-4" />
          Cancel
        </button>

        <div className="flex items-center gap-3">
          <button className="px-4 py-2 text-muted-foreground hover:text-foreground transition-colors">
            Previous Step
          </button>
          <button className="flex items-center gap-2 bg-primary text-primary-foreground px-6 py-2 rounded-lg hover:bg-primary/90 transition-colors">
            <Upload className="w-4 h-4" />
            Clean & Import
          </button>
        </div>
      </div>
    </div>
  );
}
