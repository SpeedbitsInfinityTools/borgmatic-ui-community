import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from 'react-query'
import { 
  Search, 
  Folder, 
  File, 
  HardDrive, 
  Calendar, 
  Eye,
  ChevronRight,
  RefreshCw,
  CheckCircle,
  Play,
  MapPin
} from 'lucide-react'
import { restoreAPI, archivesAPI } from '../services/api'
import { toast } from 'react-hot-toast'
import { getSafeDisplayPath } from '../utils/repositoryUtils'

interface Archive {
  id: string
  name: string
  timestamp: string
  size: string
  file_count: number
  repository: string
}

interface ArchiveFile {
  name: string
  type: 'file' | 'directory'
  size?: string
  path: string
  selected?: boolean
}

// interface RestorePreview {
//   files: string[]
//   total_size: string
//   file_count: number
//   estimated_time: string
// }

const Restore: React.FC = () => {
  const [selectedRepository, setSelectedRepository] = useState<string>('')
  const [selectedArchive, setSelectedArchive] = useState<string>('')
  const [selectedFiles, setSelectedFiles] = useState<string[]>([])
  const [destinationPath, setDestinationPath] = useState<string>('')
  const [currentPath, setCurrentPath] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState('')
  const [showPreview, setShowPreview] = useState(false)
  const [restoreJobId, setRestoreJobId] = useState<string | null>(null)
  const queryClient = useQueryClient()

  // Get archives for selected repository
  const { data: archives, isLoading: loadingArchives } = useQuery({
    queryKey: ['restore-archives', selectedRepository],
    queryFn: () => archivesAPI.listArchives(selectedRepository),
    enabled: !!selectedRepository
  })

  // Get archive contents
  const { data: archiveContents, isLoading: loadingContents } = useQuery({
    queryKey: ['restore-contents', selectedRepository, selectedArchive, currentPath],
    queryFn: () => archivesAPI.listContents(selectedRepository, selectedArchive, currentPath),
    enabled: !!selectedRepository && !!selectedArchive
  })

  // Preview restore mutation
  const previewMutation = useMutation({
    mutationFn: (paths: string[]) => 
      restoreAPI.previewRestore(selectedRepository, selectedArchive, paths),
    onSuccess: () => {
      setShowPreview(true)
      toast.success('Restore preview generated!')
    },
    onError: (error: any) => {
      toast.error(`Failed to generate preview: ${error.response?.data?.detail || error.message}`)
    }
  })

  // Start restore mutation
  const startRestoreMutation = useMutation({
    mutationFn: ({ paths, destination }: { paths: string[]; destination: string }) =>
      restoreAPI.startRestore(selectedRepository, selectedArchive, paths, destination),
    onSuccess: (data: any) => {
      setRestoreJobId(data.data?.job_id)
      toast.success('Restore job started successfully!')
      queryClient.invalidateQueries({ queryKey: ['restore-status'] })
    },
    onError: (error: any) => {
      toast.error(`Failed to start restore: ${error.response?.data?.detail || error.message}`)
    }
  })

  // Handle repository selection
  const handleRepositorySelect = (repository: string) => {
    setSelectedRepository(repository)
    setSelectedArchive('')
    setSelectedFiles([])
    setCurrentPath('')
    setShowPreview(false)
    setRestoreJobId(null)
  }

  // Handle archive selection
  const handleArchiveSelect = (archive: string) => {
    setSelectedArchive(archive)
    setSelectedFiles([])
    setCurrentPath('')
    setShowPreview(false)
    setRestoreJobId(null)
  }

  // Handle file/folder selection
  const handleFileSelect = (filePath: string) => {
    setSelectedFiles(prev => {
      if (prev.includes(filePath)) {
        return prev.filter(path => path !== filePath)
      } else {
        return [...prev, filePath]
      }
    })
  }

  // Handle file/folder click
  const handleItemClick = (item: ArchiveFile) => {
    if (item.type === 'directory') {
      const newPath = currentPath ? `${currentPath}/${item.name}` : item.name
      setCurrentPath(newPath)
    }
  }

  // Handle navigation breadcrumb
  const handleBreadcrumbClick = (index: number) => {
    const pathParts = currentPath.split('/')
    const newPath = pathParts.slice(0, index + 1).join('/')
    setCurrentPath(newPath)
  }

  // Handle preview restore
  const handlePreviewRestore = () => {
    if (selectedFiles.length === 0) {
      toast.error('Please select files to restore')
      return
    }
    previewMutation.mutate(selectedFiles)
  }

  // Handle start restore
  const handleStartRestore = () => {
    if (selectedFiles.length === 0) {
      toast.error('Please select files to restore')
      return
    }
    if (!destinationPath.trim()) {
      toast.error('Please specify a destination path')
      return
    }
    startRestoreMutation.mutate({ paths: selectedFiles, destination: destinationPath })
  }

  // Filter archives based on search
  const filteredArchives = archives?.data?.filter((archive: Archive) =>
    archive.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    archive.timestamp.includes(searchQuery)
  ) || []

  // Format file size
  const formatFileSize = (size?: string) => {
    if (!size) return 'Unknown'
    return size
  }

  // Format timestamp
  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleString()
  }

  // Get breadcrumb parts
  const breadcrumbParts = currentPath ? ['root', ...currentPath.split('/')] : ['root']

  // Mock repositories for now
  const mockRepositories = [
    { id: 'repo1', name: 'Default Repository', path: '/backups/default' },
    { id: 'repo2', name: 'Documents Backup', path: '/backups/documents' },
    { id: 'repo3', name: 'System Backup', path: '/backups/system' }
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Restore Operations</h1>
          <p className="text-gray-600">Restore files and folders from backup archives</p>
        </div>
        <button
          onClick={() => queryClient.invalidateQueries({ queryKey: ['restore-archives', selectedRepository] })}
          className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Repository and Archive Selection */}
        <div className="lg:col-span-1 space-y-6">
          {/* Repository Selection */}
          <div className="bg-white rounded-lg shadow">
            <div className="px-4 py-3 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">Repository</h3>
            </div>
            <div className="p-4">
              {mockRepositories.map((repo) => (
                <div
                  key={repo.id}
                  onClick={() => handleRepositorySelect(repo.id)}
                  className={`p-3 rounded-lg cursor-pointer transition-colors ${
                    selectedRepository === repo.id
                      ? 'bg-indigo-50 border border-indigo-200'
                      : 'hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center">
                    <HardDrive className="h-5 w-5 text-gray-400 mr-3" />
                    <div>
                      <h4 className="font-medium text-gray-900">{repo.name}</h4>
                      <p className="text-sm text-gray-600 break-all">{getSafeDisplayPath(repo.path)}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Archive Selection */}
          {selectedRepository && (
            <div className="bg-white rounded-lg shadow">
              <div className="px-4 py-3 border-b border-gray-200">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-medium text-gray-900">Archive</h3>
                  <div className="relative">
                    <Search className="h-4 w-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Search archives..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                  </div>
                </div>
              </div>
              <div className="p-4">
                {loadingArchives ? (
                  <div className="text-center py-4">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600 mx-auto"></div>
                    <p className="mt-2 text-sm text-gray-600">Loading archives...</p>
                  </div>
                ) : filteredArchives.length === 0 ? (
                  <div className="text-center py-4">
                    <Folder className="h-8 w-8 text-gray-400 mx-auto mb-2" />
                    <p className="text-sm text-gray-600">No archives found</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {filteredArchives.map((archive: Archive) => (
                      <div
                        key={archive.id}
                        onClick={() => handleArchiveSelect(archive.name)}
                        className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                          selectedArchive === archive.name
                            ? 'border-indigo-300 bg-indigo-50'
                            : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                        }`}
                      >
                        <div className="flex items-center space-x-3">
                          <Folder className="h-4 w-4 text-blue-500" />
                          <div>
                            <h4 className="font-medium text-gray-900 text-sm">{archive.name}</h4>
                            <div className="text-xs text-gray-600">
                              <span className="flex items-center">
                                <Calendar className="h-3 w-3 mr-1" />
                                {formatTimestamp(archive.timestamp)}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* File Browser and Selection */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-lg shadow">
            <div className="px-4 py-3 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">File Selection</h3>
              {selectedArchive && (
                <p className="text-sm text-gray-600">Select files and folders to restore from {selectedArchive}</p>
              )}
            </div>
            
            <div className="p-4">
              {!selectedArchive ? (
                <div className="text-center py-8">
                  <Folder className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-600">Select an archive to browse files</p>
                </div>
              ) : (
                <>
                  {/* Breadcrumb */}
                  <div className="flex items-center space-x-2 mb-4 text-sm">
                    {breadcrumbParts.map((part, index) => (
                      <React.Fragment key={index}>
                        {index > 0 && <ChevronRight className="h-4 w-4 text-gray-400" />}
                        <button
                          onClick={() => handleBreadcrumbClick(index)}
                          className={`hover:text-indigo-600 ${
                            index === breadcrumbParts.length - 1 ? 'text-gray-900 font-medium' : 'text-gray-600'
                          }`}
                        >
                          {part}
                        </button>
                      </React.Fragment>
                    ))}
                  </div>

                  {/* File List */}
                  {loadingContents ? (
                    <div className="text-center py-8">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div>
                      <p className="mt-2 text-gray-600">Loading contents...</p>
                    </div>
                  ) : archiveContents?.data?.length === 0 ? (
                    <div className="text-center py-8">
                      <Folder className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                      <p className="text-gray-600">This directory is empty</p>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {archiveContents?.data?.map((item: ArchiveFile, index: number) => {
                        const fullPath = currentPath ? `${currentPath}/${item.name}` : item.name
                        const isSelected = selectedFiles.includes(fullPath)
                        
                        return (
                          <div
                            key={index}
                            className="flex items-center p-2 rounded-md hover:bg-gray-50"
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => handleFileSelect(fullPath)}
                              className="mr-3 h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                            />
                            <div
                              onClick={() => handleItemClick(item)}
                              className="flex items-center flex-1 cursor-pointer"
                            >
                              {item.type === 'directory' ? (
                                <Folder className="h-4 w-4 text-blue-500 mr-3" />
                              ) : (
                                <File className="h-4 w-4 text-gray-500 mr-3" />
                              )}
                              <span className="text-sm text-gray-900">{item.name}</span>
                            </div>
                            {item.size && (
                              <span className="text-sm text-gray-600">{formatFileSize(item.size)}</span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Restore Configuration */}
      {selectedFiles.length > 0 && (
        <div className="bg-white rounded-lg shadow">
          <div className="px-4 py-3 border-b border-gray-200">
            <h3 className="text-lg font-medium text-gray-900">Restore Configuration</h3>
          </div>
          <div className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Selected Files */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Selected Files ({selectedFiles.length})
                </label>
                <div className="max-h-32 overflow-y-auto border border-gray-300 rounded-md p-3 bg-gray-50">
                  {selectedFiles.map((file, index) => (
                    <div key={index} className="text-sm text-gray-700 mb-1">
                      {file}
                    </div>
                  ))}
                </div>
              </div>

              {/* Destination Path */}
              <div>
                <label htmlFor="destination" className="block text-sm font-medium text-gray-700 mb-2">
                  Destination Path
                </label>
                <div className="relative">
                  <MapPin className="h-4 w-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    id="destination"
                    value={destinationPath}
                    onChange={(e) => setDestinationPath(e.target.value)}
                    placeholder="/path/to/restore/destination"
                    className="pl-10 w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  />
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center space-x-4 mt-6">
              <button
                onClick={handlePreviewRestore}
                disabled={previewMutation.isLoading}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
              >
                {previewMutation.isLoading ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Generating Preview...
                  </>
                ) : (
                  <>
                    <Eye className="h-4 w-4 mr-2" />
                    Preview Restore
                  </>
                )}
              </button>

              <button
                onClick={handleStartRestore}
                disabled={startRestoreMutation.isLoading || !destinationPath.trim()}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50"
              >
                {startRestoreMutation.isLoading ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Starting Restore...
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 mr-2" />
                    Start Restore
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Restore Preview Modal */}
      {showPreview && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-11/12 max-w-2xl shadow-lg rounded-md bg-white">
            <div className="mt-3">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Restore Preview</h3>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <span className="text-sm font-medium text-gray-600">Files to restore:</span>
                    <p className="text-sm text-gray-900">{selectedFiles.length}</p>
                  </div>
                  <div>
                    <span className="text-sm font-medium text-gray-600">Destination:</span>
                    <p className="text-sm text-gray-900">{destinationPath || 'Not specified'}</p>
                  </div>
                </div>
                
                <div>
                  <span className="text-sm font-medium text-gray-600">Selected files:</span>
                  <div className="mt-2 max-h-32 overflow-y-auto border border-gray-300 rounded-md p-3 bg-gray-50">
                    {selectedFiles.map((file, index) => (
                      <div key={index} className="text-sm text-gray-700 mb-1">
                        {file}
                      </div>
                    ))}
                  </div>
                </div>
                
                <div className="flex justify-end space-x-3">
                  <button
                    onClick={() => setShowPreview(false)}
                    className="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400"
                  >
                    Close
                  </button>
                  <button
                    onClick={() => {
                      setShowPreview(false)
                      handleStartRestore()
                    }}
                    disabled={!destinationPath.trim()}
                    className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
                  >
                    Start Restore
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Restore Job Status */}
      {restoreJobId && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <div className="flex items-center">
            <CheckCircle className="h-5 w-5 text-green-400 mr-2" />
            <div>
              <h3 className="text-sm font-medium text-green-800">Restore Job Started</h3>
              <p className="text-sm text-green-700">Job ID: {restoreJobId}</p>
              <p className="text-sm text-green-700">Check the Backup page to monitor progress</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Restore 