import { useState, useEffect } from 'react'

interface ProcessingLoaderProps {
  fileName?: string
}

const PROCESSING_MESSAGES = [
  { text: "Reading your conversations...", icon: "📖" },
  { text: "Analyzing context and meaning...", icon: "🔍" },
  { text: "Extracting key memories...", icon: "💭" },
  { text: "Identifying important decisions...", icon: "⚡" },
  { text: "Organizing your knowledge...", icon: "🧠" },
  { text: "Almost there...", icon: "✨" },
]

export default function ProcessingLoader({ fileName }: ProcessingLoaderProps) {
  const [messageIndex, setMessageIndex] = useState(0)
  const [dots, setDots] = useState('')

  // Cycle through messages
  useEffect(() => {
    const messageInterval = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % PROCESSING_MESSAGES.length)
    }, 3000)

    return () => clearInterval(messageInterval)
  }, [])

  // Animate dots
  useEffect(() => {
    const dotsInterval = setInterval(() => {
      setDots((prev) => (prev.length >= 3 ? '' : prev + '.'))
    }, 500)

    return () => clearInterval(dotsInterval)
  }, [])

  const currentMessage = PROCESSING_MESSAGES[messageIndex]

  return (
    <div className="absolute inset-0 bg-white/98 backdrop-blur-sm flex flex-col items-center justify-center z-10 rounded-2xl animate-fade-in">
      <div className="w-full max-w-lg px-8 py-10 bg-white border border-gray-100 rounded-2xl shadow-lg shadow-blue-50 text-center space-y-8 translate-y-2">
        {/* Main loader animation */}
        <div className="relative mx-auto">
          {/* Outer pulsing rings */}
          <div className="absolute inset-0 -m-4">
            <div className="w-28 h-28 rounded-full border-2 border-blue-200 animate-pulse-ring" />
          </div>
          <div className="absolute inset-0 -m-8">
            <div className="w-36 h-36 rounded-full border border-blue-100 animate-pulse-ring-delayed opacity-50" />
          </div>
          
          {/* Main circle with gradient */}
          <div className="relative w-20 h-20 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg animate-bounce-gentle">
            {/* Inner spinner */}
            <div className="absolute inset-1 rounded-full border-2 border-transparent border-t-white/30 animate-spin" />
            
            {/* Icon */}
            <span className="text-3xl" role="img" aria-hidden="true">
              {currentMessage.icon}
            </span>
          </div>
          
          {/* Floating particles */}
          <div className="absolute -top-2 -right-2 w-3 h-3 rounded-full bg-blue-400 animate-float opacity-60" />
          <div className="absolute -bottom-1 -left-3 w-2 h-2 rounded-full bg-indigo-400 animate-float-delayed-1 opacity-40" />
          <div className="absolute top-1/2 -right-4 w-2 h-2 rounded-full bg-blue-300 animate-float-delayed-half opacity-50" />
        </div>

        {/* Processing text */}
        <div className="space-y-3">
          <h3 className="text-xl font-semibold text-gray-900">
            Processing your file{dots}
          </h3>
          
          {fileName && (
            <p className="text-sm text-gray-500 font-medium truncate max-w-full mx-auto">
              {fileName}
            </p>
          )}
          
          {/* Animated message */}
          <div className="h-6 flex items-center justify-center">
            <p 
              key={messageIndex}
              className="text-sm text-gray-600 animate-fade-in"
            >
              {currentMessage.text}
            </p>
          </div>
        </div>

        {/* Progress steps indicator */}
        <div className="flex items-center gap-2 justify-center">
          {PROCESSING_MESSAGES.map((_, idx) => (
            <div
              key={idx}
              className={`h-1.5 rounded-full transition-all duration-500 ${
                idx <= messageIndex 
                  ? 'w-6 bg-blue-500' 
                  : 'w-1.5 bg-gray-200'
              }`}
            />
          ))}
        </div>

        {/* Subtle tip */}
        <p className="text-xs text-gray-400 text-center max-w-xs mx-auto">
          AI is analyzing your conversations to extract meaningful memories and insights
        </p>
      </div>
    </div>
  )
}
