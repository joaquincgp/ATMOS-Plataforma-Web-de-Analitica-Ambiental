import { useState } from 'react';
import { Database, Cloud, RefreshCw, Upload, CheckCircle2, AlertCircle, FileSpreadsheet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function DataSourceManager() {
  const [sourceUrl, setSourceUrl] = useState('https://api.remmaq.ec/v1/measurements');
  const [fetchFrequency, setFetchFrequency] = useState('hourly');
  const [isSyncing, setIsSyncing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);

  const handleSyncNow = () => {
    setIsSyncing(true);
    setTimeout(() => {
      setIsSyncing(false);
    }, 2000);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const files = Array.from(e.dataTransfer.files).filter(
      file => file.name.endsWith('.csv') || file.name.endsWith('.xlsx') || file.name.endsWith('.xls')
    );
    
    setUploadedFiles(prev => [...prev, ...files]);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files);
      setUploadedFiles(prev => [...prev, ...files]);
    }
  };

  const removeFile = (index: number) => {
    setUploadedFiles(prev => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="p-8 bg-[#F9FBFC] min-h-full">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-foreground mb-2">Data Source Manager</h1>
          <p className="text-muted-foreground">
            Manage automatic data synchronization and manual data imports
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6">
          {/* Section 1: Automatic Ingestion (REMMAQ Auto-Sync) */}
          <Card className="bg-white border-border">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-[#509EE3]/10 flex items-center justify-center">
                    <Database className="w-5 h-5 text-[#509EE3]" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">REMMAQ Auto-Sync Status</CardTitle>
                    <CardDescription>Automatic data ingestion from REMMAQ Website</CardDescription>
                  </div>
                </div>
                <Badge className="bg-green-100 text-green-800 border-green-200 hover:bg-green-100">
                  <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                  Connected
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Sync Status & Actions */}
              <div className="flex items-center justify-between p-4 bg-[#F9FBFC] rounded-lg border border-border">
                <div className="flex items-center gap-3">
                  <Cloud className="w-5 h-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium text-foreground">Last Sync: 2 hours ago</p>
                    <p className="text-xs text-muted-foreground">Next scheduled sync in 30 minutes</p>
                  </div>
                </div>
                <Button 
                  onClick={handleSyncNow} 
                  disabled={isSyncing}
                  className="bg-[#509EE3] hover:bg-[#509EE3]/90 text-white"
                >
                  <RefreshCw className={`w-4 h-4 mr-2 ${isSyncing ? 'animate-spin' : ''}`} />
                  {isSyncing ? 'Syncing...' : 'Sync Now'}
                </Button>
              </div>

              {/* Configuration Form */}
              <div className="space-y-4 p-4 border border-border rounded-lg">
                <h3 className="text-sm font-semibold text-foreground mb-4">Sync Configuration</h3>
                
                <div className="space-y-2">
                  <Label htmlFor="source-url" className="text-sm font-medium">
                    Source URL
                  </Label>
                  <Input
                    id="source-url"
                    type="text"
                    value={sourceUrl}
                    onChange={(e) => setSourceUrl(e.target.value)}
                    placeholder="https://api.remmaq.ec/v1/measurements"
                    className="bg-white"
                  />
                  <p className="text-xs text-muted-foreground">
                    REMMAQ API endpoint for air quality measurements
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="fetch-frequency" className="text-sm font-medium">
                    Fetch Frequency
                  </Label>
                  <Select value={fetchFrequency} onValueChange={setFetchFrequency}>
                    <SelectTrigger id="fetch-frequency" className="bg-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="realtime">Real-time (every 5 min)</SelectItem>
                      <SelectItem value="hourly">Hourly</SelectItem>
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="weekly">Weekly</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    How often to fetch new data from the source
                  </p>
                </div>

                <div className="flex justify-end pt-2">
                  <Button variant="outline" className="mr-2">
                    Cancel
                  </Button>
                  <Button className="bg-[#509EE3] hover:bg-[#509EE3]/90 text-white">
                    Save Configuration
                  </Button>
                </div>
              </div>

              {/* Sync Statistics */}
              <div className="grid grid-cols-3 gap-4">
                <div className="p-4 bg-[#F9FBFC] rounded-lg border border-border">
                  <p className="text-xs text-muted-foreground mb-1">Records Synced Today</p>
                  <p className="text-2xl font-semibold text-foreground">12,847</p>
                </div>
                <div className="p-4 bg-[#F9FBFC] rounded-lg border border-border">
                  <p className="text-xs text-muted-foreground mb-1">Total Records</p>
                  <p className="text-2xl font-semibold text-foreground">1.2M</p>
                </div>
                <div className="p-4 bg-[#F9FBFC] rounded-lg border border-border">
                  <p className="text-xs text-muted-foreground mb-1">Uptime</p>
                  <p className="text-2xl font-semibold text-green-600">99.8%</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Section 2: Manual Data Import */}
          <Card className="bg-white border-border">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-[#509EE3]/10 flex items-center justify-center">
                  <Upload className="w-5 h-5 text-[#509EE3]" />
                </div>
                <div>
                  <CardTitle className="text-lg">Manual Data Import</CardTitle>
                  <CardDescription>Upload CSV or Excel files for one-time data ingestion</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {/* Drag & Drop Zone */}
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`
                  relative border-2 border-dashed rounded-lg p-12 text-center transition-colors
                  ${isDragging 
                    ? 'border-[#509EE3] bg-[#509EE3]/5' 
                    : 'border-border bg-[#F9FBFC] hover:border-[#509EE3]/50'
                  }
                `}
              >
                <input
                  type="file"
                  id="file-upload"
                  className="hidden"
                  accept=".csv,.xlsx,.xls"
                  multiple
                  onChange={handleFileInput}
                />
                
                <div className="flex flex-col items-center gap-4">
                  <div className="w-16 h-16 rounded-full bg-[#509EE3]/10 flex items-center justify-center">
                    <FileSpreadsheet className="w-8 h-8 text-[#509EE3]" />
                  </div>
                  
                  <div>
                    <h3 className="text-base font-medium text-foreground mb-1">
                      Drop your files here, or{' '}
                      <label htmlFor="file-upload" className="text-[#509EE3] cursor-pointer hover:underline">
                        browse
                      </label>
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      Supports CSV, XLS, and XLSX files (Max 50MB per file)
                    </p>
                  </div>

                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <AlertCircle className="w-4 h-4" />
                    <span>Ensure your files contain headers: timestamp, station_id, pollutant, value</span>
                  </div>
                </div>
              </div>

              {/* Uploaded Files List */}
              {uploadedFiles.length > 0 && (
                <div className="mt-6 space-y-3">
                  <h4 className="text-sm font-semibold text-foreground">Uploaded Files ({uploadedFiles.length})</h4>
                  
                  <div className="space-y-2">
                    {uploadedFiles.map((file, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between p-3 bg-[#F9FBFC] border border-border rounded-lg"
                      >
                        <div className="flex items-center gap-3">
                          <FileSpreadsheet className="w-5 h-5 text-[#509EE3]" />
                          <div>
                            <p className="text-sm font-medium text-foreground">{file.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {(file.size / 1024).toFixed(2)} KB
                            </p>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeFile(index)}
                          className="text-red-600 hover:text-red-700 hover:bg-red-50"
                        >
                          Remove
                        </Button>
                      </div>
                    ))}
                  </div>

                  <div className="flex justify-end gap-2 pt-4">
                    <Button variant="outline" onClick={() => setUploadedFiles([])}>
                      Clear All
                    </Button>
                    <Button className="bg-[#509EE3] hover:bg-[#509EE3]/90 text-white">
                      <Upload className="w-4 h-4 mr-2" />
                      Import {uploadedFiles.length} {uploadedFiles.length === 1 ? 'File' : 'Files'}
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
