import { useState, useRef, DragEvent, ChangeEvent } from 'react'

interface FileUploadProps {
  onFileSelect: (file: File) => void
  disabled?: boolean
}

const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB

export default function FileUpload({ onFileSelect, disabled = false }: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const validateFile = (file: File): string | null => {
    // Check file size
    if (file.size > MAX_FILE_SIZE) {
      return `File size exceeds 50MB limit (${(file.size / 1024 / 1024).toFixed(2)}MB)`
    }

    // Check file type (JSON or ChatGPT HTML export)
    const lower = file.name.toLowerCase()
    if (!(lower.endsWith('.json') || lower.endsWith('.html') || lower.endsWith('.htm'))) {
      return 'Only JSON or HTML exports are supported'
    }

    return null
  }

  const handleFile = (file: File) => {
    setError(null)
    
    const validationError = validateFile(file)
    if (validationError) {
      setError(validationError)
      return
    }

    onFileSelect(file)
  }

  const handleDragEnter = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    if (!disabled) {
      setIsDragging(true)
    }
  }

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    if (disabled) return

    const files = e.dataTransfer.files
    if (files.length > 0) {
      handleFile(files[0])
    }
  }

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files && files.length > 0) {
      handleFile(files[0])
    }
  }

  const handleClick = () => {
    if (!disabled && fileInputRef.current) {
      fileInputRef.current.click()
    }
  }

  return (
    <div>
      <div
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleClick}
        className={`
          group relative border-2 border-dashed rounded-xl p-12 text-center cursor-pointer
          transition-all duration-300 ease-out overflow-hidden
          ${isDragging 
            ? 'border-blue-500 bg-blue-50 scale-[1.02]' 
            : 'border-gray-200 hover:border-blue-400 hover:bg-gray-50 bg-white'
          }
          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
        `}
      >
        {/* Subtle gradient background on hover */}
        <div className={`
          absolute inset-0 bg-gradient-to-br from-blue-50/50 to-indigo-50/50 
          transition-opacity duration-300
          ${isDragging ? 'opacity-100' : 'opacity-0 group-hover:opacity-50'}
        `} />

        <input
          ref={fileInputRef}
          type="file"
          accept=".json,.html,.htm"
          onChange={handleFileInputChange}
          className="hidden"
          disabled={disabled}
          aria-label="Upload file"
        />
        
        {/* Icon */}
        <div className={`
          relative mx-auto w-16 h-16 rounded-2xl flex items-center justify-center
          transition-all duration-300 ease-out
          ${isDragging 
            ? 'bg-blue-500 scale-110' 
            : 'bg-gray-100 group-hover:bg-blue-100 group-hover:scale-105'
          }
        `}>
          <svg
            className={`h-8 w-8 transition-colors duration-300 ${
              isDragging ? 'text-white' : 'text-gray-400 group-hover:text-blue-500'
            }`}
            stroke="currentColor"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
            />
          </svg>
        </div>
        
        <div className="relative mt-6 space-y-2">
          <p className="text-base text-gray-700">
            <span className={`
              font-semibold transition-colors duration-300
              ${isDragging ? 'text-blue-600' : 'text-blue-600 group-hover:text-blue-700'}
            `}>
              Click to upload
            </span>
            {' '}or drag and drop
          </p>
          <p className="text-sm text-gray-500">
            JSON or HTML exports from ChatGPT, Claude, or other AI assistants
          </p>
          <p className="text-xs text-gray-400 mt-1">
            Up to 50MB
          </p>
        </div>

        {/* Animated border effect on drag */}
        {isDragging && (
          <div className="absolute inset-0 border-2 border-blue-500 rounded-xl animate-pulse" />
        )}
      </div>

      {error && (
        <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3 animate-fade-in">
          <span className="text-xl">⚠️</span>
          <div>
            <p className="text-sm font-medium text-red-800">Upload Error</p>
            <p className="text-sm text-red-600 mt-0.5">{error}</p>
          </div>
        </div>
      )}
    </div>
  )
}
