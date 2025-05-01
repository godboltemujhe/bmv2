import React, { useState, useEffect, useCallback, useMemo, memo, useRef } from 'react'
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Upload, Download, Trash, Edit, Plus, Minus, Check, X, ArrowRight, ArrowLeft, Clock, Pencil, Save, RefreshCw, Cloud, ChevronDown, CheckIcon, XIcon, ChevronsUp, Copy, Share2, Database, RotateCcw, Eye, Image, Camera, Globe, Lock } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { useToast } from "@/hooks/use-toast"
import { Progress } from "@/components/ui/progress"
import { motion, AnimatePresence } from "framer-motion"
import { apiRequest } from "@/lib/queryClient"
import { v4 as uuidv4 } from 'uuid'
import { encodeQuizData, decodeQuizData, isEncodedQuizData, safeStringify } from "@/lib/utils"
import { ThemeToggle } from "@/components/theme-toggle"
import { useTheme } from "@/components/theme-provider"
import html2canvas from 'html2canvas'

// TypeScript declaration for File System Access API and Android Bridge
declare global {
  interface Window {
    showSaveFilePicker?: (options?: any) => Promise<any>;
    
    // Android External Storage interface for persistent storage
    ExternalStorage?: {
      saveBackup: (data: string) => boolean;
      loadBackup: () => string | null;
      backupExists: () => boolean;
    };
    
    // Function to restore quizzes from backup (used by Android app)
    restoreQuizzesFromBackup?: (data: any) => void;
  }
}

type Question = {
  question: string
  answerDescription: string
  options: string[]
  correctAnswer: string
  questionImages: string[]
  answerImages: string[]
}

type QuizCategory = 'General Knowledge' | 'Mathematics' | 'Science' | 'Reasoning' | 'Custom' | string

type QuizAttempt = {
  date: Date
  score: number
  totalQuestions: number
  timeSpent: number
  // Track which questions were answered correctly/incorrectly
  questionResults?: Array<{
    question: string
    userAnswer: string
    correctAnswer: string
    isCorrect: boolean
  }>
  // For sharing results
  shareId?: string
  shareImage?: string
}

type Quiz = {
  id: string        // Unique identifier 
  uniqueId?: string // Server-side unique identifier for cross-device synchronization
  title: string
  description: string
  questions: Question[]
  timer: number
  lastTaken?: Date
  password?: string  // User-defined password for editing
  category: QuizCategory
  history?: QuizAttempt[]
  createdAt: Date
  isPublic: boolean  // For sharing functionality
  version?: number   // Version tracking for updates
}

// Utility function to compress base64 images
function compressBase64Image(base64: string, quality = 0.7, maxSize = 1200): string {
  // If it's not a base64 image, return as is
  if (!base64 || !base64.startsWith('data:image')) {
    return base64;
  }

  // For a simplified implementation, just return the original
  // In a real implementation with a proper canvas setup, this would compress the image
  console.log(`Image would be compressed to quality: ${quality}, max size: ${maxSize}px`);
  return base64;
}

// Reference for tracking if we've already loaded public quizzes
// Declare outside component to avoid React hook violations
let publicQuizzesLoadedRef: React.MutableRefObject<boolean>;

export default function QuizApp() {
  // Initialize Android external storage backup restoration system
  useEffect(() => {
    // Define the function to restore from Android backup
    // This will be called by the Android WebView when the app starts
    window.restoreQuizzesFromBackup = (backupData) => {
      try {
        console.log("Attempting to restore quizzes from external backup");
        if (!backupData) {
          console.error("No backup data provided to restore");
          return;
        }
        
        let quizzesToRestore;
        
        // Handle string or object data - in case Android passes a JSON string
        if (typeof backupData === 'string') {
          quizzesToRestore = JSON.parse(backupData);
        } else {
          quizzesToRestore = backupData;
        }
        
        if (!Array.isArray(quizzesToRestore)) {
          console.error("Invalid backup data format - expected array");
          return;
        }
        
        // Process the quizzes - convert date strings to Date objects
        const processedQuizzes = quizzesToRestore.map(quiz => ({
          ...quiz,
          createdAt: new Date(quiz.createdAt),
          lastTaken: quiz.lastTaken ? new Date(quiz.lastTaken) : undefined,
          history: quiz.history ? quiz.history.map((attempt: QuizAttempt) => ({
            ...attempt,
            date: new Date(attempt.date)
          })) : []
        }));
        
        // Update state with restored quizzes
        setQuizzes(processedQuizzes);
        
        // Show success toast
        toast({
          title: "बैकअप से पुनर्स्थापित",
          description: `${processedQuizzes.length} क्विज़ सफलतापूर्वक लोड की गईं`,
          variant: "default",
        });
        
        console.log(`Restored ${processedQuizzes.length} quizzes from external backup`);
      } catch (error) {
        console.error("Failed to restore quizzes from backup:", error);
        toast({
          title: "पुनर्स्थापना त्रुटि",
          description: "बैकअप से क्विज़ पुनर्स्थापित करने में समस्या हुई",
          variant: "destructive",
        });
      }
    };
  }, []);

  // Helper function to load data from localStorage with chunking support
  const loadFromLocalStorage = (key: string, defaultValue: any = null) => {
    try {
      const value = localStorage.getItem(key);

      console.log(`Loading data with key ${key}, value found: ${value !== null}`);

      // Return default value if not found
      if (value === null) {
        console.log(`No data found for key ${key}, returning default value`);
        return defaultValue;
      }

      // Check if data is chunked
      if (value.startsWith('__CHUNKED__')) {
        console.log(`Found chunked data for key ${key}`);
        const chunks = parseInt(localStorage.getItem(`${key}_chunks`) || '0', 10);

        if (chunks <= 0) {
          console.error(`Invalid chunks count for key ${key}: ${chunks}`);
          return defaultValue;
        }

        console.log(`Attempting to load ${chunks} chunks for key ${key}`);
        let jsonString = '';

        // Combine all chunks
        for (let i = 0; i < chunks; i++) {
          const chunk = localStorage.getItem(`${key}_chunk_${i}`);
          if (chunk) {
            jsonString += chunk;
          } else {
            console.error(`Missing chunk ${i} of ${chunks} for key ${key}`);
            throw new Error(`Missing chunk ${i} of ${chunks}`);
          }
        }

        console.log(`Successfully loaded all chunks for key ${key}, parsing JSON`);
        const parsedData = JSON.parse(jsonString);
        return parsedData;
      }

      // Regular data
      console.log(`Loading regular data for key ${key}`);
      const parsedData = JSON.parse(value);
      return parsedData;
    } catch (error) {
      console.error(`Error loading data from localStorage with key ${key}:`, error);
      return defaultValue;
    }
  };

  const [activeTab, setActiveTab] = useState("create")
  // Load quizzes from localStorage on initialization
  const [quizzes, setQuizzes] = useState<Quiz[]>(() => {
    try {
      console.log("Loading quizzes from localStorage on initial mount");
      // Use our enhanced localStorage function that supports chunking
      const savedQuizzes = loadFromLocalStorage('quizzes', [])

      if (savedQuizzes && Array.isArray(savedQuizzes)) {
        // Convert date strings back to Date objects
        return savedQuizzes.map(quiz => ({
          ...quiz,
          createdAt: new Date(quiz.createdAt),
          lastTaken: quiz.lastTaken ? new Date(quiz.lastTaken) : undefined,
          history: quiz.history ? quiz.history.map((attempt: QuizAttempt) => ({
            ...attempt,
            date: new Date(attempt.date)
          })) : []
        }))
      } else {
        console.log("No quizzes found in localStorage");
        return [] // Default to empty array if not an array
      }
    } catch (e) {
      console.error('Failed to parse quizzes from localStorage', e)
      return []
    }
  })
  const [currentQuiz, setCurrentQuiz] = useState<Quiz | null>(null)
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)
  const [selectedAnswers, setSelectedAnswers] = useState<string[]>([])
  const [score, setScore] = useState(0)
  const [timer, setTimer] = useState(0)
  const [isQuizRunning, setIsQuizRunning] = useState(false)
  const [showResults, setShowResults] = useState(false)
  const [passwordInput, setPasswordInput] = useState("")
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false)
  const [quizToEdit, setQuizToEdit] = useState<number | null>(null)
  const [isEditMode, setIsEditMode] = useState(false)
  const MASTER_PASSWORD = "8387"  // Password protection for quiz deletion
  const [newQuiz, setNewQuiz] = useState<Quiz>({
    id: uuidv4(),
    uniqueId: uuidv4(), // Add unique ID for server syncing
    title: '',
    description: '',
    questions: [],
    timer: 300,
    category: 'General Knowledge',
    createdAt: new Date(),
    isPublic: false,
    history: [],
    version: 1
  })
  const [newQuestions, setNewQuestions] = useState<Question[]>([
    {
      question: '',
      answerDescription: '',
      options: ['', '', '', ''],
      correctAnswer: '',
      questionImages: [],
      answerImages: [],
    },
  ])
  // Clean sample JSON format without comments
  const sampleJsonFormat = `[
  {
    "title": "Sample Quiz",
    "description": "This is a sample quiz.",
    "timer": 300,
    "category": "General Knowledge",
    "isPublic": true,
    "password": "optional-password",
    "questions": [
      {
        "question": "What is the capital of France?",
        "answerDescription": "Paris is the capital and largest city of France.",
        "options": ["Berlin", "Madrid", "Paris", "Rome"],
        "correctAnswer": "Paris",
        "questionImages": [],
        "answerImages": []
      },
      {
        "question": "What is 2 + 2?",
        "answerDescription": "This is basic addition.",
        "options": ["3", "4", "5", "6"],
        "correctAnswer": "4",
        "questionImages": [],
        "answerImages": []
      }
    ]
  }
]`;

  // A more detailed version with explanatory text - used for the copy format functionality
  const detailedJsonFormat = `[
  {
    "title": "Sample Quiz",                    // Quiz title (required)
    "description": "This is a sample quiz.",   // Quiz description (required)
    "timer": 300,                              // Time limit in seconds (required)
    "category": "General Knowledge",           // Category must be one of: "General Knowledge", "Mathematics", "Science", "Reasoning" (required)
    "isPublic": true,                          // Whether quiz is publicly visible (required)
    "password": "optional-password",           // Optional password for editing
    "questions": [                             // Array of questions (required)
      {
        "question": "What is the capital of France?",  // Question text (required)
        "answerDescription": "Paris is the capital and largest city of France.",  // Explanation for the answer (required)
        "options": ["Berlin", "Madrid", "Paris", "Rome"],  // Multiple choice options (required)
        "correctAnswer": "Paris",                          // Must match one of the options exactly (required)
        "questionImages": [],                              // Optional array of base64 image strings 
        "answerImages": []                                 // Optional array of base64 image strings
      },
      {
        "question": "What is 2 + 2?",
        "answerDescription": "This is basic addition.",
        "options": ["3", "4", "5", "6"],
        "correctAnswer": "4",
        "questionImages": [],
        "answerImages": []
      }
    ]
  }
]`;

  const [importJson, setImportJson] = useState<string>(sampleJsonFormat)
  // Removed sync status state
  const [isJsonPlaceholder, setIsJsonPlaceholder] = useState(true)
  const [exportOption, setExportOption] = useState<'all' | 'specific'>('all')
  const [selectedQuizzes, setSelectedQuizzes] = useState<number[]>([])
  const [isExportModalOpen, setIsExportModalOpen] = useState(false)
  const [isQuizModalOpen, setIsQuizModalOpen] = useState(false)
  const [exportedJson, setExportedJson] = useState<string>("")
  const [exportFilename, setExportFilename] = useState<string>("bmv_quizzes.json")
  // State for quiz merging
  const [isMergeModalOpen, setIsMergeModalOpen] = useState(false)
  const [quizzesToMerge, setQuizzesToMerge] = useState<number[]>([])
  const [mergedQuizTitle, setMergedQuizTitle] = useState("")
  const [mergedQuizCategory, setMergedQuizCategory] = useState<QuizCategory>("General Knowledge")
  
  // Search and filtering
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  
  // Animation states
  const [loadingQuestion, setLoadingQuestion] = useState(false)
  const [progressBarColor, setProgressBarColor] = useState<string>("bg-primary")
  const [progressBarPattern, setProgressBarPattern] = useState<string>("")
  const [allCategories, setAllCategories] = useState<string[]>([])
  const [customCategoryInput, setCustomCategoryInput] = useState("")
  const [showAddCategoryDialog, setShowAddCategoryDialog] = useState(false)
  
  // Reference to track if we've already loaded public quizzes
  const publicQuizzesLoadedRef = useRef(false);
  
  const { toast } = useToast()
  
  /**
   * Creates a content hash for a quiz to identify duplicates
   * Uses title, question text, and options to determine similarity
   */
  const createQuizContentHash = (quiz: Quiz): string => {
    // Create a simplified quiz representation for comparison
    const titleNormalized = quiz.title.toLowerCase().trim();
    
    // Extract question texts and correct answers
    const questionsSimplified = quiz.questions.map(q => ({
      question: q.question.toLowerCase().trim(),
      options: q.options.map(opt => opt.toLowerCase().trim()).sort().join('|'),
      correctAnswer: q.correctAnswer.toLowerCase().trim()
    }));
    
    // Sort questions for consistent comparison
    questionsSimplified.sort((a, b) => a.question.localeCompare(b.question));
    
    // Create a hash key
    return `${titleNormalized}:${questionsSimplified.length}:${JSON.stringify(questionsSimplified)}`;
  };
  
  /**
   * Simpler function to check if two quizzes have the same title
   * This is used as an additional check for duplicates
   */
  const haveSameTitle = (quiz1: Quiz, quiz2: Quiz): boolean => {
    return quiz1.title.toLowerCase().trim() === quiz2.title.toLowerCase().trim();
  };
  
  /**
   * Detects and removes duplicate quizzes from the local storage
   * Quizzes are considered duplicates if they have the same title and questions
   * or if they have the same uniqueId (server-synced quizzes)
   */
  // Add loading state for async operations like server cleanup
  const [isLoading, setLoading] = useState(false);
  
  const removeDuplicateQuizzes = useCallback(() => {
    // Track the start time for performance monitoring
    const startTime = performance.now();
    
    setQuizzes(prevQuizzes => {
      // Maps to track uniqueness
      const uniqueIdMap = new Map(); // For server quizzes with uniqueId
      const contentHashMap = new Map(); // For detecting duplicates by content
      const titleMap = new Map(); // For additional title-based duplicate detection
      const uniqueQuizzes: Quiz[] = [];
      const duplicatesRemoved: Quiz[] = [];
      
      // First pass - handle quizzes with uniqueIds
      prevQuizzes.forEach(quiz => {
        // For server-synced quizzes with uniqueId
        if (quiz.uniqueId) {
          if (!uniqueIdMap.has(quiz.uniqueId)) {
            // First occurrence of this uniqueId
            uniqueIdMap.set(quiz.uniqueId, quiz);
            uniqueQuizzes.push(quiz);
          } else {
            // This is a duplicate by uniqueId, keep the newer version
            const existingQuiz = uniqueIdMap.get(quiz.uniqueId)!;
            
            // If this quiz is newer (by version or createdAt), replace the existing one
            if (
              (quiz.version && existingQuiz.version && quiz.version > existingQuiz.version) ||
              (!quiz.version && !existingQuiz.version && quiz.createdAt && existingQuiz.createdAt && 
               new Date(quiz.createdAt) > new Date(existingQuiz.createdAt))
            ) {
              // Find the index of the existing quiz and replace it
              const existingIndex = uniqueQuizzes.findIndex(q => q.uniqueId === quiz.uniqueId);
              if (existingIndex !== -1) {
                console.log(`Replacing duplicate quiz by uniqueId: "${existingQuiz.title}" with newer version`);
                duplicatesRemoved.push(existingQuiz); // Track removed quiz
                uniqueQuizzes[existingIndex] = quiz;
                uniqueIdMap.set(quiz.uniqueId, quiz);
              }
            } else {
              // Current quiz is older, so don't add it
              console.log(`Skipping older duplicate quiz by uniqueId: "${quiz.title}"`);
              duplicatesRemoved.push(quiz);
            }
          }
        }
      });
      
      // Second pass - handle quizzes without uniqueIds using content hash
      prevQuizzes.forEach(quiz => {
        if (!quiz.uniqueId) {
          // Create content hash for comparison
          const contentKey = createQuizContentHash(quiz);
          
          // Check if we already have a quiz with the same content hash
          if (!contentHashMap.has(contentKey)) {
            // First quiz with this content
            contentHashMap.set(contentKey, quiz);
            uniqueQuizzes.push(quiz);
          } else {
            // Duplicate by content hash
            console.log(`Found duplicate quiz by content: "${quiz.title}"`);
            duplicatesRemoved.push(quiz);
          }
        }
      });
      
      // Third pass - check for quizzes with the same title but different uniqueIds
      // This helps catch duplicates that might have different uniqueIds due to bugs
      const finalUniqueQuizzes: Quiz[] = [];
      const processedTitles = new Map<string, Quiz[]>();
      
      for (const quiz of uniqueQuizzes) {
        const normalizedTitle = quiz.title.toLowerCase().trim();
        
        if (!processedTitles.has(normalizedTitle)) {
          processedTitles.set(normalizedTitle, [quiz]);
          finalUniqueQuizzes.push(quiz);
        } else {
          // Found quizzes with same title - check if they're duplicates
          const existingQuizzes = processedTitles.get(normalizedTitle)!;
          
          // Check if any of the existing quizzes with the same title are content duplicates
          let isDuplicate = false;
          
          for (const existingQuiz of existingQuizzes) {
            // Compare question content more directly for near-matches
            if (quiz.questions.length === existingQuiz.questions.length) {
              // Count matching questions
              let matchingQuestions = 0;
              
              for (let i = 0; i < quiz.questions.length; i++) {
                const q1 = quiz.questions[i].question.toLowerCase().trim();
                const q1CorrectAnswer = quiz.questions[i].correctAnswer.toLowerCase().trim();
                
                for (const eq of existingQuiz.questions) {
                  const q2 = eq.question.toLowerCase().trim();
                  const q2CorrectAnswer = eq.correctAnswer.toLowerCase().trim();
                  
                  // If question text and correct answer match, consider it the same question
                  if (q1 === q2 && q1CorrectAnswer === q2CorrectAnswer) {
                    matchingQuestions++;
                    break;
                  }
                }
              }
              
              // If most questions match (80%+), consider it a duplicate
              if (matchingQuestions >= quiz.questions.length * 0.8) {
                isDuplicate = true;
                console.log(`Found duplicate quiz by title and question similarity: "${quiz.title}"`);
                duplicatesRemoved.push(quiz);
                break;
              }
            }
          }
          
          if (!isDuplicate) {
            // Not a duplicate - add to list of unique quizzes
            processedTitles.get(normalizedTitle)!.push(quiz);
            finalUniqueQuizzes.push(quiz);
          }
        }
      }
      
      // Log results if duplicates were found
      if (duplicatesRemoved.length > 0) {
        console.log(`Removed ${duplicatesRemoved.length} duplicate quizzes`);
        
        // Show toast notification
        toast({
          title: "Duplicate Cleanup",
          description: `Removed ${duplicatesRemoved.length} duplicate quizzes.`,
          variant: "default",
        });
      }
      
      // Log performance
      const endTime = performance.now();
      console.log(`Deduplication completed in ${(endTime - startTime).toFixed(2)}ms`);
      
      return finalUniqueQuizzes;
    });
  }, [toast]);
  
  // Function to create a result card for sharing
  const createResultCard = useCallback(async (quiz: Quiz, attempt: QuizAttempt) => {
    // Create a temporary div to render the result card
    const resultCard = document.createElement('div');
    resultCard.className = 'quiz-result-card';
    resultCard.style.position = 'fixed';
    resultCard.style.top = '-9999px';
    resultCard.style.left = '-9999px';
    resultCard.style.width = '340px';
    resultCard.style.background = '#ffffff';
    resultCard.style.borderRadius = '12px';
    resultCard.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
    resultCard.style.overflow = 'hidden';
    resultCard.style.fontFamily = 'system-ui, -apple-system, sans-serif';
    
    // Calculate percentage
    const percentage = Math.round((attempt.score / attempt.totalQuestions) * 100);
    
    // Set the inner HTML with the result content
    resultCard.innerHTML = `
      <div style="padding: 24px; text-align: center;">
        <div style="margin-bottom: 16px; font-size: 24px; font-weight: bold; color: #4f46e5;">
          Quiz Result
        </div>
        <div style="margin-bottom: 8px; font-size: 18px; font-weight: 500;">
          ${quiz.title}
        </div>
        <div style="display: inline-flex; align-items: center; justify-content: center; width: 100px; height: 100px; border-radius: 50%; background: #eef2ff; margin: 16px 0;">
          <div style="font-size: 28px; font-weight: bold; color: ${
            percentage >= 80 ? '#16a34a' : 
            percentage >= 60 ? '#eab308' : 
            '#dc2626'
          };">
            ${percentage}%
          </div>
        </div>
        <div style="margin-bottom: 16px; font-size: 16px;">
          I scored <b>${attempt.score}/${attempt.totalQuestions}</b> on this quiz!
        </div>
        <div style="color: #6b7280; font-size: 14px;">
          Time taken: ${Math.floor(attempt.timeSpent / 60)}:${(attempt.timeSpent % 60).toString().padStart(2, '0')}
        </div>
        <div style="font-size: 12px; margin-top: 24px; color: #6b7280;">
          BMV Quiz App - ${new Date().toLocaleDateString()}
        </div>
      </div>
    `;
    
    // Add to document temporarily
    document.body.appendChild(resultCard);
    
    try {
      // Generate image using html2canvas
      const canvas = await html2canvas(resultCard, {
        backgroundColor: '#ffffff',
        scale: 2, // Higher scale for better quality
      });
      
      // Convert to data URL
      const imageUrl = canvas.toDataURL('image/png');
      
      // Clean up - remove the temporary element
      document.body.removeChild(resultCard);
      
      return { imageUrl, shareText: `I scored ${attempt.score}/${attempt.totalQuestions} (${percentage}%) on the "${quiz.title}" quiz!` };
    } catch (error) {
      // Clean up in case of error
      if (document.body.contains(resultCard)) {
        document.body.removeChild(resultCard);
      }
      throw error;
    }
  }, []);
  
  // Function to save the image locally
  const saveResultImage = useCallback(async (quiz: Quiz, attempt: QuizAttempt) => {
    try {
      toast({
        title: "Generating Image",
        description: "Creating a shareable image of your results...",
      });
      
      const { imageUrl } = await createResultCard(quiz, attempt);
      
      // Create a download link
      const link = document.createElement('a');
      link.href = imageUrl;
      link.download = `quiz-result-${quiz.title.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      toast({
        title: "Image Saved",
        description: "Your quiz result image has been saved to your device.",
      });
    } catch (error) {
      console.error("Error saving result image:", error);
      toast({
        title: "Image Save Failed",
        description: "Could not save the result image. Please try again.",
        variant: "destructive",
      });
    }
  }, [toast, createResultCard]);
  
  // Function to handle sharing a quiz result on social media
  const handleShareResult = useCallback(async (quiz: Quiz, attempt: QuizAttempt) => {
    try {
      // Show a toast to indicate we're processing
      toast({
        title: "Preparing to share",
        description: "Creating a shareable result image...",
      });
      
      // Generate the image
      const { imageUrl, shareText } = await createResultCard(quiz, attempt);
      
      // Check if the Web Share API is available
      if (navigator.share) {
        try {
          // Convert data URL to blob
          const response = await fetch(imageUrl);
          const blob = await response.blob();
          
          // Create a file from the blob
          const file = new File([blob], 'quiz-result.png', { type: 'image/png' });
          
          // Share the file
          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({
              title: 'Quiz Result',
              text: shareText,
              files: [file]
            });
          } else {
            // Fallback to text-only sharing if file sharing not supported
            await navigator.share({
              title: 'Quiz Result',
              text: shareText
            });
          }
          
          toast({
            title: "Shared",
            description: "Your result has been shared successfully!",
          });
        } catch (shareError) {
          console.error("Error sharing with files:", shareError);
          // Fallback to text-only sharing
          await navigator.share({
            title: 'Quiz Result',
            text: shareText
          });
          toast({
            title: "Shared",
            description: "Your result text has been shared! (Image sharing not supported)",
          });
        }
      } else {
        // Fallback for browsers that don't support the Web Share API
        // Save the image locally
        const link = document.createElement('a');
        link.href = imageUrl;
        link.download = `quiz-result-${quiz.title.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        // Also copy text to clipboard
        await navigator.clipboard.writeText(shareText);
        
        toast({
          title: "Image Saved & Text Copied",
          description: "Result image saved to your device and text copied to clipboard!",
        });
      }
    } catch (error) {
      console.error("Error sharing result:", error);
      toast({
        title: "Share failed",
        description: "Could not share your result. Please try again.",
        variant: "destructive",
      });
    }
  }, [toast, createResultCard]);

  // Handle backup of all quizzes data
  const handleBackupAllData = useCallback(async () => {
    try {
      // Prepare the data for backup - all quizzes with history
      const backupData = {
        quizzes: quizzes,
        exportedAt: new Date(),
        appVersion: "1.0.0",
      };
      
      const jsonString = safeStringify(backupData);
      
      // Make sure to encode the data for backup security
      const encodedData = encodeQuizData(jsonString);
      
      // Use the Android bridge if available (for native app)
      if (window.ExternalStorage) {
        const success = window.ExternalStorage.saveBackup(encodedData);
        if (success) {
          toast({
            title: "Backup Successful",
            description: "Your data has been successfully saved to device storage.",
          });
        } else {
          throw new Error("Android storage error");
        }
      } else {
        // Web browser fallback - download as file
        const blob = new Blob([jsonString], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        
        // Try to use File System Access API if available
        if (window.showSaveFilePicker) {
          try {
            const handle = await window.showSaveFilePicker({
              suggestedName: `bmv-quiz-backup-${new Date().toISOString().slice(0,10)}.json`,
              types: [{
                description: 'JSON Files',
                accept: { 'application/json': ['.json'] },
              }],
            });
            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();
            
            toast({
              title: "बैकअप सफल",
              description: "आपका डेटा सफलतापूर्वक सहेज लिया गया है।",
            });
          } catch (err) {
            // Fall back to regular download if user cancels file picker
            const a = document.createElement("a");
            a.href = url;
            a.download = `bmv-quiz-backup-${new Date().toISOString().slice(0,10)}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            toast({
              title: "बैकअप डाउनलोड",
              description: "आपका बैकअप फाइल डाउनलोड होगी।",
            });
          }
        } else {
          // Regular download for browsers without File System Access API
          const a = document.createElement("a");
          a.href = url;
          a.download = `bmv-quiz-backup-${new Date().toISOString().slice(0,10)}.json`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          
          toast({
            title: "बैकअप डाउनलोड",
            description: "आपका बैकअप फाइल डाउनलोड होगी।",
          });
        }
      }
    } catch (error) {
      console.error("Backup failed:", error);
      toast({
        title: "बैकअप विफल",
        description: "एक त्रुटि के कारण बैकअप नहीं लिया जा सका। कृपया पुन: प्रयास करें।",
        variant: "destructive"
      });
    }
  }, [quizzes, toast]);
  
  // Handle restore from backup
  const handleRestoreFromBackup = useCallback(async () => {
    try {
      // For Android app
      if (window.ExternalStorage) {
        if (window.ExternalStorage.backupExists()) {
          const encodedBackupData = window.ExternalStorage.loadBackup();
          if (encodedBackupData) {
            try {
              // First decode the backup data which should be encoded
              const decodedData = decodeQuizData(encodedBackupData);
              console.log("Successfully decoded backup data");
              
              // Then parse the JSON
              const parsedData = JSON.parse(decodedData);
              if (parsedData.quizzes && Array.isArray(parsedData.quizzes)) {
                // Update the quizzes state with imported data
                setQuizzes(parsedData.quizzes);
                
                // Store in localStorage using the encoded format for consistency
                const dataToStore = encodeQuizData(decodedData);
                localStorage.setItem('quizzes', dataToStore);
                
                toast({
                  title: "बैकअप से पुनर्स्थापित",
                  description: `${parsedData.quizzes.length} क्विज़ सफलतापूर्वक पुनर्स्थापित की गईं।`,
                });
              } else {
                throw new Error("Invalid backup format");
              }
            } catch (error) {
              console.error("Error parsing backup:", error);
              toast({
                title: "पुनर्स्थापना विफल",
                description: "बैकअप डेटा अमान्य है। कृपया वैध बैकअप फाइल का उपयोग करें।",
                variant: "destructive"
              });
            }
          } else {
            toast({
              title: "कोई बैकअप नहीं मिला",
              description: "आपके डिवाइस पर कोई बैकअप नहीं मिला। पहले बैकअप बनाएं।",
              variant: "destructive"
            });
          }
        } else {
          toast({
            title: "कोई बैकअप नहीं मिला",
            description: "आपके डिवाइस पर कोई बैकअप नहीं मिला। पहले बैकअप बनाएं।",
            variant: "destructive"
          });
        }
      } else {
        // Web browser - ask user to upload file
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        
        input.onchange = (e) => {
          const file = (e.target as HTMLInputElement).files?.[0];
          if (!file) {
            return;
          }
          
          const reader = new FileReader();
          reader.onload = (event) => {
            const content = event.target?.result as string;
            try {
              // First try to parse directly - if it's a plain JSON file
              let parsedData: any;
              
              // Check if this might be an encoded backup file
              if (isEncodedQuizData(content)) {
                console.log("Found encoded backup file - decoding first");
                const decodedContent = decodeQuizData(content);
                parsedData = JSON.parse(decodedContent);
              } else {
                // Try direct parsing first
                try {
                  parsedData = JSON.parse(content);
                } catch (parseError) {
                  // If direct parsing failed, try decoding anyway - maybe it's encoded but doesn't have our prefix
                  console.log("Direct parse failed, trying to decode first");
                  const decodedContent = decodeQuizData(content);
                  parsedData = JSON.parse(decodedContent);
                }
              }
              
              if (parsedData.quizzes && Array.isArray(parsedData.quizzes)) {
                // Update the quizzes state with imported data
                setQuizzes(parsedData.quizzes);
                
                // Store in localStorage using the encoded format for consistency and security
                const dataToStore = encodeQuizData(JSON.stringify(parsedData));
                localStorage.setItem('quizzes', dataToStore);
                
                toast({
                  title: "बैकअप से पुनर्स्थापित",
                  description: `${parsedData.quizzes.length} क्विज़ सफलतापूर्वक पुनर्स्थापित की गईं।`,
                });
              } else {
                throw new Error("Invalid backup format");
              }
            } catch (error) {
              console.error("Error parsing backup:", error);
              toast({
                title: "पुनर्स्थापना विफल",
                description: "बैकअप डेटा अमान्य है। कृपया वैध बैकअप फाइल का उपयोग करें।",
                variant: "destructive"
              });
            }
          };
          reader.readAsText(file);
        };
        
        input.click();
      }
    } catch (error) {
      console.error("Restore failed:", error);
      toast({
        title: "पुनर्स्थापना विफल",
        description: "एक त्रुटि के कारण पुनर्स्थापना नहीं की जा सकी। कृपया पुन: प्रयास करें।",
        variant: "destructive"
      });
    }
  }, [toast, setQuizzes])

  // Helper function to save data to localStorage with chunking support
  const saveToLocalStorage = (key: string, data: any) => {
    try {
      // First convert Dates to ISO strings to ensure proper serialization
      const preparedData = JSON.parse(JSON.stringify(data));
      const jsonString = JSON.stringify(preparedData);

      // Debug log to verify serialization
      console.log(`Saving data with key ${key}, size: ${jsonString.length} bytes`);

      // If data is small enough, save directly
      if (jsonString.length < 2000000) { // ~2MB safety threshold
        localStorage.setItem(key, jsonString);
        // Clean up any chunks from previous saves
        for (let i = 0; i < 20; i++) {
          const chunkKey = `${key}_chunk_${i}`;
          if (localStorage.getItem(chunkKey)) {
            localStorage.removeItem(chunkKey);
          } else {
            break;
          }
        }

        // Also clean up the chunks metadata if it exists
        if (localStorage.getItem(`${key}_chunks`)) {
          localStorage.removeItem(`${key}_chunks`);
        }

        console.log(`Saved data normally to key: ${key}`);
        return true;
      }

      // For large data, split into chunks
      const chunkSize = 1000000; // ~1MB chunks
      const chunks = Math.ceil(jsonString.length / chunkSize);

      console.log(`Data too large. Splitting into ${chunks} chunks.`);

      // Store metadata
      localStorage.setItem(`${key}_chunks`, chunks.toString());

      // Store each chunk
      for (let i = 0; i < chunks; i++) {
        const start = i * chunkSize;
        const end = start + chunkSize;
        const chunk = jsonString.substring(start, end);
        localStorage.setItem(`${key}_chunk_${i}`, chunk);
      }

      // Store a small indicator in the main key
      localStorage.setItem(key, `__CHUNKED__${chunks}`);
      console.log(`Saved data in ${chunks} chunks with key: ${key}`);
      return true;
    } catch (error) {
      console.error("Storage error:", error);
      if (error instanceof Error) {
        toast({
          title: "Storage Error",
          description: "Could not save data: " + error.message,
          variant: "destructive",
        });
      }
      return false;
    }
  }

  // This comment marks where the loadFromLocalStorage function was previously defined
  // The function is now defined at the top of the component to fix initialization order issues

  // Function to compress base64 images for smaller export files
  const optimizeImages = (quizzesList: Quiz[]) => {
    // Lower threshold to aggressively compress all images
    const MAX_IMAGE_SIZE = 50000 // ~50KB threshold for aggressive compression

    return quizzesList.map(quiz => {
      // Deep clone to avoid modifying the original
      const optimizedQuiz = JSON.parse(JSON.stringify(quiz));

      // Process each question
      optimizedQuiz.questions = optimizedQuiz.questions.map((question: Question) => {
        // Always compress every image to reduce export size
        const optimizedQuestionImages = question.questionImages.map((img: string) => {
          if (img && img.startsWith('data:image')) {
            // Determine compression level based on size
            if (img.length > MAX_IMAGE_SIZE * 4) {
              // Very large images get more compression
              return compressBase64Image(img, 0.3, 800); // 30% quality, max 800px
            } else if (img.length > MAX_IMAGE_SIZE) {
              // Large images get medium compression
              return compressBase64Image(img, 0.5, 1000); // 50% quality, max 1000px
            } else {
              // Smaller images still get some compression
              return compressBase64Image(img, 0.7, 1200); // 70% quality, max 1200px
            }
          }
          return img;
        });

        // Optimize answer images with the same approach
        const optimizedAnswerImages = question.answerImages.map((img: string) => {
          if (img && img.startsWith('data:image')) {
            if (img.length > MAX_IMAGE_SIZE * 4) {
              return compressBase64Image(img, 0.3, 800);
            } else if (img.length > MAX_IMAGE_SIZE) {
              return compressBase64Image(img, 0.5, 1000);
            } else {
              return compressBase64Image(img, 0.7, 1200);
            }
          }
          return img;
        });

        return {
          ...question,
          questionImages: optimizedQuestionImages,
          answerImages: optimizedAnswerImages
        };
      });

      return optimizedQuiz;
    });
  }

  // Function to sync public quizzes with the server
  const syncPublicQuizzesWithServer = useCallback(async () => {
    try {
      // IMPORTANT: Filter quizzes marked as public - ONLY these should be synced to server
      // This is the main fix for the privacy issue
      const publicQuizzes = quizzes.filter(quiz => quiz.isPublic === true);
      
      if (publicQuizzes.length === 0) {
        console.log("No public quizzes to sync with server");
        toast({
          title: "No Public Quizzes",
          description: "You don't have any public quizzes to share. Make a quiz public first.",
        });
        return;
      }
      
      console.log(`Syncing ${publicQuizzes.length} public quizzes with server`);
      
      // Show toast for better feedback
      toast({
        title: "Syncing Quizzes...",
        description: `Sharing ${publicQuizzes.length} quizzes with the server...`,
      });
      
      // Ensure each quiz has a uniqueId (use the uniqueId or generate a new one)
      const preparedQuizzes = publicQuizzes.map(quiz => {
        if (!quiz.uniqueId) {
          // If no uniqueId, create one and update the quiz locally too
          const newUniqueId = crypto.randomUUID();
          
          // Update the uniqueId in the quiz object
          quiz.uniqueId = newUniqueId;
          
          console.log(`Generated new uniqueId ${newUniqueId} for quiz "${quiz.title}"`);
        }
        
        // Double-check this quiz is actually marked as public
        if (!quiz.isPublic) {
          console.warn(`Quiz ${quiz.title} is not marked as public but was included in publicQuizzes - skipping`);
          return null;
        }
        
        return quiz;
      }).filter(quiz => quiz !== null) as Quiz[]; // Filter out any null entries
      
      // Exit if there are no public quizzes after filtering
      if (preparedQuizzes.length === 0) {
        console.log("No public quizzes to sync after filtering");
        return;
      }
      
      // Log the quizzes we're sending to the server
      console.log("Prepared quizzes being sent to server:", 
        preparedQuizzes.map(q => ({ 
          title: q.title, 
          uniqueId: q.uniqueId,
          isPublic: q.isPublic
        }))
      );
      
      // Send the quizzes to the server for syncing
      const response = await apiRequest("/api/quizzes/sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache", // Ensure we don't get cached response
          "Pragma": "no-cache"
        },
        body: JSON.stringify({ quizzes: preparedQuizzes }),
      });
      
      console.log("Server sync response:", response);
      
      // Check if the server returned quizzes
      if (response && Array.isArray(response)) {
        toast({
          title: "Sync Complete",
          description: `Successfully shared ${publicQuizzes.length} quizzes with other users. The server now has ${response.length} public quizzes.`,
        });
        
        // Log server quizzes for debugging
        console.log("All public quizzes on server after sync:", 
          response.map(q => ({ 
            title: q.title, 
            uniqueId: q.uniqueId,
            isPublic: q.isPublic 
          }))
        );
      } else {
        toast({
          title: "Sync Warning",
          description: "Quizzes were sent to the server, but response was unexpected.",
          variant: "destructive"
        });
      }
    } catch (error) {
      console.error("Failed to sync quizzes with server:", error);
      toast({
        title: "Sync Error",
        description: "Failed to share quizzes with the server. Please try again.",
        variant: "destructive",
      });
    }
  }, [quizzes, toast]);
  
  // Function to manually clean up duplicate quizzes on the server
  const cleanupServerDuplicates = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/quizzes/cleanup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error('Failed to clean up server-side duplicates');
      }
      
      const result = await response.json();
      
      if (result.removedCount > 0) {
        toast({
          title: 'Server Cleanup Successful',
          description: `Removed ${result.removedCount} duplicate quizzes from the server.`,
        });
        
        // If we removed duplicates, also clean up local quizzes
        // that might reference the removed server quizzes
        setQuizzes(prevQuizzes => {
          // First get updated server quizzes
          apiRequest("/api/quizzes", {
            method: "GET",
            headers: {
              "Cache-Control": "no-cache",
              "Pragma": "no-cache"
            }
          }).then(serverQuizzes => {
            if (serverQuizzes && Array.isArray(serverQuizzes)) {
              // Create a set of valid server uniqueIds
              const validServerUniqueIds = new Set(
                serverQuizzes.map(q => q.uniqueId)
              );
              
              // Filter out local quizzes with uniqueIds that no longer exist on server
              // Keep all quizzes without uniqueIds (local-only quizzes)
              setQuizzes(currentQuizzes => 
                currentQuizzes.filter(quiz => 
                  !quiz.uniqueId || validServerUniqueIds.has(quiz.uniqueId)
                )
              );
            }
          }).catch(err => {
            console.error("Failed to refresh quizzes after cleanup:", err);
          });
          
          // Return the original list for now, we'll update it after getting server data
          return prevQuizzes;
        });
      } else {
        toast({
          title: 'Server Cleanup',
          description: 'No duplicate quizzes found on the server.',
        });
      }
      
    } catch (error) {
      console.error('Error cleaning up server duplicates:', error);
      toast({
        title: 'Server Cleanup Failed',
        description: 'Could not clean up duplicate quizzes on the server.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  // Function to fetch public quizzes from the server
  const fetchPublicQuizzesFromServer = useCallback(async () => {
    try {
      console.log("Fetching public quizzes from server");
      
      // Show loading toast for better user feedback
      toast({
        title: "Fetching Quizzes...",
        description: "Downloading shared quizzes from the server...",
      });
      
      // Get public quizzes from the server
      const serverQuizzes = await apiRequest("/api/quizzes", {
        method: "GET",
        // Add a cache-busting parameter to ensure fresh data
        headers: {
          "Cache-Control": "no-cache",
          "Pragma": "no-cache"
        }
      });
      
      if (!serverQuizzes || !Array.isArray(serverQuizzes)) {
        console.log("No public quizzes available on server or invalid response");
        toast({
          title: "No Public Quizzes",
          description: "No public quizzes are currently available on the server.",
        });
        return;
      }
      
      // Log the raw server response for debugging
      console.log("Raw server quizzes:", serverQuizzes);
      console.log(`Retrieved ${serverQuizzes.length} public quizzes from server`);
      
      // Merge server quizzes with local quizzes (don't duplicate)
      setQuizzes(prevQuizzes => {
        // Create maps for tracking duplicates 
        const localUniqueIds = new Set();
        const localContentHashes = new Map();
        const localTitles = new Map();
        
        // First, build maps of existing local quizzes for duplicate detection
        prevQuizzes.forEach(quiz => {
          // Track uniqueIds
          if (quiz.uniqueId) {
            localUniqueIds.add(quiz.uniqueId);
          }
          
          // Track content hashes for content-based duplicate detection
          const contentHash = createQuizContentHash(quiz);
          localContentHashes.set(contentHash, quiz);
          
          // Track titles for title-based duplicate detection
          const titleNormalized = quiz.title.toLowerCase().trim();
          if (!localTitles.has(titleNormalized)) {
            localTitles.set(titleNormalized, []);
          }
          localTitles.get(titleNormalized).push(quiz);
        });
        
        console.log("Local uniqueIds:", Array.from(localUniqueIds));
        console.log("Server quiz uniqueIds:", serverQuizzes.map(q => q.uniqueId));
        
        // Process server quizzes with enhanced duplicate detection
        const newServerQuizzes = serverQuizzes
          .filter(serverQuiz => {
            // Skip quizzes that already exist locally by uniqueId
            if (serverQuiz.uniqueId && localUniqueIds.has(serverQuiz.uniqueId)) {
              console.log(`Skipping quiz "${serverQuiz.title}" with uniqueId ${serverQuiz.uniqueId} as it already exists locally`);
              return false;
            }
            
            // Check for content-based duplicates
            const contentHash = createQuizContentHash(serverQuiz);
            if (localContentHashes.has(contentHash)) {
              console.log(`Skipping quiz "${serverQuiz.title}" as a similar quiz already exists locally (content match)`);
              return false;
            }
            
            // Check for title-based duplicates with similar question content
            const titleNormalized = serverQuiz.title.toLowerCase().trim();
            if (localTitles.has(titleNormalized)) {
              const quizzesWithSameTitle = localTitles.get(titleNormalized);
              
              // If we have quizzes with the same title, check if they have similar questions
              for (const localQuiz of quizzesWithSameTitle) {
                // Skip if they have different numbers of questions
                if (Math.abs(localQuiz.questions.length - serverQuiz.questions.length) > 1) {
                  continue;
                }
                
                // Check for similar questions
                let matchingQuestions = 0;
                
                for (const localQuestion of localQuiz.questions) {
                  for (const serverQuestion of serverQuiz.questions) {
                    const localQuestionText = localQuestion.question.toLowerCase().trim();
                    const serverQuestionText = serverQuestion.question.toLowerCase().trim();
                    
                    // Check if questions are similar
                    if (
                      localQuestionText === serverQuestionText ||
                      localQuestionText.includes(serverQuestionText) ||
                      serverQuestionText.includes(localQuestionText)
                    ) {
                      matchingQuestions++;
                      break;
                    }
                  }
                }
                
                // If more than 70% of questions match, consider it a duplicate
                const threshold = Math.min(localQuiz.questions.length, serverQuiz.questions.length) * 0.7;
                if (matchingQuestions >= threshold) {
                  console.log(`Skipping quiz "${serverQuiz.title}" as a similar quiz with the same title and similar questions already exists locally`);
                  return false;
                }
              }
            }
            
            // If we passed all duplicate checks, keep this quiz
            console.log(`Adding new quiz "${serverQuiz.title}" with uniqueId ${serverQuiz.uniqueId} from server`);
            return true;
          })
          .map(quiz => ({
            ...quiz,
            // Use server uniqueId as client id if not present
            id: quiz.id || quiz.uniqueId,
            // Convert date strings to Date objects
            createdAt: quiz.createdAt ? new Date(quiz.createdAt) : new Date(),
            lastTaken: quiz.lastTaken ? new Date(quiz.lastTaken) : undefined,
            history: quiz.history ? quiz.history.map((attempt: QuizAttempt) => ({
              ...attempt,
              date: new Date(attempt.date)
            })) : []
          }));
        
        if (newServerQuizzes.length > 0) {
          toast({
            title: "Quizzes Updated",
            description: `Downloaded ${newServerQuizzes.length} new shared quizzes.`,
          });
          return [...prevQuizzes, ...newServerQuizzes];
        } else {
          toast({
            title: "No New Quizzes",
            description: "You're already up-to-date with all shared quizzes.",
          });
          console.log("No new quizzes to import from server");
          return prevQuizzes;
        }
      });
    } catch (error) {
      console.error("Failed to fetch public quizzes from server:", error);
      toast({
        title: "Fetch Error",
        description: "Failed to get public quizzes from the server. Please try again.",
        variant: "destructive",
      });
    }
  }, [toast, createQuizContentHash]);

  // Save quizzes to localStorage whenever they change
  useEffect(() => {
    try {
      // First, make sure we have quizzes to save
      if (quizzes.length === 0) return;

      // Then optimize images if there are any to reduce storage size
      const optimizedQuizzes = optimizeImages(quizzes)

      // Always use our saveToLocalStorage function which handles both small and large datasets
      const saveSuccess = saveToLocalStorage('quizzes', optimizedQuizzes);

      // Save to Android external storage (if available) for persistent backup
      if (window.ExternalStorage && saveSuccess) {
        try {
          // Create a JSON string of the optimized quizzes
          const jsonString = JSON.stringify(optimizedQuizzes);
          
          // Save to external storage using the Android bridge
          const backupSuccess = window.ExternalStorage.saveBackup(jsonString);
          
          if (backupSuccess) {
            console.log("Successfully backed up quizzes to external storage");
          } else {
            console.warn("Failed to back up quizzes to external storage");
          }
        } catch (backupError) {
          console.error("Error during external storage backup:", backupError);
        }
      }

      if (!saveSuccess) {
        // If saving fails completely, show a more detailed error
        toast({
          title: "Storage Full",
          description: "Unable to save quizzes - storage is full. Try removing some quizzes or images.",
          variant: "destructive",
        });
      }
      
      // Sync public quizzes with the server
      // We add a small delay to avoid excessive API calls and allow batching
      // IMPORTANT: Make sure we strictly filter by isPublic === true to avoid privacy issues
      const publicQuizzes = quizzes.filter(quiz => quiz.isPublic === true);
      if (publicQuizzes.length > 0) {
        console.log(`Scheduling sync for ${publicQuizzes.length} public quizzes`);
        const timeoutId = setTimeout(() => {
          syncPublicQuizzesWithServer();
        }, 1000);
        
        return () => clearTimeout(timeoutId);
      } else {
        console.log("No public quizzes to sync - skipping automatic sync");
      }
    } catch (error) {
      console.error("Failed to save quizzes:", error)
      toast({
        title: "Save Error",
        description: "There was a problem saving your quizzes. Your recent changes might not be saved.",
        variant: "destructive",
      })
    }
  }, [quizzes, toast, syncPublicQuizzesWithServer])

  // Load quizzes from localStorage on component mount
  useEffect(() => {
    const loadInitialQuizzes = async () => {
      try {
        console.log("Loading quizzes from localStorage on initial mount");
        const savedQuizzes = loadFromLocalStorage('quizzes', []);
  
        if (savedQuizzes && Array.isArray(savedQuizzes) && savedQuizzes.length > 0) {
          // Convert date strings back to Date objects
          const processedQuizzes = savedQuizzes.map(quiz => ({
            ...quiz,
            createdAt: new Date(quiz.createdAt),
            lastTaken: quiz.lastTaken ? new Date(quiz.lastTaken) : undefined,
            history: quiz.history ? quiz.history.map((attempt: QuizAttempt) => ({
              ...attempt,
              date: new Date(attempt.date)
            })) : []
          }));
  
          console.log(`Loaded ${processedQuizzes.length} quizzes from localStorage`);
          setQuizzes(processedQuizzes);
  
          // Show toast only once during initial load
          toast({
            title: "Quizzes Loaded",
            description: `Successfully loaded ${processedQuizzes.length} quizzes.`,
          });
          
          // After loading local quizzes, run duplicate detection with a slight delay
          setTimeout(() => {
            removeDuplicateQuizzes();
          }, 2000);
        } else {
          console.log("No quizzes found in localStorage");
        }
        
        // Fetch public quizzes only once regardless of local quiz state
        if (!publicQuizzesLoadedRef.current) {
          publicQuizzesLoadedRef.current = true;
          fetchPublicQuizzesFromServer();
        }
      } catch (error) {
        console.error("Failed to load quizzes from localStorage:", error);
        toast({
          title: "Load Error",
          description: "There was a problem loading your saved quizzes.",
          variant: "destructive",
        });
        
        // Try to fetch public quizzes even if local loading failed but only once
        if (!publicQuizzesLoadedRef.current) {
          publicQuizzesLoadedRef.current = true;
          fetchPublicQuizzesFromServer();
        }
      }
    };
    
    // Execute the loading function only once on mount
    loadInitialQuizzes();
    
    // Empty dependency array means this effect runs once on mount
    // We're using the function reference inside instead of as a dependency
  }, []);

  // Create a ref for the audio element
  const timerAudioRef = React.useRef<HTMLAudioElement | null>(null);

  // Initialize the audio element on component mount
  useEffect(() => {
    // Use a simple beep sound that should work on mobile browsers
    // Short beep sound, more compatible with mobile devices
    timerAudioRef.current = new Audio("data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tAwAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAAFWgD///////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAUHAAAAAAAABVqOgFVxAAAAAAD/+xDEAAAKoAF39BEAIqgAL38AJgQ5/8+OYgQCmIEJpwoYH/ypCgCqSMFX7ECK1hGteu9PCVlG6qv/QQYqbn/7Bx7G///4BgRIv///9qUZUenUG3bcAJGQ8yzLM1IESFUilDJEi2Q5u7/+7DERABB0AFN9ASACLAAKP6AkQCyldTdaKdxUh2Lv+2BDCP8h/+sY////5wXgD/6w6f//0JoqYJYm5EVMXETcE0MiYgAAAAAzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzP/+xDEMQAGGAFB9AAAIogAqf5gIgAzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMz");
    
    // Preload the audio for better mobile support
    if (timerAudioRef.current) {
      // Try to play and immediately pause to allow mobile devices to play later
      timerAudioRef.current.volume = 0.5;
      const playPromise = timerAudioRef.current.play();
      
      if (playPromise !== undefined) {
        playPromise.then(() => {
          // Audio playback started successfully
          timerAudioRef.current?.pause();
          timerAudioRef.current?.load();
        }).catch(e => {
          // Auto-play was prevented, but at least we tried to initialize
          console.log("Audio preload prevented by browser:", e);
        });
      }
    }
    
    return () => {
      if (timerAudioRef.current) {
        timerAudioRef.current.pause();
        timerAudioRef.current = null;
      }
    };
  }, []);
  
  // Extract all unique categories from quizzes for the filter dropdown
  useEffect(() => {
    // Convert to array to handle TS downlevelIteration flag issue 
    const categorySet = new Set<string>();
    quizzes.forEach(quiz => {
      if (quiz.category) {
        categorySet.add(quiz.category);
      }
    });
    setAllCategories(Array.from(categorySet));
  }, [quizzes]);
  
  // Function to calculate string similarity for fuzzy search
  const calculateSimilarity = (str1: string, str2: string): number => {
    str1 = str1.toLowerCase();
    str2 = str2.toLowerCase();
    
    // If exact match, return highest similarity
    if (str1 === str2) return 1;
    
    // If either string contains the other, high similarity
    if (str1.includes(str2) || str2.includes(str1)) return 0.8;
    
    // Calculate Levenshtein distance
    const len1 = str1.length;
    const len2 = str2.length;
    
    // Maximum string length to compare
    const maxLen = Math.max(len1, len2);
    
    // If one string is empty, similarity is 0
    if (maxLen === 0) return 0;
    
    // Simple character matching
    let matches = 0;
    const minLen = Math.min(len1, len2);
    
    // Count matching characters
    for (let i = 0; i < minLen; i++) {
      if (str1[i] === str2[i]) matches++;
    }
    
    // Calculate similarity as a ratio of matches to max length
    return matches / maxLen;
  };
  
  // Filter quizzes based on search query and category selection
  const filteredQuizzes = useMemo(() => {
    return quizzes.filter((quiz) => {
      // First filter by category if selected
      if (selectedCategory && quiz.category !== selectedCategory) {
        return false;
      }
      
      // If no search query, just return category-filtered results
      if (!searchQuery) return true;
      
      // Check title and description for fuzzy matches
      const titleSimilarity = calculateSimilarity(quiz.title, searchQuery);
      const descSimilarity = calculateSimilarity(quiz.description, searchQuery);
      
      // Return if either title or description has good similarity
      // Threshold of 0.3 means it will catch similar words and typos
      return titleSimilarity > 0.3 || descSimilarity > 0.3;
    });
  }, [quizzes, searchQuery, selectedCategory]);

  useEffect(() => {
    if (isQuizRunning && timer > 0) {
      const interval = setInterval(() => {
        setTimer((prevTimer) => {
          // Play sound when timer is 30 seconds or less
          if (prevTimer <= 31 && prevTimer > 1 && timerAudioRef.current) {
            timerAudioRef.current.play().catch(e => console.error("Error playing timer sound:", e));
          }
          return prevTimer - 1;
        });
      }, 1000)
      return () => clearInterval(interval)
    } else if (timer === 0 && isQuizRunning) {
      finishQuiz()
    }
  }, [isQuizRunning, timer])

  const handleAddQuestion = () => {
    setNewQuestions((prev) => [
      ...prev,
      {
        question: '',
        answerDescription: '',
        options: ['', '', '', ''],
        correctAnswer: '',
        questionImages: [],
        answerImages: [],
      },
    ])
  }

  const handleQuestionChange = (index: number, field: keyof Question, value: string) => {
    setNewQuestions((prev) =>
      prev.map((q, i) => (i === index ? { ...q, [field]: value } : q))
    )
  }

  const handleOptionChange = (index: number, optionIndex: number, value: string) => {
    setNewQuestions((prev) =>
      prev.map((q, i) =>
        i === index
          ? {
              ...q,
              options: q.options.map((opt, optIdx) => (optIdx === optionIndex ? value : opt)),
            }
          : q
      )
    )
  }

  const handleCorrectAnswerChange = (index: number, value: string) => {
    setNewQuestions((prev) =>
      prev.map((q, i) => (i === index ? { ...q, correctAnswer: value } : q))
    )
  }

  const handleDeleteQuestion = (index: number) => {
    setNewQuestions((prev) => prev.filter((_, i) => i !== index))
  }

  const handleStartQuiz = (quiz: Quiz) => {
    const now = new Date()
    if (quiz.lastTaken) {
      const lastTaken = new Date(quiz.lastTaken)
      const timeDifference = now.getTime() - lastTaken.getTime()
      const tenMinutes = 10 * 60 * 1000
      if (timeDifference < tenMinutes) {
        toast({
          title: "Quiz Cooldown",
          description: "You can retake this quiz after 10 minutes.",
          variant: "destructive",
        })
        return
      }
    }
    setCurrentQuiz(quiz)
    setCurrentQuestionIndex(0)
    setSelectedAnswers(new Array(quiz.questions.length).fill(''))
    setScore(0)
    setTimer(quiz.timer)
    setIsQuizRunning(true)
    setShowResults(false)
    setIsQuizModalOpen(true)
  }

  const handleAnswer = (selectedOption: string) => {
    setSelectedAnswers((prev) => {
      const newAnswers = [...prev]
      newAnswers[currentQuestionIndex] = selectedOption
      return newAnswers
    })
  }

  // Function to navigate to the previous question
  const previousQuestion = () => {
    if (currentQuestionIndex > 0) {
      // Add loading animation
      setLoadingQuestion(true)
      
      // Update progress bar style for backwards movement
      setProgressBarColor("bg-amber-400")
      setProgressBarPattern("animate-pulse")
      
      // Short delay before changing the question to show animation
      setTimeout(() => {
        setCurrentQuestionIndex(currentQuestionIndex - 1)
        setLoadingQuestion(false)
        
        // Reset progress bar style after a short delay
        setTimeout(() => {
          setProgressBarColor("bg-primary")
          setProgressBarPattern("")
        }, 300)
      }, 400)
    }
  }
  
  // Function to navigate to the next question or finish the quiz
  const nextQuestion = () => {
    if (currentQuestionIndex < currentQuiz?.questions.length! - 1) {
      // Add loading animation
      setLoadingQuestion(true)
      
      // Update progress bar style for forward movement
      setProgressBarColor("bg-green-400")
      setProgressBarPattern("animate-pulse")
      
      // Short delay before changing the question to show animation
      setTimeout(() => {
        setCurrentQuestionIndex(currentQuestionIndex + 1)
        setLoadingQuestion(false)
        
        // Reset progress bar style after a short delay
        setTimeout(() => {
          setProgressBarColor("bg-primary")
          setProgressBarPattern("")
        }, 300)
      }, 400)
    } else {
      // Finish the quiz with a celebratory animation
      setProgressBarColor("bg-green-500")
      setProgressBarPattern("animate-bounce")
      
      setTimeout(() => {
        finishQuiz()
      }, 500)
    }
  }

  const finishQuiz = () => {
    setIsQuizRunning(false)
    setShowResults(true)

    if (currentQuiz) {
      // Calculate the score first
      const newScore = currentQuiz.questions.reduce((acc, question, index) => {
        return acc + (selectedAnswers[index] === question.correctAnswer ? 1 : 0)
      }, 0)

      setScore(newScore)

      const now = new Date();
      const timeSpent = currentQuiz.timer - timer;

      // Create question results for history tracking
      const questionResults = currentQuiz.questions.map((question, index) => {
        const userAnswer = selectedAnswers[index] || '';
        return {
          question: question.question,
          userAnswer: userAnswer,
          correctAnswer: question.correctAnswer,
          isCorrect: userAnswer === question.correctAnswer
        };
      });

      // Generate a unique ID for sharing this result
      const shareId = uuidv4();

      // Create a new quiz attempt record with the calculated score and question results
      const newAttempt: QuizAttempt = {
        date: now,
        score: newScore,
        totalQuestions: currentQuiz.questions.length,
        timeSpent: timeSpent,
        questionResults: questionResults,
        shareId: shareId
      };

      setQuizzes((prev) =>
        prev.map((quiz) =>
          quiz.title === currentQuiz.title && quiz.description === currentQuiz.description
            ? { 
                ...quiz, 
                lastTaken: now,
                // Add the new attempt to history array
                history: [...(quiz.history || []), newAttempt]
              }
            : quiz
        )
      )
    }
  }

  // Score calculation is now handled directly in finishQuiz

  const resetQuiz = () => {
    setCurrentQuiz(null)
    setCurrentQuestionIndex(0)
    setSelectedAnswers([])
    setScore(0)
    setTimer(0)
    setIsQuizRunning(false)
    setShowResults(false)
    setIsQuizModalOpen(false)
  }

  const handleImportQuiz = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = (e) => {
        const content = e.target?.result
        if (typeof content === 'string') {
          try {
            // Log for debugging
            console.log(`Received file content, length: ${content.length} characters`);
            console.log(`File starts with: ${content.substring(0, 30)}...`);
            
            // Check if the content is encoded or might be encoded
            let decodedContent = content;
            
            // Try to detect encoded data with more relaxed checks
            if (content.includes("BMVQUIZ") || 
                content.startsWith("BMV") || 
                isEncodedQuizData(content) || 
                /^[A-Za-z0-9+/=]+$/.test(content)) {
              
              try {
                // Always try to decode with our enhanced decoder
                decodedContent = decodeQuizData(content);
                console.log(`Attempted to decode content, result starts with: ${decodedContent.substring(0, 30)}...`);
              } catch (decodeError) {
                console.error("Decoding error:", decodeError);
                // Continue with the original content if decoding fails
                decodedContent = content;
              }
            }
            
            // Try parsing the result as JSON
            let importedQuizzes;
            try {
              importedQuizzes = JSON.parse(decodedContent);
            } catch (jsonError) {
              console.error("JSON parse error:", jsonError);
              
              // Try one more time with the original content if decoding failed
              if (decodedContent !== content) {
                try {
                  importedQuizzes = JSON.parse(content);
                  console.log("Parsed original content successfully");
                } catch (retryError) {
                  console.error("Retry JSON parse error:", retryError);
                  throw new Error("Could not parse file content as JSON");
                }
              } else {
                throw jsonError; // Re-throw the original error
              }
            }
            
            // Ensure the parsed data is an array
            if (!Array.isArray(importedQuizzes)) {
              if (typeof importedQuizzes === 'object' && importedQuizzes !== null) {
                importedQuizzes = [importedQuizzes]; // Single quiz
              } else {
                throw new Error("Imported data is not a quiz or array of quizzes");
              }
            }
            
            // Filter out quizzes that already exist
            const newQuizzes = importedQuizzes.filter((quiz: Quiz) => {
              return !quizzes.some(
                (existingQuiz) =>
                  existingQuiz.title === quiz.title && existingQuiz.description === quiz.description
              )
            })
            
            if (newQuizzes.length === 0) {
              toast({
                title: "Import failed",
                description: "All quizzes already exist.",
                variant: "destructive",
              })
            } else {
              // Make sure each quiz has an ID if importing from older format
              const validatedQuizzes = newQuizzes.map((quiz: Partial<Quiz>) => ({
                ...quiz,
                id: quiz.id || uuidv4(),
                createdAt: quiz.createdAt ? new Date(quiz.createdAt) : new Date(),
                isPublic: quiz.isPublic !== undefined ? quiz.isPublic : false,
                version: quiz.version || 1,
                // Ensure required fields exist
                title: quiz.title || "Imported Quiz",
                description: quiz.description || "",
                // Support for category
                category: (quiz.category && ['General Knowledge', 'Mathematics', 'Science', 'Reasoning'].includes(quiz.category as string)) 
                  ? (quiz.category as QuizCategory) 
                  : "General Knowledge",
                timer: quiz.timer || 300,
                questions: Array.isArray(quiz.questions) ? quiz.questions : []
              }))

              // Log successful validation
              console.log(`Successfully validated ${validatedQuizzes.length} quizzes`);
              
              setQuizzes((prev) => [...prev, ...validatedQuizzes])
              toast({
                title: "Import successful",
                description: `${validatedQuizzes.length} new quizzes imported.`,
                variant: "default",
              })
            }
          } catch (error) {
            console.error("Import error:", error)
            toast({
              title: "Import failed",
              description: error instanceof Error ? error.message : "Invalid file format. Please check if the file is valid.",
              variant: "destructive",
            })
          }
        }
      }
      reader.readAsText(file)
    }
  }

  const handleImportJson = () => {
    try {
      // Trim whitespace and handle empty input
      const trimmedJson = importJson.trim();
      if (!trimmedJson) {
        toast({
          title: "Empty Input",
          description: "Please enter JSON data to import.",
          variant: "destructive",
        });
        return;
      }

      // First determine if content is encoded and needs decoding
      let decodedContent = trimmedJson;
      let contentType = "regular";

      // Try to detect encoded data with more relaxed checks
      if (trimmedJson.includes("BMVQUIZ") || 
          trimmedJson.startsWith("BMV") || 
          isEncodedQuizData(trimmedJson) || 
          /^[A-Za-z0-9+/=]+$/.test(trimmedJson)) {
        
        contentType = "encoded";
        try {
          // Always try to decode even if it doesn't have the proper prefix
          // Our improved decodeQuizData will handle this gracefully
          decodedContent = decodeQuizData(trimmedJson);
          console.log("Attempted to decode potentially encoded data");
          
          // Log the first part of the decoded content for debugging
          const preview = decodedContent.substring(0, 50);
          console.log("Decoded content preview:", preview);
          
          // Simple validation - check if it looks like JSON
          if (!(decodedContent.startsWith('{') || decodedContent.startsWith('[')) &&
              !(decodedContent.endsWith('}') || decodedContent.endsWith(']'))) {
            
            console.warn("Decoded content doesn't look like valid JSON");
            
            // Fallback: try simple JSON parse first for better errors
            try {
              JSON.parse(decodedContent);
            } catch (jsonError) {
              console.error("JSON validation error on decoded content:", jsonError);
              
              // If that fails, try the original content as a last resort
              try {
                JSON.parse(trimmedJson);
                decodedContent = trimmedJson; // Use original if it's valid JSON
                contentType = "regular";
              } catch {
                // Keep using the decoded content and hope for the best
              }
            }
          }
        } catch (decodeError) {
          console.error("Decoding error:", decodeError);
          // Don't fail immediately, try with the original content
          decodedContent = trimmedJson;
          contentType = "regular";
        }
      }

      console.log(`Attempting to parse ${contentType} JSON data`);

      // Parse the JSON content
      let importedQuizzes;
      try {
        importedQuizzes = JSON.parse(decodedContent);
      } catch (parseError) {
        console.error("JSON parsing error:", parseError);
        
        // Special case for common copy-paste error with quotes
        if (decodedContent.startsWith('"') && decodedContent.endsWith('"')) {
          try {
            // Try removing the outer quotes and parse again
            const unquoted = decodedContent.substring(1, decodedContent.length - 1);
            const unescaped = unquoted.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
            importedQuizzes = JSON.parse(unescaped);
            console.log("Successfully parsed after removing outer quotes");
          } catch (retryError) {
            console.error("Retry parsing error:", retryError);
            toast({
              title: "JSON Parse Error",
              description: "The data is not valid JSON. Please check the format.",
              variant: "destructive",
            });
            return;
          }
        } else {
          toast({
            title: "JSON Parse Error",
            description: "The data is not valid JSON. Please check the format.",
            variant: "destructive",
          });
          return;
        }
      }

      // Ensure the parsed data is an array
      if (!Array.isArray(importedQuizzes)) {
        // If it's a single quiz object, wrap it in an array
        if (typeof importedQuizzes === 'object' && importedQuizzes !== null) {
          importedQuizzes = [importedQuizzes];
        } else {
          toast({
            title: "Invalid Format",
            description: "The imported data is not in the expected quiz format.",
            variant: "destructive",
          });
          return;
        }
      }

      // Filter out quizzes that already exist
      const newQuizzes = importedQuizzes.filter((quiz: Quiz) => {
        return !quizzes.some(
          (existingQuiz) =>
            existingQuiz.title === quiz.title && existingQuiz.description === quiz.description
        );
      });

      if (newQuizzes.length === 0) {
        toast({
          title: "Import failed",
          description: "All quizzes already exist.",
          variant: "destructive",
        });
        return;
      }

      // Validate and fix each quiz
      const validatedQuizzes = newQuizzes.map((quiz: Partial<Quiz>) => ({
        ...quiz,
        id: quiz.id || uuidv4(),
        createdAt: quiz.createdAt ? new Date(quiz.createdAt) : new Date(),
        isPublic: quiz.isPublic !== undefined ? quiz.isPublic : false,
        version: quiz.version || 1,
        // Ensure required fields exist
        title: quiz.title || "Imported Quiz",
        description: quiz.description || "",
        // Support for category and password in imported JSON
        category: (quiz.category && ['General Knowledge', 'Mathematics', 'Science', 'Reasoning'].includes(quiz.category as string)) 
          ? (quiz.category as QuizCategory) 
          : "General Knowledge",
        password: quiz.password || undefined,
        timer: quiz.timer || 300,
        questions: Array.isArray(quiz.questions) ? quiz.questions : []
      }));

      // Add the new quizzes to the existing ones
      setQuizzes((prev) => [...prev, ...validatedQuizzes]);

      // Show success message
      toast({
        title: "Import successful",
        description: `${validatedQuizzes.length} new quizzes imported.`,
        variant: "default",
      });

      // Reset the import field
      setImportJson('');
      setIsJsonPlaceholder(true);
    } catch (error) {
      console.error("Import error:", error);
      toast({
        title: "Import failed",
        description: error instanceof Error ? error.message : "Unknown error occurred.",
        variant: "destructive",
      });
    }
  }

  const handleFocus = () => {
    if (isJsonPlaceholder) {
      setImportJson('')
      setIsJsonPlaceholder(false)
    }
  }

  const handleBlur = () => {
    if (importJson.trim() === '') {
      setImportJson(sampleJsonFormat)
      setIsJsonPlaceholder(true)
    }
  }
  
  // Function to copy the sample JSON format to clipboard with instructions
  const handleCopyFormat = () => {
    navigator.clipboard.writeText(detailedJsonFormat)
      .then(() => {
        toast({
          title: "Format Copied",
          description: "Sample JSON format with instructions copied to clipboard.",
        });
      })
      .catch((error) => {
        console.error("Failed to copy format:", error);
        toast({
          title: "Copy Failed",
          description: "Could not copy format to clipboard.",
          variant: "destructive",
        });
      });
  }

  // These functions have been moved up in the file and are already implemented

  const handleExportQuiz = () => {
    // Open the export modal which will show the export options
    setIsExportModalOpen(true)
    
    // Generate the export data for the selected quizzes
    let quizzesToExport: Quiz[];
    let exportFilename = 'bmv_quizzes.json'; // Default name
    
    if (exportOption === 'all') {
      quizzesToExport = quizzes;
    } else {
      quizzesToExport = quizzes.filter((_, index) => selectedQuizzes.includes(index));
      
      // If only one quiz is selected, use its title for the filename
      if (selectedQuizzes.length === 1) {
        const selectedQuiz = quizzes[selectedQuizzes[0]];
        // Create a safe filename from the quiz title
        const safeTitle = selectedQuiz.title
          .trim()
          .replace(/[^a-zA-Z0-9_-]/g, '_') // Replace invalid filename chars with underscores
          .substring(0, 50); // Limit length
        
        exportFilename = `${safeTitle}.json`;
      } else if (selectedQuizzes.length > 1) {
        // If multiple quizzes are selected, use a name that indicates multiple selection
        exportFilename = `bmv_${selectedQuizzes.length}_quizzes.json`;
      }
    }
    
    // If no quizzes are selected, don't update anything yet
    if (quizzesToExport.length === 0) return;
    
    // First optimize the quizzes to reduce size
    const optimizedQuizzes = optimizeImages(quizzesToExport);
    
    // Then prepare the export data
    const exportData = {
      quizzes: optimizedQuizzes,
      exportedAt: new Date(),
      appVersion: "1.0.0"
    };
    
    // Create the JSON string
    const json = JSON.stringify(exportData, null, 2);
    const encodedData = encodeQuizData(json);
    
    // Store the JSON string for export functionality
    setExportedJson(encodedData);
    
    // Store the filename for download
    setExportFilename(exportFilename);
  }

  const handleShareQuiz = async () => {
    try {
      let quizzesToShare: Quiz[]

      if (exportOption === 'all') {
        quizzesToShare = quizzes
      } else {
        quizzesToShare = quizzes.filter((_, index) => selectedQuizzes.includes(index))
      }

      if (quizzesToShare.length === 0) {
        toast({
          title: "Share failed",
          description: "No quizzes selected for sharing.",
          variant: "destructive",
        })
        return
      }

      // First optimize the quizzes to reduce size (compress images)
      const optimizedQuizzes = optimizeImages(quizzesToShare)

      // Then sanitize and prepare for sharing
      const sanitizedQuizzes = JSON.parse(JSON.stringify(optimizedQuizzes))

      // Handle the case where the share API supports files
      if (navigator.share && navigator.canShare) {
        try {
          // Create text content for sharing
          const shareText = `I'm sharing ${quizzesToShare.length} quiz${quizzesToShare.length > 1 ? 'zes' : ''} from BMV Quiz!`

          // Create a simplified version with minimal data for sharing
          const simplifiedQuizzes = sanitizedQuizzes.map((quiz: Quiz) => {
            // Create a minimal version with limited images
            const simplifiedQuiz = {
              ...quiz,
              questions: quiz.questions.map(q => ({
                ...q,
                // Limit the number and size of images
                questionImages: q.questionImages.slice(0, 1), // Take only the first image if exists
                answerImages: q.answerImages.slice(0, 1)     // Take only the first image if exists
              }))
            };
            return simplifiedQuiz;
          });

          // Create JSON and encode it to protect quiz content
          const json = JSON.stringify(simplifiedQuizzes, null, 2)
          const encodedData = encodeQuizData(json)

          // Create a filename based on quiz title or number of quizzes
          let shareFilename = 'bmv_quizzes.json';
          if (quizzesToShare.length === 1) {
            // If sharing only one quiz, use its title
            const safeTitle = quizzesToShare[0].title
              .trim()
              .replace(/[^a-zA-Z0-9_-]/g, '_') // Replace invalid filename chars with underscores
              .substring(0, 50); // Limit length
            shareFilename = `${safeTitle}.json`;
          } else if (quizzesToShare.length > 1) {
            // If sharing multiple quizzes
            shareFilename = `bmv_${quizzesToShare.length}_shared_quizzes.json`;
          }
          
          // Create a blob from the encoded JSON data
          const blob = new Blob([encodedData], { type: 'application/octet-stream' })
          const file = new File([blob], shareFilename, { type: "application/octet-stream" })

          // Check if we can share with files
          const shareData: any = {
            title: 'BMV Quiz - Shared Quizzes',
            text: shareText
          }

          // Try to use file sharing if supported
          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            shareData.files = [file]
          } else {
            // Fallback to text-only sharing
            shareData.url = window.location.href
          }

          await navigator.share(shareData)

          toast({
            title: "Share successful",
            description: "Quizzes shared successfully with content protection!",
            variant: "default",
          })
        } catch (error) {
          // User cancelled or share failed
          console.error('Share error:', error)
          if (error instanceof Error && error.name !== 'AbortError') {
            // If we failed to share with file, try text-only sharing
            try {
              await navigator.share({
                title: 'BMV Quiz - Shared Quizzes',
                text: `I'm sharing quizzes from BMV Quiz! Visit ${window.location.href} to create your own.`,
                url: window.location.href
              })

              toast({
                title: "Share successful",
                description: "Shared link to BMV Quiz (without quizzes).",
                variant: "default",
              })
            } catch (fallbackError) {
              console.error('Fallback share error:', fallbackError)
              toast({
                title: "Share failed",
                description: "There was an error sharing. Try exporting the quizzes instead.",
                variant: "destructive",
              })
            }
          }
        }
      } else {
        // Fallback for browsers that don't support Web Share API
        try {
          // Create a download as fallback with encoded data
          const json = JSON.stringify(sanitizedQuizzes, null, 2)
          const encodedData = encodeQuizData(json)
          
          // Create a filename based on quiz title or number of quizzes
          let shareFilename = 'bmv_quizzes.json';
          if (quizzesToShare.length === 1) {
            // If sharing only one quiz, use its title
            const safeTitle = quizzesToShare[0].title
              .trim()
              .replace(/[^a-zA-Z0-9_-]/g, '_') // Replace invalid filename chars with underscores
              .substring(0, 50); // Limit length
            shareFilename = `${safeTitle}.json`;
          } else if (quizzesToShare.length > 1) {
            // If sharing multiple quizzes
            shareFilename = `bmv_${quizzesToShare.length}_shared_quizzes.json`;
          }
          
          const blob = new Blob([encodedData], { type: 'application/octet-stream' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = shareFilename
          document.body.appendChild(a)
          a.click()

          // Clean up
          setTimeout(() => {
            document.body.removeChild(a)
            URL.revokeObjectURL(url)
          }, 100)

          toast({
            title: "Share not supported",
            description: "Your browser doesn't support sharing. Quizzes downloaded instead with content protection.",
            variant: "default",
          })
        } catch (downloadError) {
          console.error('Download fallback error:', downloadError)
          toast({
            title: "Share failed",
            description: "Unable to share or download quizzes. Try exporting instead.",
            variant: "destructive",
          })
        }
      }
    } catch (error) {
      console.error('Share preparation error:', error)
      toast({
        title: "Share failed",
        description: "There was an error preparing the quizzes for sharing.",
        variant: "destructive",
      })
    }
  }

  const handleExport = () => {
    try {
      let quizzesToExport: Quiz[]
      if (exportOption === 'all') {
        quizzesToExport = quizzes
      } else {
        quizzesToExport = quizzes.filter((_, index) => selectedQuizzes.includes(index))
      }

      if (quizzesToExport.length === 0) {
        toast({
          title: "Export failed",
          description: "No quizzes selected for export.",
          variant: "destructive",
        })
        return
      }

      // Clone and sanitize the objects to ensure they're JSON-friendly
      // Use try-catch to handle any circular references or non-serializable data
      let sanitizedQuizzes;
      try {
        sanitizedQuizzes = JSON.parse(JSON.stringify(quizzesToExport))
      } catch (jsonError) {
        console.error('JSON sanitization error:', jsonError)
        
        // Fallback to a more manual sanitization approach
        sanitizedQuizzes = quizzesToExport.map(quiz => {
          // Create a simplified version of the quiz
          return {
            id: quiz.id || crypto.randomUUID?.() || String(Date.now()),
            title: quiz.title || 'Untitled Quiz',
            description: quiz.description || '',
            questions: (quiz.questions || []).map(q => ({
              question: q.question || '',
              answerDescription: q.answerDescription || '',
              options: (q.options || []).slice(0, 4),
              correctAnswer: q.correctAnswer || '',
              questionImages: (q.questionImages || []).slice(0, 1), // Limit to first image
              answerImages: (q.answerImages || []).slice(0, 1) // Limit to first image
            })),
            timer: parseInt(String(quiz.timer)) || 60,
            category: quiz.category || 'General Knowledge',
            createdAt: quiz.createdAt || new Date(),
            isPublic: !!quiz.isPublic
          }
        })
      }
      
      // Use our safe stringify function to convert to JSON string
      const json = safeStringify(sanitizedQuizzes, '[]')

      // Encode the JSON to protect quiz answers and content with our enhanced encoding
      const encodedData = encodeQuizData(json)

      // Store the JSON string for clipboard functionality (we store the encoded version)
      setExportedJson(encodedData)

      // Try multiple export approaches, starting with modern methods and falling back to simpler ones
      let exportSuccess = false;
      
      // Approach 1: Use the File System Access API if available (modern browsers)
      // But skip it in mobile environments where it often fails
      const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      if (window?.showSaveFilePicker && !isMobile) {
        try {
          const exportFile = async () => {
            const opts = {
              suggestedName: exportFilename, // Use the dynamic filename
              types: [{
                description: 'JSON Files',
                accept: {'application/json': ['.json']}
              }]
            };
            
            try {
              const fileHandle = await window.showSaveFilePicker?.(opts);
              if (fileHandle) {
                const writable = await fileHandle.createWritable();
                await writable.write(encodedData);
                await writable.close();
              } else {
                throw new Error("No file handle returned");
              }
              return true;
            } catch (saveError) {
              console.warn('File saving operation failed:', saveError);
              return false;
            }
          };
          
          exportFile().then(success => {
            exportSuccess = success;
          }).catch(err => {
            console.warn('Modern file saving failed, falling back:', err);
            // Will fall through to the next approach
          });
        } catch (fsapiError) {
          console.warn('File System Access API error:', fsapiError);
          // Will fall through to the next approach
        }
      }
      
      // Approach 2: Standard download approach
      if (!exportSuccess) {
        try {
          // Create a Blob with the encoded data
          const blob = new Blob([encodedData], { type: 'application/octet-stream' })

          // Create a URL for the Blob
          const url = URL.createObjectURL(blob)

          // Create an anchor element and set properties for download
          const a = document.createElement('a')
          a.href = url
          a.download = exportFilename // Use the dynamic filename generated in handleExportQuiz

          // Append to the document temporarily (needed for Firefox)
          document.body.appendChild(a)

          // Trigger the download
          a.click()

          // Clean up
          setTimeout(() => {
            document.body.removeChild(a)
            URL.revokeObjectURL(url)
          }, 100)
          
          exportSuccess = true;
        } catch (downloadError) {
          console.error('Standard download error:', downloadError)
          // Will fall through to next approach
        }
      }
      
      // Approach 3: Data URI approach (most compatible)
      if (!exportSuccess) {
        try {
          // Create a data URI
          const dataUri = `data:application/json;charset=utf-8,${encodeURIComponent(encodedData)}`;
          const a = document.createElement('a');
          a.href = dataUri;
          a.download = exportFilename; // Use the dynamic filename
          a.style.display = 'none';
          document.body.appendChild(a);
          a.click();
          
          setTimeout(() => {
            document.body.removeChild(a);
          }, 100);
          
          exportSuccess = true;
        } catch (dataUriError) {
          console.error('Data URI approach failed:', dataUriError);
          // This is our most compatible approach, but we still have clipboard as a fallback
        }
      }

      // Even if download methods fail, we'll show success since users can copy from the textarea
      toast({
        title: "Export successful",
        description: `${quizzesToExport.length} quizzes prepared for export. ${!exportSuccess ? 'Please use the copy button if download didn\'t start.' : ''}`,
        variant: "default",
      })
    } catch (error) {
      console.error('Export error:', error)
      toast({
        title: "Export failed",
        description: "There was an error exporting the quizzes. Please try the copy option instead.",
        variant: "destructive",
      })
    }
  }

  const handleSaveQuiz = async () => {
    if (newQuiz.title.trim() === '' || newQuiz.timer <= 0) {
      toast({
        title: "Validation Error",
        description: "Please fill in the title and ensure the timer is set.",
        variant: "destructive",
      })
      return
    }
    const questions = newQuestions.filter(
      (q) => q.question.trim() !== '' && q.options.every(opt => opt.trim() !== '') && q.correctAnswer.trim() !== ''
    )
    if (questions.length === 0) {
      toast({
        title: "Validation Error",
        description: "Please ensure all questions are filled correctly.",
        variant: "destructive",
      })
      return
    }

    // Generate a unique ID for the quiz
    // Always generate a fresh uniqueId for syncing with server if this quiz is public
    // This is crucial to prevent duplicate quizzes on the server
    const quizUniqueId = newQuiz.isPublic ? crypto.randomUUID() : undefined;
    
    // Generate a unique ID for the quiz if it doesn't have one
    const quizWithId = {
      ...newQuiz,
      questions,
      id: newQuiz.id || uuidv4(),
      // Only set uniqueId if the quiz is public
      uniqueId: quizUniqueId,
      version: newQuiz.version || 1
    }

    try {
      // Add to local state
      setQuizzes((prev) => [...prev, quizWithId])

      toast({
        title: "Quiz Saved",
        description: newQuiz.isPublic 
          ? "Your quiz has been saved successfully and will be synchronized to the server since it's public."
          : "Your quiz has been saved successfully as a private quiz (stored only on this device).",
      })
    } catch (error) {
      console.error("Failed to save quiz:", error)

      toast({
        title: "Save Error",
        description: "There was a problem saving your quiz.",
        variant: "destructive",
      })
    }
    setNewQuiz({
      id: uuidv4(),
      title: '',
      description: '',
      questions: [],
      timer: 300,
      category: 'General Knowledge',
      createdAt: new Date(),
      isPublic: false,
      history: [],
      version: 1
    })
    setNewQuestions([
      {
        question: '',
        answerDescription: '',
        options: ['', '', '', ''],
        correctAnswer: '',
        questionImages: [],
        answerImages: [],
      },
    ])
    toast({
      title: "Success",
      description: "Quiz saved successfully!",
      variant: "default",
    })
  }

  // Simplified file-to-base64 conversion
  const convertFileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  // Optimized image upload handlers
  const handleQuestionImageUpload = useCallback(async (index: number, file: File) => {
    try {
      // Show loading toast for large files
      const isLargeFile = file.size > 2 * 1024 * 1024; // 2MB
      let toastId = "";
      
      if (isLargeFile) {
        const result = toast({
          title: "Processing image",
          description: "Optimizing large image, please wait...",
          duration: 10000, // Long duration
        });
        if (result && typeof result === "object" && "id" in result) {
          toastId = result.id as string;
        }
      }
      
      // Use our optimized converter
      const base64Image = await convertFileToBase64(file);
      
      // Update state with the new image
      setNewQuestions((prev) =>
        prev.map((q, i) => (i === index ? { 
          ...q, 
          questionImages: [...q.questionImages, base64Image] 
        } : q))
      );
      
      // Dismiss loading toast if it was shown
      if (isLargeFile && toastId) {
        toast({
          title: "Image added",
          description: "Image has been optimized and added to the question.",
          duration: 3000,
        });
      }
    } catch (error) {
      console.error("Failed to process image:", error);
      toast({
        title: "Image Processing Failed",
        description: "Could not add the image. Please try a different image.",
        variant: "destructive",
      });
    }
  }, [convertFileToBase64, toast]);

  const handleAnswerImageUpload = useCallback(async (index: number, file: File) => {
    try {
      // Show loading toast for large files
      const isLargeFile = file.size > 2 * 1024 * 1024; // 2MB
      let toastId = "";
      
      if (isLargeFile) {
        const result = toast({
          title: "Processing image",
          description: "Optimizing large image, please wait...",
          duration: 10000, // Long duration
        });
        if (result && typeof result === "object" && "id" in result) {
          toastId = result.id as string;
        }
      }
      
      // Use our optimized converter
      const base64Image = await convertFileToBase64(file);
      
      // Update state with the new image
      setNewQuestions((prev) =>
        prev.map((q, i) => (i === index ? { 
          ...q, 
          answerImages: [...q.answerImages, base64Image] 
        } : q))
      );
      
      // Dismiss loading toast if it was shown
      if (isLargeFile && toastId) {
        toast({
          title: "Image added",
          description: "Image has been optimized and added to the answer.",
          duration: 3000,
        });
      }
    } catch (error) {
      console.error("Failed to process image:", error);
      toast({
        title: "Image Processing Failed",
        description: "Could not add the image. Please try a different image.",
        variant: "destructive",
      });
    }
  }, [convertFileToBase64, toast]);

  // Add state for delete quiz operation
  const [quizToDelete, setQuizToDelete] = useState<number | null>(null)
  const [deletePasswordDialogOpen, setDeletePasswordDialogOpen] = useState(false)

  const handleDeleteQuiz = (index: number) => {
    // Set the quiz to delete and open password dialog
    setQuizToDelete(index)
    setPasswordInput("")
    setDeletePasswordDialogOpen(true)
  }

  const handleDeleteQuizConfirm = async () => {
    // Only proceed if quizToDelete is not null
    if (quizToDelete === null) return;
    
    const quiz = quizzes[quizToDelete];
    
    // Check if the password matches the user-defined password or the master password
    if ((quiz.password && passwordInput === quiz.password) || passwordInput === MASTER_PASSWORD) {
      try {
        // Store the quiz uniqueId for server deletion if applicable
        const quizUniqueId = quiz.uniqueId;
        
        // First delete locally
        setQuizzes((prev) => prev.filter((_, i) => i !== quizToDelete));
        
        // Close the dialog immediately
        setDeletePasswordDialogOpen(false);
        
        // If this was a public quiz with a uniqueId, also delete from server
        if (quizUniqueId && quiz.isPublic) {
          toast({
            title: "Deleting Quiz",
            description: "Removing quiz from your devices and the server...",
          });
          
          // Call server API to delete the quiz by uniqueId
          try {
            const deleteResponse = await apiRequest(`/api/quizzes/unique/${quizUniqueId}`, {
              method: "DELETE",
            });
            
            console.log("Server delete response:", deleteResponse);
            
            toast({
              title: "Quiz Deleted",
              description: "The quiz has been deleted from your device and the server.",
              variant: "default",
            });
            
            // DON'T run full sync as that would reintroduce deleted quizzes
            // Instead, we can fetch the latest server quizzes to keep in sync
            try {
              const serverQuizzes = await apiRequest("/api/quizzes", {
                method: "GET",
                headers: {
                  "Cache-Control": "no-cache",
                  "Pragma": "no-cache"
                }
              });
              
              console.log("Fresh server quiz list after deletion:", serverQuizzes);
            } catch (fetchError) {
              console.error("Failed to refresh quiz list after deletion:", fetchError);
            }
            
          } catch (error) {
            console.error("Failed to delete quiz from server:", error);
            toast({
              title: "Server Deletion Failed",
              description: "The quiz was deleted locally but could not be removed from the server.",
              variant: "destructive",
            });
          }
        } else {
          // Just a local quiz deletion
          toast({
            title: "Quiz Deleted",
            description: "The quiz has been deleted successfully.",
            variant: "default",
          });
        }
      } catch (error) {
        console.error("Quiz deletion error:", error);
        toast({
          title: "Deletion Error",
          description: "There was a problem deleting the quiz. Please try again.",
          variant: "destructive",
        });
      }
      
      // Close dialog and reset state regardless of success/failure
      setDeletePasswordDialogOpen(false);
      setPasswordInput("");
      setQuizToDelete(null);
    } else {
      // Password doesn't match
      toast({
        title: "Access Denied",
        description: "Incorrect password. Quiz deletion prevented.",
        variant: "destructive",
      })
    }
  }

  const handleEditQuiz = (index: number) => {
    setQuizToEdit(index);
    setPasswordDialogOpen(true);
  }

  const handlePasswordSubmit = () => {
    if (quizToEdit === null) return;

    const quiz = quizzes[quizToEdit];
    const userPassword = passwordInput;

    // Check if the password matches the user-defined password or the master password
    if ((quiz.password && userPassword === quiz.password) || userPassword === MASTER_PASSWORD) {
      // Password is correct, proceed to edit
      setPasswordDialogOpen(false);
      setPasswordInput("");

      // Load the quiz data into edit mode
      setNewQuiz({
        id: quiz.id,
        title: quiz.title,
        description: quiz.description,
        timer: quiz.timer,
        password: quiz.password,
        questions: [],
        category: quiz.category || 'General Knowledge',
        createdAt: quiz.createdAt || new Date(),
        isPublic: quiz.isPublic || false,
        history: quiz.history || [],
        version: quiz.version || 1
      });

      setNewQuestions(quiz.questions.map(q => ({...q})));
      setIsEditMode(true);
      setActiveTab("create");

      toast({
        title: "Edit Mode",
        description: "Now editing quiz: " + quiz.title,
      });
    } else {
      // Incorrect password
      toast({
        title: "Access Denied",
        description: "The password you entered is incorrect.",
        variant: "destructive",
      });
    }
  }

  const handleUpdateQuiz = () => {
    if (quizToEdit === null) return;

    if (newQuiz.title.trim() === '' || newQuiz.timer <= 0) {
      toast({
        title: "Validation Error",
        description: "Please fill in the title and ensure the timer is set.",
        variant: "destructive",
      });
      return;
    }

    const questions = newQuestions.filter(
      (q) => q.question.trim() !== '' && q.options.every(opt => opt.trim() !== '') && q.correctAnswer.trim() !== ''
    );

    if (questions.length === 0) {
      toast({
        title: "Validation Error",
        description: "Please ensure all questions are filled correctly.",
        variant: "destructive",
      });
      return;
    }
    
    // Get the original quiz to preserve its uniqueId
    const originalQuiz = quizzes[quizToEdit];
    
    // Update the quiz while preserving the uniqueId of the original quiz
    setQuizzes(prev => 
      prev.map((q, i) => i === quizToEdit ? { 
        ...newQuiz, 
        questions,
        // IMPORTANT: Preserve these values from the original quiz to prevent duplicates
        uniqueId: originalQuiz.uniqueId, // Keep the same uniqueId to prevent duplicates
        id: originalQuiz.id // Keep the same id
      } : q)
    );

    // Reset form
    setNewQuiz({
      id: uuidv4(),
      title: '',
      description: '',
      questions: [],
      timer: 300,
      category: 'General Knowledge',
      isPublic: false,
      createdAt: new Date(),
      history: [],
      version: 1
    });

    setNewQuestions([
      {
        question: '',
        answerDescription: '',
        options: ['', '', '', ''],
        correctAnswer: '',
        questionImages: [],
        answerImages: [],
      },
    ]);

    setIsEditMode(false);
    setQuizToEdit(null);

    toast({
      title: "Success",
      description: "Quiz updated successfully!",
      variant: "default",
    });
  }

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`
  }

  const toggleQuizSelection = (index: number) => {
    setSelectedQuizzes((prev) => {
      if (prev.includes(index)) {
        return prev.filter((i) => i !== index)
      } else {
        return [...prev, index]
      }
    })
  }
  
  // Toggle quiz selection for merge functionality
  const toggleQuizMergeSelection = (index: number) => {
    setQuizzesToMerge((prev) => {
      if (prev.includes(index)) {
        return prev.filter((i) => i !== index)
      } else {
        return [...prev, index]
      }
    })
  }
  
  // Function to merge selected quizzes
  const handleMergeQuizzes = () => {
    if (quizzesToMerge.length < 2) {
      toast({
        title: "Merge failed",
        description: "Select at least two quizzes to merge.",
        variant: "destructive",
      })
      return
    }
    
    if (!mergedQuizTitle.trim()) {
      toast({
        title: "Title required",
        description: "Please provide a title for the merged quiz.",
        variant: "destructive",
      })
      return
    }
    
    // Get the selected quizzes
    const selectedQuizData = quizzesToMerge.map(index => quizzes[index])
    
    // Combine all questions from the selected quizzes
    const allQuestions = selectedQuizData.flatMap(quiz => quiz.questions)
    
    // Calculate average timer from all quizzes, with a minimum of 60 seconds
    const avgTimer = Math.max(
      60,
      Math.round(
        selectedQuizData.reduce((sum, quiz) => sum + quiz.timer, 0) / selectedQuizData.length
      )
    )
    
    // Create new merged quiz
    const mergedQuiz: Quiz = {
      id: uuidv4(),
      title: mergedQuizTitle,
      description: `Merged quiz containing questions from: ${selectedQuizData.map(q => q.title).join(", ")}`,
      questions: allQuestions,
      timer: avgTimer,
      category: mergedQuizCategory,
      createdAt: new Date(),
      isPublic: false,
      history: [],
      version: 1
    }
    
    // Add the merged quiz to the collection
    setQuizzes(prev => [...prev, mergedQuiz])
    
    // Reset state and close modal
    setMergedQuizTitle("")
    setQuizzesToMerge([])
    setIsMergeModalOpen(false)
    
    toast({
      title: "Merge successful",
      description: `Created new quiz "${mergedQuizTitle}" with ${allQuestions.length} questions.`,
      variant: "default",
    })
  }

  // Enhanced animation variants with playful effects
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        delayChildren: 0.2,
        staggerChildren: 0.1
      }
    }
  }

  const itemVariants = {
    hidden: { y: 20, opacity: 0, scale: 0.95 },
    visible: {
      y: 0,
      opacity: 1,
      scale: 1,
      transition: {
        type: "spring",
        stiffness: 260,
        damping: 20
      }
    }
  }
  
  // Special celebration animation variants for correct answers
  const correctAnswerVariants = {
    initial: { scale: 1 },
    animate: { 
      scale: [1, 1.05, 1],
      boxShadow: ["0px 0px 0px rgba(0,200,0,0)", "0px 0px 8px rgba(0,200,0,0.5)", "0px 0px 0px rgba(0,200,0,0)"]
    }
  }

  const fadeIn = {
    hidden: { opacity: 0 },
    visible: { 
      opacity: 1,
      transition: { duration: 0.6 }
    }
  }

  // Using the new theme context for dark mode
  const { theme } = useTheme();

  return (
    <div className="p-4 max-w-5xl mx-auto min-h-screen bg-background text-foreground transition-colors duration-500 ease-in-out">
      <div className="flex justify-between items-center mb-8">
        <motion.h1 
          className="text-3xl font-bold flex items-center"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <span className="mr-2 text-2xl" aria-hidden="true">📝</span>
          <span className="gradient-heading">BMV Quiz</span>
        </motion.h1>

        <ThemeToggle />
      </div>

      <Tabs 
        value={activeTab} 
        onValueChange={setActiveTab}
        className="mb-8"
      >
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="create" className="flex items-center justify-center">
            <Plus className="h-5 w-5 mr-2" />
            Create Quiz
          </TabsTrigger>
          <TabsTrigger value="start" className="flex items-center justify-center">
            <ArrowRight className="h-5 w-5 mr-2" />
            Start Quiz
          </TabsTrigger>
          <TabsTrigger value="history" className="flex items-center justify-center">
            <Clock className="h-5 w-5 mr-2" />
            History
          </TabsTrigger>
          <TabsTrigger value="import-export" className="flex items-center justify-center">
            <Download className="h-5 w-5 mr-2" />
            Import/Export
          </TabsTrigger>
        </TabsList>

        <TabsContent value="create">
          <motion.div 
            className="grid grid-cols-1 gap-6"
            variants={containerVariants}
            initial="hidden"
            animate="visible"
          >
            <motion.div variants={itemVariants}>
              <Card>
                <CardHeader>
                  <CardTitle>Quiz Information</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="quiz-title">Quiz Title</Label>
                      <Input
                        id="quiz-title"
                        value={newQuiz.title}
                        onChange={(e) => setNewQuiz({ ...newQuiz, title: e.target.value })}
                        placeholder="Enter quiz title"
                      />
                    </div>
                    <div>
                      <Label htmlFor="quiz-description">Description</Label>
                      <Textarea
                        id="quiz-description"
                        value={newQuiz.description}
                        onChange={(e) => setNewQuiz({ ...newQuiz, description: e.target.value })}
                        placeholder="Enter quiz description"
                        rows={3}
                      />
                    </div>
                    <div>
                      <Label htmlFor="quiz-timer">Timer (seconds)</Label>
                      <Input
                        id="quiz-timer"
                        type="number"
                        min="10"
                        step="10"
                        value={newQuiz.timer}
                        onChange={(e) => setNewQuiz({ ...newQuiz, timer: parseInt(e.target.value) })}
                      />
                    </div>
                    <div>
                      <Label htmlFor="quiz-password">Password (optional)</Label>
                      <Input
                        id="quiz-password"
                        type="password"
                        placeholder="Set password for editing"
                        value={newQuiz.password || ''}
                        onChange={(e) => setNewQuiz({ ...newQuiz, password: e.target.value })}
                      />
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        Set a password to protect this quiz from unauthorized edits
                      </p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-4">
                        <div>
                          <Label htmlFor="quiz-category">Category</Label>
                          <Select 
                            value={newQuiz.category || ""} 
                            onValueChange={(value) => {
                              if (value === "Custom") {
                                // If Custom is selected, show the dialog
                                setShowAddCategoryDialog(true);
                                // Don't change the category yet - we'll do that when dialog is submitted
                              } else {
                                setNewQuiz({ ...newQuiz, category: value as QuizCategory });
                              }
                            }}
                          >
                            <SelectTrigger id="quiz-category">
                              <SelectValue placeholder="Select a category" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="General Knowledge">General Knowledge</SelectItem>
                              <SelectItem value="Mathematics">Mathematics</SelectItem>
                              <SelectItem value="Science">Science</SelectItem>
                              <SelectItem value="Reasoning">Reasoning</SelectItem>
                              
                              {/* Show existing user categories */}
                              {allCategories
                                .filter(cat => !['General Knowledge', 'Mathematics', 'Science', 'Reasoning'].includes(cat))
                                .map(userCategory => (
                                  <SelectItem key={userCategory} value={userCategory}>
                                    {userCategory}
                                  </SelectItem>
                                ))
                              }
                              
                              <SelectItem value="Custom">Add New Category...</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        
                        {/* Add New Category Dialog */}
                        <Dialog open={showAddCategoryDialog} onOpenChange={setShowAddCategoryDialog}>
                          <DialogContent className="sm:max-w-[425px]">
                            <DialogHeader>
                              <DialogTitle>Add New Quiz Category</DialogTitle>
                              <DialogDescription>
                                Enter a name for your new quiz category. This will add it to your collection.
                              </DialogDescription>
                            </DialogHeader>
                            <div className="grid gap-4 py-4">
                              <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="new-category-name" className="text-right">
                                  Category Name
                                </Label>
                                <Input
                                  id="new-category-name"
                                  placeholder="Enter category name"
                                  value={customCategoryInput}
                                  onChange={(e) => setCustomCategoryInput(e.target.value)}
                                  className="col-span-3"
                                  autoFocus
                                />
                              </div>
                            </div>
                            <DialogFooter>
                              <Button variant="outline" onClick={() => setShowAddCategoryDialog(false)}>
                                Cancel
                              </Button>
                              <Button 
                                onClick={() => {
                                  if (customCategoryInput.trim()) {
                                    // Set the new quiz category
                                    setNewQuiz({...newQuiz, category: customCategoryInput.trim()});
                                    
                                    // Add to categories if not already there
                                    if (!allCategories.includes(customCategoryInput.trim())) {
                                      setAllCategories([...allCategories, customCategoryInput.trim()]);
                                    }
                                    
                                    // Close the dialog
                                    setShowAddCategoryDialog(false);
                                    
                                    // Show success message
                                    toast({
                                      title: "Category Added",
                                      description: `Added "${customCategoryInput.trim()}" to your categories.`,
                                      variant: "default",
                                    });
                                  } else {
                                    // Show error for empty input
                                    toast({
                                      title: "Cannot Add Empty Category",
                                      description: "Please enter a name for your category.",
                                      variant: "destructive",
                                    });
                                  }
                                }}
                              >
                                Add Category
                              </Button>
                            </DialogFooter>
                          </DialogContent>
                        </Dialog>
                      </div>

                    </div>
                    <div className="mt-4 border rounded-lg p-4 bg-gray-50 dark:bg-gray-800">
                      <h4 className="text-md font-medium mb-2">Sharing Options</h4>
                      <div className="flex items-center space-x-3">
                        <Switch 
                          id="quiz-public" 
                          checked={newQuiz.isPublic}
                          onCheckedChange={(checked: boolean) => 
                            setNewQuiz({ ...newQuiz, isPublic: checked })
                          }
                          className={newQuiz.isPublic ? "bg-blue-600" : ""}
                        />
                        <Label htmlFor="quiz-public" className="font-medium">
                          {newQuiz.isPublic ? "Public Quiz" : "Private Quiz"}
                        </Label>
                        <Badge className={newQuiz.isPublic ? 
                          "ml-2 bg-blue-100 text-blue-800 hover:bg-blue-200" : 
                          "ml-2 bg-gray-100 text-gray-800 hover:bg-gray-200"}>
                          {newQuiz.isPublic ? "Shared" : "Not Shared"}
                        </Badge>
                      </div>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
                        {newQuiz.isPublic 
                          ? "This quiz will be available to all users. Anyone can find and take it. It will be synchronized to the server."
                          : "This quiz will only be available on your device. No one else will be able to see or take it."
                        }
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            {newQuestions.map((question, index) => (
              <motion.div key={index} variants={itemVariants}>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle>Question {index + 1}</CardTitle>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteQuestion(index)}
                      className="text-red-500 hover:text-red-700"
                    >
                      <Trash className="h-5 w-5" />
                    </Button>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <Label htmlFor={`question-text-${index}`}>Question</Label>
                      <Textarea
                        id={`question-text-${index}`}
                        value={question.question}
                        onChange={(e) => handleQuestionChange(index, 'question', e.target.value)}
                        placeholder="Enter your question"
                        rows={2}
                      />
                    </div>

                    <div>
                      <Label className="mb-2">Options</Label>
                      <div className="space-y-2">
                        {question.options.map((option, optIdx) => (
                          <div key={optIdx} className="flex items-center space-x-3">
                            <RadioGroup
                              value={question.correctAnswer === option ? option : ""}
                              onValueChange={(value) => handleCorrectAnswerChange(index, value)}
                            >
                              <RadioGroupItem
                                value={option || `empty-${optIdx}`}
                                id={`option-${index}-${optIdx}`}
                                className="h-4 w-4"
                              />
                            </RadioGroup>
                            <Input
                              value={option}
                              onChange={(e) => handleOptionChange(index, optIdx, e.target.value)}
                              placeholder={`Option ${optIdx + 1}`}
                              className="flex-1"
                            />
                          </div>
                        ))}
                      </div>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Select the radio button next to the correct answer</p>
                    </div>

                    <div>
                      <Label htmlFor={`answer-description-${index}`}>Answer Description</Label>
                      <Textarea
                        id={`answer-description-${index}`}
                        value={question.answerDescription}
                        onChange={(e) => handleQuestionChange(index, 'answerDescription', e.target.value)}
                        placeholder="Explanation for the correct answer"
                        rows={2}
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <Label className="mb-2">Question Images</Label>
                        <div 
                          className="border-2 border-dashed border-gray-300 p-4 rounded-md text-center cursor-pointer hover:bg-gray-50"
                          onClick={() => {
                            document.getElementById(`question-image-upload-${index}`)?.click();
                          }}
                        >
                          <div className="space-y-1">
                            <Upload className="mx-auto h-12 w-12 text-gray-400" />
                            <p className="text-sm text-gray-500">Click to upload or drag and drop</p>
                            <p className="text-xs text-gray-500">PNG, JPG, GIF up to 10MB</p>
                          </div>
                          <input
                            id={`question-image-upload-${index}`}
                            type="file"
                            className="hidden"
                            accept="image/*"
                            multiple
                            onChange={(e) => {
                              if (e.target.files && e.target.files.length > 0) {
                                Array.from(e.target.files).forEach((file) => {
                                  handleQuestionImageUpload(index, file)
                                })
                              }
                            }}
                          />
                        </div>
                        <div className="flex flex-wrap mt-2 gap-2">
                          {question.questionImages.map((img, imgIdx) => (
                            <div key={imgIdx} className="relative w-16 h-16">
                              <img
                                src={img}
                                alt={`Question ${index + 1} image ${imgIdx + 1}`}
                                className="w-full h-full object-cover rounded"
                              />
                              <Button
                                variant="destructive"
                                size="sm"
                                className="absolute -top-2 -right-2 h-5 w-5 p-0 rounded-full"
                                onClick={() => {
                                  setNewQuestions((prev) =>
                                    prev.map((q, i) =>
                                      i === index
                                        ? {
                                            ...q,
                                            questionImages: q.questionImages.filter((_, idx) => idx !== imgIdx),
                                          }
                                        : q
                                    )
                                  )
                                }}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div>
                        <Label className="mb-2">Answer Images</Label>
                        <div 
                          className="border-2 border-dashed border-gray-300 p-4 rounded-md text-center cursor-pointer hover:bg-gray-50"
                          onClick={() => {
                            document.getElementById(`answer-image-upload-${index}`)?.click();
                          }}
                        >
                          <div className="space-y-1">
                            <Upload className="mx-auto h-12 w-12 text-gray-400" />
                            <p className="text-sm text-gray-500">Click to upload or drag and drop</p>
                            <p className="text-xs text-gray-500">PNG, JPG, GIF up to 10MB</p>
                          </div>
                          <input
                            id={`answer-image-upload-${index}`}
                            type="file"
                            className="hidden"
                            accept="image/*"
                            multiple
                            onChange={(e) => {
                              if (e.target.files && e.target.files.length > 0) {
                                Array.from(e.target.files).forEach((file) => {
                                  handleAnswerImageUpload(index, file)
                                })
                              }
                            }}
                          />
                        </div>
                        <div className="flex flex-wrap mt-2 gap-2">
                          {question.answerImages.map((img, imgIdx) => (
                            <div key={imgIdx} className="relative w-16 h-16">
                              <img
                                src={img}
                                alt={`Answer ${index + 1} image ${imgIdx + 1}`}
                                className="w-full h-full object-cover rounded"
                              />
                              <Button
                                variant="destructive"
                                size="sm"
                                className="absolute -top-2 -right-2 h-5 w-5 p-0 rounded-full"
                                onClick={() => {
                                  setNewQuestions((prev) =>
                                    prev.map((q, i) =>
                                      i === index
                                        ? {
                                            ...q,
                                            answerImages: q.answerImages.filter((_, idx) => idx !== imgIdx),
                                          }
                                        : q
                                    )
                                  )
                                }}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}

            <div className="flex justify-between space-x-4">
              <Button
                variant="outline"
                onClick={handleAddQuestion}
                className="flex items-center justify-center"
              >
                <Plus className="h-5 w-5 mr-2" />
                Add Question
              </Button>
              {isEditMode ? (
                <Button onClick={handleUpdateQuiz} className="bg-green-600 hover:bg-green-700">
                  <Pencil className="h-4 w-4 mr-2" />
                  Update Quiz
                </Button>
              ) : (
                <Button onClick={handleSaveQuiz}>
                  <Save className="h-4 w-4 mr-2" />
                  Save Quiz
                </Button>
              )}
            </div>
          </motion.div>
        </TabsContent>

        <TabsContent value="start">
          
          {/* Search and filter bar with public quiz refresh */}
          <div className="mb-6 space-y-4">
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="w-full sm:w-2/3">
                <Label htmlFor="search-quiz" className="sr-only">Search quizzes</Label>
                <div className="relative">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <Input
                    id="search-quiz"
                    placeholder="Search quizzes by title or description..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>
              <div className="w-full sm:w-1/3">
                <Select
                  value={selectedCategory || ""}
                  onValueChange={(value) => setSelectedCategory(value === "all" ? null : value)}
                >
                  <SelectTrigger id="filter-category">
                    <SelectValue placeholder="Filter by category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Categories</SelectItem>
                    {allCategories.map((category) => (
                      <SelectItem key={category} value={category}>{category}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            
            {/* Public quizzes section */}
            <div className="flex flex-col sm:flex-row justify-between items-center gap-2 px-2">
              <div className="flex items-center">
                <Badge variant="outline" className="bg-blue-100 text-blue-800 border-blue-200">
                  Public Quizzes
                </Badge>
                <span className="ml-2 text-sm text-gray-600 dark:text-gray-300">
                  Share and discover quizzes from other users
                </span>
              </div>
              <div className="ml-auto flex space-x-2">
                <Button
                  onClick={cleanupServerDuplicates}
                  variant="outline"
                  size="sm"
                  className="flex items-center p-2"
                  title="Clean Server Duplicates"
                >
                  <Database className="h-5 w-5" />
                </Button>
                
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => {
                    // Show loading toast
                    toast({
                      title: "Refreshing Quizzes",
                      description: "Checking for new public quizzes..."
                    });
                    
                    // Fetch quizzes directly without loading ref check
                    // This will always perform the fetch and show appropriate toasts
                    fetchPublicQuizzesFromServer();
                  }}
                  className="flex items-center p-2"
                  title="Download Shared Quizzes"
                >
                  <RefreshCw className="h-5 w-5" />
                </Button>
              </div>
            </div>
          </div>

          {quizzes.length > 0 ? (
            <motion.div 
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
              variants={containerVariants}
              initial="hidden"
              animate="visible"
            >
              {filteredQuizzes.map((quiz: Quiz, index: number) => (
                <motion.div key={index} variants={itemVariants}>
                  <Card className="flex flex-col justify-between h-full">
                    <CardContent className="pt-6">
                      <div>
                        <div className="flex justify-between items-start mb-4">
                          <div className="flex items-center gap-2">
                            <h3 className="text-lg font-bold">{quiz.title}</h3>
                            {quiz.isPublic ? (
                              <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-200">
                                <Globe size={12} className="mr-1" />
                                Public
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="bg-gray-100 text-gray-600">
                                <Lock size={12} className="mr-1" />
                                Private
                              </Badge>
                            )}
                            {quiz.uniqueId && quiz.uniqueId !== quiz.id && (
                              <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                                <Cloud size={12} className="mr-1" />
                                Synced
                              </Badge>
                            )}
                          </div>
                          <div className="flex space-x-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleEditQuiz(index)}
                              className="text-blue-500 hover:text-blue-700 p-1"
                              title="Edit Quiz"
                            >
                              <Pencil className="h-5 w-5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeleteQuiz(index)}
                              className="text-red-500 hover:text-red-700 p-1"
                              title="Delete Quiz"
                            >
                              <Trash className="h-5 w-5" />
                            </Button>
                          </div>
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">{quiz.description}</p>

                        <div className="flex flex-wrap gap-2 mb-4">
                          {quiz.category && (
                            <Badge variant="outline" className="bg-primary/10">
                              {quiz.category}
                            </Badge>
                          )}
                        </div>

                        <div className="flex items-center mb-2 text-sm text-gray-500 dark:text-gray-400">
                          <Clock className="h-4 w-4 mr-1" />
                          <span>{Math.floor(quiz.timer / 60)} minutes</span>
                        </div>
                        <div className="flex items-center mb-2 text-sm text-gray-500 dark:text-gray-400">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 20 01 2h2a2 2 0 012 2" />
                          </svg>
                          <span>{quiz.questions.length} questions</span>
                        </div>
                        {quiz.lastTaken && (
                          <div className="bg-gray-100 dark:bg-gray-800 text-xs text-gray-500 dark:text-gray-400 px-2 py-1 rounded mt-2 inline-block">
                            <Clock className="h-3 w-3 inline mr-1" />
                            Last taken {new Date(quiz.lastTaken).toLocaleString()}
                          </div>
                        )}
                      </div>
                      <Button
                        className="w-full mt-4"
                        onClick={() => handleStartQuiz(quiz)}
                      >
                        Start Quiz
                      </Button>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </motion.div>
          ) : (
            <motion.div
              initial="hidden"
              animate="visible"
              variants={fadeIn}
            >
              <Card>
                <CardContent className="pt-6 text-center py-12">
                  <p className="text-lg text-gray-500 dark:text-gray-300 mb-4">No quizzes available.</p>
                  <p className="text-sm text-gray-400 dark:text-gray-400 mb-6">
                    Create a new quiz or import existing ones to get started.
                  </p>
                  <Button 
                    variant="outline" 
                    onClick={() => {
                      // Simply update the state to switch the tab
                      setActiveTab("create");
                    }}
                  >
                    <Plus className="h-5 w-5 mr-2" />
                    Create Your First Quiz
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </TabsContent>

        <TabsContent value="history">
          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className="grid grid-cols-1 gap-6"
          >
            <motion.div variants={itemVariants}>
              <Card>
                <CardHeader>
                  <CardTitle>Quiz History</CardTitle>
                </CardHeader>
                <CardContent className="max-h-[70vh] overflow-y-auto pr-1">
                  {quizzes.filter(quiz => quiz.history && quiz.history.length > 0).length === 0 ? (
                    <div className="text-center py-8">
                      <p className="text-gray-500 dark:text-gray-300">No quiz history available yet.</p>
                      <p className="text-sm text-gray-400 dark:text-gray-400 mt-2">
                        Take quizzes to build your history and track your progress over time.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-6">
                      {quizzes
                        .filter(quiz => quiz.history && quiz.history.length > 0)
                        .map((quiz, index) => (
                          <motion.div 
                            key={index} 
                            variants={itemVariants}
                            className="border rounded-lg p-4"
                          >
                            <h3 className="font-medium text-lg mb-2">{quiz.title}</h3>
                            <div className="flex flex-wrap gap-2 mb-3">
                              {quiz.category && (
                                <Badge variant="outline" className="bg-primary/10">
                                  {quiz.category}
                                </Badge>
                              )}

                            </div>
                            <div className="space-y-3">
                              <p className="text-sm text-gray-500">
                                Quiz has {quiz.questions.length} questions and a time limit of {Math.floor(quiz.timer / 60)} minutes
                              </p>

                              <div className="space-y-2">
                                <h4 className="text-sm font-medium">Attempt History</h4>
                                <div className="rounded-md border overflow-hidden">
                                  <table className="w-full text-sm">
                                    <thead>
                                      <tr className="bg-gray-50 border-b">
                                        <th className="px-4 py-2 text-left">Date</th>
                                        <th className="px-4 py-2 text-center">Score</th>
                                        <th className="px-4 py-2 text-center">Time Spent</th>
                                        <th className="px-4 py-2 text-center">Performance</th>
                                        <th className="px-4 py-2 text-center">Actions</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {quiz.history && [...quiz.history]
                                        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                                        .map((attempt, i) => [
                                          <tr 
                                            key={`attempt-row-${i}`} 
                                            className={i % 2 === 0 ? 'bg-gray-100 dark:bg-gray-800' : 'bg-white dark:bg-gray-700'}
                                          >
                                            <td className="px-4 py-2 text-left text-gray-900 dark:text-gray-200">{new Date(attempt.date).toLocaleString()}</td>
                                            <td className="px-4 py-2 text-center font-medium text-gray-900 dark:text-gray-200">
                                              {attempt.score}/{attempt.totalQuestions}
                                            </td>
                                            <td className="px-4 py-2 text-center text-gray-900 dark:text-gray-200">
                                              {Math.floor(attempt.timeSpent / 60)}:{(attempt.timeSpent % 60).toString().padStart(2, '0')}
                                            </td>
                                            <td className="px-4 py-2">
                                              <div className="flex items-center justify-center">
                                                <div className="w-full bg-gray-200 dark:bg-gray-600 rounded-full h-2.5 mr-2 max-w-[100px]">
                                                  <div 
                                                    className={`h-2.5 rounded-full ${
                                                      (attempt.score / attempt.totalQuestions) >= 0.8 
                                                        ? 'bg-green-500' 
                                                        : (attempt.score / attempt.totalQuestions) >= 0.6 
                                                          ? 'bg-yellow-500' 
                                                          : 'bg-red-500'
                                                    }`}
                                                    style={{ width: `${(attempt.score / attempt.totalQuestions) * 100}%` }}
                                                  ></div>
                                                </div>
                                                <span className="text-xs">
                                                  {Math.round((attempt.score / attempt.totalQuestions) * 100)}%
                                                </span>
                                              </div>
                                            </td>
                                            <td className="px-4 py-2 text-center flex space-x-1">
                                              <Button 
                                                variant="ghost" 
                                                size="sm"
                                                onClick={() => {
                                                  const detailsRow = document.getElementById(`attempt-details-${quiz.id}-${i}`);
                                                  if (detailsRow) {
                                                    detailsRow.classList.toggle('hidden');
                                                  }
                                                }}
                                                title="View full results"
                                              >
                                                <span className="sr-only">View full results</span>
                                                <Eye className="h-4 w-4 text-green-500" />
                                              </Button>
                                              <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => saveResultImage(quiz, attempt)}
                                                title="Save result as image"
                                              >
                                                <span className="sr-only">Save result as image</span>
                                                <Download className="h-4 w-4 text-purple-500" />
                                              </Button>
                                              <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => handleShareResult(quiz, attempt)}
                                                title="Share result"
                                              >
                                                <span className="sr-only">Share result</span>
                                                <Share2 className="h-4 w-4 text-blue-500" />
                                              </Button>
                                            </td>
                                          </tr>,
                                          <tr 
                                            key={`attempt-details-${i}`}
                                            id={`attempt-details-${quiz.id}-${i}`} 
                                            className="hidden"
                                          >
                                            <td colSpan={5} className="px-4 py-3 bg-gray-50 dark:bg-gray-800 border-t border-b">
                                              {attempt.questionResults ? (
                                                <div className="space-y-3">
                                                  <h4 className="text-sm font-medium">Question Details:</h4>
                                                  {attempt.questionResults.map((result, qIdx) => (
                                                    <div 
                                                      key={qIdx} 
                                                      className={`border rounded p-2 ${
                                                        result.isCorrect 
                                                          ? 'border-green-200 bg-green-50 dark:bg-green-900/20 dark:border-green-900' 
                                                          : 'border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-900'
                                                      }`}
                                                    >
                                                      <div className="flex items-start gap-2">
                                                        <div className={`mt-1 ${
                                                          result.isCorrect 
                                                            ? 'text-green-500 dark:text-green-400' 
                                                            : 'text-red-500 dark:text-red-400'
                                                        }`}>
                                                          {result.isCorrect 
                                                            ? <Check className="h-4 w-4" /> 
                                                            : <X className="h-4 w-4" />
                                                          }
                                                        </div>
                                                        <div className="flex-1">
                                                          <p className="text-sm font-medium">{qIdx + 1}. {result.question}</p>
                                                          <div className="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                                                            <div>
                                                              <span className="font-semibold">Your answer: </span>
                                                              <span className={result.isCorrect 
                                                                ? 'text-green-600 dark:text-green-400' 
                                                                : 'text-red-600 dark:text-red-400'
                                                              }>
                                                                {result.userAnswer || '(No answer)'}
                                                              </span>
                                                            </div>
                                                            {!result.isCorrect && (
                                                              <div>
                                                                <span className="font-semibold">Correct answer: </span>
                                                                <span className="text-green-600 dark:text-green-400">
                                                                  {result.correctAnswer}
                                                                </span>
                                                              </div>
                                                            )}
                                                          </div>
                                                        </div>
                                                      </div>
                                                    </div>
                                                  ))}
                                                </div>
                                              ) : (
                                                <p className="text-sm text-gray-500 dark:text-gray-400 py-2">
                                                  Detailed results not available for this attempt.
                                                </p>
                                              )}
                                            </td>
                                          </tr>
                                        ])}
                                    </tbody>
                                  </table>
                                </div>
                              </div>

                              {quiz.history && quiz.history.length > 1 && (
                                <div>
                                  <h4 className="text-sm font-medium text-gray-900 dark:text-gray-200 mb-1">Progress Trend</h4>
                                  <div className="h-32 bg-gray-50 dark:bg-gray-800 rounded-md border dark:border-gray-700 p-2 flex items-end justify-between">
                                    {[...quiz.history]
                                      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
                                      .map((attempt, i, arr) => (
                                        <div 
                                          key={i} 
                                          className="flex flex-col items-center"
                                          style={{ 
                                            width: `${100 / Math.max(arr.length, 1)}%`, 
                                            maxWidth: '60px' 
                                          }}
                                        >
                                          <div 
                                            className={`w-full max-w-[30px] rounded-t-sm ${
                                              (attempt.score / attempt.totalQuestions) >= 0.8 
                                                ? 'bg-green-500' 
                                                : (attempt.score / attempt.totalQuestions) >= 0.6 
                                                  ? 'bg-yellow-500' 
                                                  : 'bg-red-500'
                                            }`}
                                            style={{ height: `${(attempt.score / attempt.totalQuestions) * 100}%` }}
                                          ></div>
                                          <div className="text-xs mt-1 text-gray-700 dark:text-gray-300 overflow-hidden text-ellipsis whitespace-nowrap">
                                            {new Date(attempt.date).toLocaleDateString()}
                                          </div>
                                        </div>
                                      ))}
                                  </div>
                                </div>
                              )}

                              <div className="pt-2">
                                <Button 
                                  variant="outline" 
                                  size="sm"
                                  onClick={() => handleStartQuiz(quiz)}
                                  className="w-full"
                                >
                                  Take Quiz Again
                                </Button>
                              </div>
                            </div>
                          </motion.div>
                        ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          </motion.div>
        </TabsContent>

        <TabsContent value="import-export">
          <motion.div 
            className="grid grid-cols-1 md:grid-cols-2 gap-6"
            variants={containerVariants}
            initial="hidden"
            animate="visible"
          >
            {/* Backup and Restore Section */}
            <motion.div variants={itemVariants} className="md:col-span-2">
              <Card>
                <CardHeader>
                  <CardTitle>Backup and Restore</CardTitle>
                  <CardDescription>
                    Create a backup of all your quizzes and history or restore your data from a previous backup
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap gap-4">
                    <Button 
                      variant="default" 
                      onClick={handleBackupAllData}
                      className="flex items-center gap-2"
                    >
                      <Database className="h-4 w-4" />
                      Backup All Quizzes
                    </Button>
                    <Button 
                      variant="outline" 
                      onClick={handleRestoreFromBackup}
                      className="flex items-center gap-2"
                    >
                      <RotateCcw className="h-4 w-4" />
                      Restore from Backup
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
            
            <motion.div variants={itemVariants} className="md:col-span-2">
              <Card>
                <CardHeader>
                  <CardTitle>Merge Quizzes</CardTitle>
                  <CardDescription>
                    Combine questions from multiple quizzes into a single quiz
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {quizzes.length < 2 ? (
                    <div className="text-center py-8">
                      <p className="text-gray-500 dark:text-gray-300">You need at least two quizzes to use the merge feature.</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div>
                        <Label>Select quizzes to merge</Label>
                        <div className="grid gap-2 mt-2">
                          <div className="flex items-center justify-between">
                            <Button 
                              variant="outline" 
                              onClick={() => setQuizzesToMerge([])}
                              size="sm"
                            >
                              Clear Selection
                            </Button>
                          </div>
                          
                          <ScrollArea className="h-48 border rounded-md p-2">
                            {quizzes.map((quiz, index) => (
                              <div 
                                key={index} 
                                className={`
                                  p-2 mb-2 rounded 
                                  ${quizzesToMerge.includes(index) 
                                    ? 'bg-primary/20 border-primary/50 border' 
                                    : 'hover:bg-muted'
                                  }
                                  cursor-pointer transition-colors
                                `}
                                onClick={() => toggleQuizMergeSelection(index)}
                              >
                                <div className="flex items-center">
                                  <Checkbox 
                                    checked={quizzesToMerge.includes(index)}
                                    onCheckedChange={() => toggleQuizMergeSelection(index)}
                                  />
                                  <div className="ml-2 flex-1">
                                    <h4 className="text-sm font-medium">{quiz.title}</h4>
                                    <p className="text-xs text-gray-500">
                                      {quiz.questions.length} questions · {quiz.category}
                                    </p>
                                  </div>
                                  <Badge variant="outline" className="ml-2">
                                    {quiz.category}
                                  </Badge>
                                </div>
                              </div>
                            ))}
                          </ScrollArea>
                        </div>
                      </div>
                      
                      <div className="flex justify-end">
                        <Button 
                          variant="default" 
                          onClick={() => setIsMergeModalOpen(true)}
                          disabled={quizzesToMerge.length < 2}
                          className="bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600"
                        >
                          <Pencil className="mr-2 h-4 w-4" />
                          Merge Selected Quizzes
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
            
            <motion.div variants={itemVariants}>
              <Card>
                <CardHeader>
                  <CardTitle>Import Quizzes</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label>Import from JSON file</Label>
                    <div 
                      className="border-2 border-dashed border-gray-300 p-4 rounded-md text-center mt-2 cursor-pointer hover:bg-gray-50"
                      onClick={() => {
                        document.getElementById('json-file-upload')?.click();
                      }}
                    >
                      <div className="space-y-1">
                        <Upload className="mx-auto h-12 w-12 text-gray-400" />
                        <p className="text-sm text-gray-500">Click to upload or drag and drop</p>
                        <p className="text-xs text-gray-500">Only JSON files</p>
                      </div>
                      <input
                        id="json-file-upload"
                        type="file"
                        className="hidden"
                        accept=".json"
                        onChange={handleImportQuiz}
                      />
                    </div>
                  </div>

                  <div>
                    <Label>Or paste JSON code</Label>
                    <Textarea
                      value={importJson}
                      onChange={(e) => setImportJson(e.target.value)}
                      onFocus={handleFocus}
                      onBlur={handleBlur}
                      rows={10}
                      className="font-mono text-sm mt-2"
                    />
                  </div>

                  <div className="flex justify-between gap-2 mt-2">
                    <Button
                      onClick={handleCopyFormat}
                      variant="outline"
                      className="flex-1"
                    >
                      <Copy className="mr-2 h-4 w-4" /> Copy Format
                    </Button>
                    <Button
                      onClick={handleImportJson}
                      className="flex-1"
                    >
                      <Upload className="mr-2 h-4 w-4" /> Import
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            <motion.div variants={itemVariants}>
              <Card>
                <CardHeader>
                  <CardTitle>Export Quizzes</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {quizzes.length === 0 ? (
                    <div className="text-center py-8">
                      <p className="text-gray-500 dark:text-gray-300">No quizzes available for export.</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div>
                        <Label>Choose what to export</Label>
                        <div className="flex mt-2 space-x-3">
                          <div className="flex items-center space-x-2">
                            <Checkbox
                              id="export-all"
                              checked={exportOption === 'all'}
                              onCheckedChange={() => setExportOption('all')}
                            />
                            <Label htmlFor="export-all">All quizzes</Label>
                          </div>
                          <div className="flex items-center space-x-2">
                            <Checkbox
                              id="export-specific"
                              checked={exportOption === 'specific'}
                              onCheckedChange={() => setExportOption('specific')}
                            />
                            <Label htmlFor="export-specific">Select specific quizzes</Label>
                          </div>
                        </div>
                      </div>

                      {exportOption === 'specific' && (
                        <div className="border rounded-md p-3 space-y-2 max-h-96 overflow-y-auto">
                          {quizzes.map((quiz, index) => (
                            <div key={index} className="flex items-center space-x-2">
                              <Checkbox
                                id={`quiz-${index}`}
                                checked={selectedQuizzes.includes(index)}
                                onCheckedChange={() => toggleQuizSelection(index)}
                              />
                              <Label htmlFor={`quiz-${index}`} className="font-medium">
                                {quiz.title}
                              </Label>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-2">
                        <motion.div 
                          className="w-full" 
                          whileHover={{ 
                            scale: 1.02,
                            transition: { duration: 0.2 }
                          }}
                          whileTap={{ scale: 0.98 }}
                          animate={{
                            y: [0, -2, 0],
                            transition: { duration: 2, repeat: Infinity }
                          }}
                        >
                          <Button
                            onClick={handleExportQuiz}
                            className="w-full relative overflow-hidden group transition-all duration-300 ease-in-out"
                          >
                            <motion.span 
                              className="absolute inset-0 bg-gradient-to-r from-primary/5 to-primary/20 opacity-0 group-hover:opacity-100"
                              initial={{ y: 40, opacity: 0 }}
                              animate={{ y: -40, opacity: 0.5 }}
                              transition={{ duration: 1.5, repeat: Infinity, repeatType: "loop" }}
                            />
                            
                            <motion.div 
                              className="flex items-center justify-center relative z-10"
                              animate={{ 
                                scale: [1, 1.05, 1],
                              }}
                              transition={{
                                duration: 2,
                                repeat: Infinity,
                                repeatType: "reverse"
                              }}
                            >
                              <motion.div
                                animate={{
                                  y: [0, -3, 0],
                                  rotate: [0, -5, 0, 5, 0]
                                }}
                                transition={{
                                  duration: 2,
                                  repeat: Infinity,
                                  repeatType: "loop"
                                }}
                              >
                                <Download className="h-4 w-4 mr-2 group-hover:text-primary" />
                              </motion.div>
                              <motion.span 
                                className="group-hover:font-medium"
                                animate={{ 
                                  scale: [1, 1.03, 1],
                                }}
                                transition={{ 
                                  duration: 2, 
                                  repeat: Infinity 
                                }}
                              >
                                Export
                              </motion.span>
                            </motion.div>
                          </Button>
                        </motion.div>
                        <motion.div 
                          className="w-full" 
                          whileHover={{ 
                            scale: 1.02,
                            transition: { duration: 0.2 }
                          }}
                          whileTap={{ scale: 0.98 }}
                          animate={{
                            boxShadow: ["0px 0px 0px rgba(0,0,0,0)", "0px 4px 6px rgba(0,0,0,0.1)", "0px 0px 0px rgba(0,0,0,0)"]
                          }}
                          transition={{ 
                            duration: 2, 
                            repeat: Infinity,
                            repeatType: "reverse" 
                          }}
                        >
                          <Button
                            onClick={handleShareQuiz}
                            className="w-full relative overflow-hidden group transition-all duration-300 ease-in-out"
                            variant="outline"
                          >
                            <motion.span 
                              className="absolute inset-0 bg-gradient-to-r from-blue-100/20 to-blue-300/10 dark:from-blue-900/20 dark:to-blue-700/10 opacity-0 group-hover:opacity-100"
                              initial={{ x: -100, opacity: 0 }}
                              animate={{ x: 200, opacity: 0.7 }}
                              transition={{ duration: 2, repeat: Infinity, repeatType: "loop" }}
                            />
                            
                            <motion.div 
                              className="relative z-10 flex items-center justify-center"
                              animate={{
                                scale: [1, 1.05, 1],
                              }}
                              transition={{
                                duration: 2,
                                repeat: Infinity,
                                repeatType: "reverse"
                              }}
                            >
                              <motion.svg 
                                xmlns="http://www.w3.org/2000/svg" 
                                viewBox="0 0 24 24" 
                                fill="none" 
                                stroke="currentColor" 
                                strokeWidth="2" 
                                strokeLinecap="round" 
                                strokeLinejoin="round" 
                                className="h-4 w-4 mr-2 group-hover:text-primary"
                                animate={{ 
                                  rotate: [0, 10, 0, -10, 0]
                                }}
                                transition={{
                                  duration: 5,
                                  repeat: Infinity
                                }}
                              >
                                <motion.circle 
                                  cx="18" 
                                  cy="5" 
                                  r="3"
                                  animate={{ scale: [1, 1.3, 1] }}
                                  transition={{ duration: 2, repeat: Infinity }}
                                ></motion.circle>
                                <motion.circle 
                                  cx="6" 
                                  cy="12" 
                                  r="3"
                                  animate={{ scale: [1, 1.3, 1] }}
                                  transition={{ duration: 2, repeat: Infinity, delay: 0.3 }}
                                ></motion.circle>
                                <motion.circle 
                                  cx="18" 
                                  cy="19" 
                                  r="3"
                                  animate={{ scale: [1, 1.3, 1] }}
                                  transition={{ duration: 2, repeat: Infinity, delay: 0.6 }}
                                ></motion.circle>
                                <motion.line 
                                  x1="8.59" 
                                  y1="13.51" 
                                  x2="15.42" 
                                  y2="17.49"
                                  stroke="currentColor"
                                  strokeDasharray="10"
                                  animate={{ 
                                    strokeDashoffset: [10, 0, 10]
                                  }}
                                  transition={{ 
                                    duration: 2,
                                    repeat: Infinity
                                  }}
                                ></motion.line>
                                <motion.line 
                                  x1="15.41" 
                                  y1="6.51" 
                                  x2="8.59" 
                                  y2="10.49"
                                  stroke="currentColor"
                                  strokeDasharray="10"
                                  animate={{ 
                                    strokeDashoffset: [10, 0, 10]
                                  }}
                                  transition={{ 
                                    duration: 2,
                                    repeat: Infinity,
                                    delay: 0.5
                                  }}
                                ></motion.line>
                              </motion.svg>
                              <motion.span 
                                className="group-hover:font-medium"
                                animate={{ 
                                  scale: [1, 1.03, 1],
                                }}
                                transition={{ 
                                  duration: 2, 
                                  repeat: Infinity 
                                }}
                              >
                                Share
                              </motion.span>
                            </motion.div>
                          </Button>
                        </motion.div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          </motion.div>
        </TabsContent>
      </Tabs>

      {/* Merge Quizzes Dialog */}
      <Dialog open={isMergeModalOpen} onOpenChange={setIsMergeModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Merge Quizzes</DialogTitle>
            <DialogDescription>
              Create a new quiz by combining questions from selected quizzes
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="merged-quiz-title">New Quiz Title</Label>
              <Input
                id="merged-quiz-title"
                value={mergedQuizTitle}
                onChange={(e) => setMergedQuizTitle(e.target.value)}
                placeholder="Enter title for the merged quiz"
              />
            </div>
            <div>
              <Label htmlFor="merged-quiz-category">Quiz Category</Label>
              <Select 
                value={mergedQuizCategory} 
                onValueChange={(value) => setMergedQuizCategory(value as QuizCategory)}
              >
                <SelectTrigger id="merged-quiz-category">
                  <SelectValue placeholder="Select a category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="General Knowledge">General Knowledge</SelectItem>
                  <SelectItem value="Mathematics">Mathematics</SelectItem>
                  <SelectItem value="Science">Science</SelectItem>
                  <SelectItem value="Reasoning">Reasoning</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="pt-2">
              <h4 className="text-sm font-medium mb-2">Selected Quizzes:</h4>
              <ScrollArea className="h-24 border rounded-md p-2">
                {quizzesToMerge.map((index) => (
                  <div key={index} className="flex items-center py-1">
                    <span className="h-2 w-2 rounded-full bg-blue-500 mr-2"></span>
                    <span className="text-sm">{quizzes[index].title}</span>
                    <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">
                      ({quizzes[index].questions.length} questions)
                    </span>
                  </div>
                ))}
              </ScrollArea>
            </div>
            
            <div className="border-t pt-4 mt-2">
              <p className="text-sm">
                <strong>Total Questions:</strong>{' '}
                {quizzesToMerge.reduce((total, index) => total + quizzes[index].questions.length, 0)}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsMergeModalOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleMergeQuizzes}
              disabled={!mergedQuizTitle.trim() || quizzesToMerge.length < 2}
              className="bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600"
            >
              Create Merged Quiz
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Export Dialog */}
      <Dialog open={isExportModalOpen} onOpenChange={setIsExportModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Export Quizzes</DialogTitle>
            <DialogDescription>
              Choose how you want to export your quizzes
            </DialogDescription>
          </DialogHeader>
          <div>
            {exportedJson ? (
              <div className="space-y-4">
                <div className="p-3 border rounded-md bg-muted max-h-40 overflow-y-auto">
                  <pre className="text-xs whitespace-pre-wrap break-all">{exportedJson.length > 300 ? exportedJson.substring(0, 300) + '...' : exportedJson}</pre>
                </div>
                <div className="flex flex-col space-y-3">
                  <Button 
                    onClick={() => {
                      try {
                        navigator.clipboard.writeText(exportedJson);
                        toast({
                          title: "Copied!",
                          description: "Quiz data copied to clipboard",
                          variant: "default",
                        });
                      } catch (err) {
                        console.error('Clipboard error:', err);
                        toast({
                          title: "Copy failed",
                          description: "Could not copy to clipboard. Try the download option.",
                          variant: "destructive",
                        });
                      }
                    }}
                    className="w-full"
                  >
                    <svg 
                      xmlns="http://www.w3.org/2000/svg" 
                      viewBox="0 0 24 24" 
                      fill="none" 
                      stroke="currentColor" 
                      strokeWidth="2" 
                      strokeLinecap="round" 
                      strokeLinejoin="round" 
                      className="h-4 w-4 mr-2"
                    >
                      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
                      <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
                    </svg>
                    Copy to Clipboard
                  </Button>

                  <Button 
                    onClick={async () => {
                      try {
                        // Use the Web Share API for mobile sharing
                        if (navigator.share) {
                          // Create a blob from the encoded data
                          const blob = new Blob([exportedJson], { type: 'application/json' });
                          
                          // Check if files can be shared in this environment
                          if (navigator.canShare && navigator.canShare({ files: [new File([blob], exportFilename)] })) {
                            // Share as a file with the dynamic filename
                            await navigator.share({
                              title: 'BMV Quiz Data',
                              text: `Sharing quiz: ${exportFilename}`,
                              files: [new File([blob], exportFilename, { type: 'application/json' })]
                            });
                          } else {
                            // Fallback to basic URL sharing if file sharing not supported
                            await navigator.share({
                              title: 'BMV Quiz Data',
                              text: `Sharing quiz: ${exportFilename}`,
                              url: 'data:text/json;charset=utf-8,' + encodeURIComponent(exportedJson)
                            });
                          }
                          toast({
                            title: "Share successful",
                            description: "Quiz data shared successfully",
                            variant: "default",
                          });
                        } else {
                          throw new Error("Web Share API not supported");
                        }
                      } catch (err) {
                        console.error('Share error:', err);
                        try {
                          // Fallback to clipboard
                          navigator.clipboard.writeText(exportedJson);
                          toast({
                            title: "Copied!",
                            description: "Sharing not available. Quiz data copied to clipboard instead.",
                            variant: "default",
                          });
                        } catch (clipErr) {
                          console.error('Fallback share error:', clipErr);
                          toast({
                            title: "Share failed",
                            description: "Could not share quiz data. Try the copy option.",
                            variant: "destructive",
                          });
                        }
                      }
                    }}
                    variant="outline"
                    className="w-full"
                  >
                    <svg 
                      xmlns="http://www.w3.org/2000/svg" 
                      viewBox="0 0 24 24" 
                      fill="none" 
                      stroke="currentColor" 
                      strokeWidth="2" 
                      strokeLinecap="round" 
                      strokeLinejoin="round" 
                      className="h-4 w-4 mr-2"
                    >
                      <circle cx="18" cy="5" r="3"></circle>
                      <circle cx="6" cy="12" r="3"></circle>
                      <circle cx="18" cy="19" r="3"></circle>
                      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
                      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
                    </svg>
                    Share Quiz Data
                  </Button>

                  <motion.div 
                    className="w-full"
                    whileHover={{ 
                      scale: 1.02,
                      transition: { duration: 0.2 }
                    }}
                    whileTap={{ scale: 0.98 }}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ 
                      opacity: 1, 
                      y: 0,
                      boxShadow: ["0px 0px 0px rgba(0,0,0,0)", "0px 4px 8px rgba(0,0,0,0.1)", "0px 0px 0px rgba(0,0,0,0)"]
                    }}
                    transition={{ 
                      duration: 0.5,
                      boxShadow: {
                        repeat: Infinity,
                        repeatType: "reverse",
                        duration: 2
                      }
                    }}
                  >
                    <Button 
                      onClick={() => {
                        try {
                          // Visual feedback animation
                          const button = document.activeElement as HTMLElement;
                          if (button) {
                            button.classList.add('downloading-animation');
                            setTimeout(() => button.classList.remove('downloading-animation'), 1000);
                          }
                          
                          // Create feedback for user
                          toast({
                            title: "Downloading quiz data...",
                            description: "Preparing your quiz data for download.",
                          });

                          // Try multiple download methods in sequence
                          const tryDownload = async () => {
                            // APPROACH 1: Use File System Access API if available (modern browsers)
                            // Skip it on mobile environments where it often fails
                            const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
                            
                            if (window?.showSaveFilePicker && !isMobile) {
                              try {
                                const opts = {
                                  suggestedName: exportFilename,
                                  types: [{
                                    description: 'JSON Files',
                                    accept: {'application/json': ['.json']}
                                  }]
                                };
                                
                                const fileHandle = await window.showSaveFilePicker?.(opts);
                                if (fileHandle) {
                                  const writable = await fileHandle.createWritable();
                                  await writable.write(exportedJson);
                                  await writable.close();
                                  
                                  toast({
                                    title: "Download successful",
                                    description: "Quiz data saved successfully!",
                                  });
                                  return true; // Success with modern method
                                }
                              } catch (fsapiError) {
                                console.warn('File System Access API failed, trying fallback:', fsapiError);
                                // Continue to fallback methods
                              }
                            }
                            
                            // APPROACH 2: Use Blob method (more compatible)
                            try {
                              const blob = new Blob([exportedJson], { type: 'application/octet-stream' });
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement('a');
                              a.href = url;
                              a.download = exportFilename;
                              document.body.appendChild(a);
                              a.click();
                              
                              // Clean up
                              setTimeout(() => {
                                document.body.removeChild(a);
                                URL.revokeObjectURL(url);
                              }, 100);
                              
                              toast({
                                title: "Download successful",
                                description: "Quiz data downloaded successfully!",
                              });
                              return true; // Success with blob method
                            } catch (blobError) {
                              console.warn('Blob download failed, trying data URI:', blobError);
                              // Continue to final fallback
                            }
                            
                            // APPROACH 3: Basic data URI approach (most compatible)
                            try {
                              const a = document.createElement('a');
                              a.href = 'data:text/json;charset=utf-8,' + encodeURIComponent(exportedJson);
                              a.download = exportFilename;
                              document.body.appendChild(a);
                              a.click();
                              
                              // Clean up
                              setTimeout(() => {
                                document.body.removeChild(a);
                              }, 100);
                              
                              toast({
                                title: "Download successful",
                                description: "Quiz data downloaded successfully!",
                              });
                              return true; // Success with data URI
                            } catch (dataUriError) {
                              console.error('All download methods failed:', dataUriError);
                              return false;
                            }
                          };
                          
                          // Try downloading with all methods
                          tryDownload().catch(error => {
                            console.error('Download failed:', error);
                            toast({
                              title: "Download failed",
                              description: "There was a problem downloading the quiz data. Please try again.",
                              variant: "destructive"
                            });
                          });
                        } catch (error) {
                          console.error('Download execution error:', error);
                          toast({
                            title: "Download failed",
                            description: "There was a problem downloading the quiz data. Please try again.",
                            variant: "destructive"
                          });
                        }
                      }}
                      variant="secondary"
                      className="w-full relative overflow-hidden group transition-all duration-300 ease-in-out transform hover:translate-y-[-2px] hover:shadow-lg active:translate-y-[1px]"
                    >
                      <motion.span 
                        className="absolute inset-0 bg-gradient-to-r from-primary/10 to-primary/20 opacity-0 group-hover:opacity-100"
                        initial={{ x: -100, opacity: 0 }}
                        animate={{ x: 300, opacity: 0.5 }}
                        transition={{ duration: 1.5, repeat: Infinity, repeatType: "loop", ease: "linear" }}
                      />
                      <motion.div 
                        className="flex items-center justify-center relative z-10"
                        animate={{ 
                          scale: [1, 1.05, 1] 
                        }}
                        transition={{ 
                          duration: 2, 
                          repeat: Infinity, 
                          repeatType: "reverse" 
                        }}
                      >
                        <Download className="h-4 w-4 mr-2 group-hover:animate-bounce" />
                        <span className="group-hover:font-medium">Download Quiz</span>
                      </motion.div>
                    </Button>
                  </motion.div>
                  
                  {/* Add CSS for button animation */}
                  <style jsx global>{`
                    @keyframes downloadPulse {
                      0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(0, 120, 255, 0.4); }
                      50% { transform: scale(1.05); box-shadow: 0 0 0 6px rgba(0, 120, 255, 0); }
                      100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(0, 120, 255, 0); }
                    }
                    
                    .downloading-animation {
                      animation: downloadPulse 1s ease infinite;
                    }
                  `}</style>
                </div>
              </div>
            ) : (
              <div className="py-4">
                <p className="text-sm text-gray-500 mb-4">
                  Your quizzes are ready to be exported. Choose what to export below.
                </p>
                <div className="space-y-4">
                  <div>
                    <Label>Choose what to export</Label>
                    <div className="flex mt-2 space-x-3">
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="export-all-modal"
                          checked={exportOption === 'all'}
                          onCheckedChange={() => setExportOption('all')}
                        />
                        <Label htmlFor="export-all-modal">All quizzes</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="export-specific-modal"
                          checked={exportOption === 'specific'}
                          onCheckedChange={() => setExportOption('specific')}
                        />
                        <Label htmlFor="export-specific-modal">Specific quizzes</Label>
                      </div>
                    </div>
                  </div>

                  {exportOption === 'specific' && (
                    <div className="border rounded-md p-3 space-y-2 max-h-40 overflow-y-auto">
                      {quizzes.map((quiz, index) => (
                        <div key={index} className="flex items-center space-x-2">
                          <Checkbox
                            id={`quiz-export-${index}`}
                            checked={selectedQuizzes.includes(index)}
                            onCheckedChange={() => toggleQuizSelection(index)}
                          />
                          <Label htmlFor={`quiz-export-${index}`} className="font-medium">
                            {quiz.title}
                          </Label>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setIsExportModalOpen(false);
              setExportedJson("");
            }}>
              Close
            </Button>
            {!exportedJson && (
              <Button onClick={handleExport}>
                <Download className="h-4 w-4 mr-2" />
                Prepare Export
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Password Dialog */}
      <Dialog open={passwordDialogOpen} onOpenChange={setPasswordDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Password Required</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-gray-500 mb-4">
              This quiz is password-protected. Please enter the password to edit it.
            </p>
            <Input
              type="password"
              placeholder="Enter password"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handlePasswordSubmit();
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPasswordDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handlePasswordSubmit}>Submit</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isQuizModalOpen} onOpenChange={(open) => {
          // Only allow closing the dialog if the quiz isn't running
          if (!isQuizRunning || !open) {
            setIsQuizModalOpen(open);
          }
        }}>
        <DialogContent 
          className="max-w-2xl p-0 max-h-[90vh] overflow-auto" 
          onInteractOutside={(e) => {
            // Prevent closing when clicking outside while quiz is running
            if (isQuizRunning) {
              e.preventDefault();
            }
          }}
          onEscapeKeyDown={(e) => {
            // Prevent closing with ESC key while quiz is running
            if (isQuizRunning) {
              e.preventDefault();
            }
          }}
        >
          <DialogHeader className="px-6 pt-6 sticky top-0 z-10 bg-background">
            {isQuizRunning && currentQuiz && (
              <div className="flex justify-between items-center mb-2">
                <DialogTitle>{currentQuiz.title}</DialogTitle>
                <motion.div 
                  className={`flex items-center text-sm font-mono px-3 py-1 rounded-full
                    ${timer <= 30 
                      ? 'bg-red-100 text-red-700' 
                      : timer <= 60 
                        ? 'bg-yellow-100 text-yellow-700' 
                        : 'bg-gray-100 text-gray-700'}`}
                  animate={timer <= 30 ? { 
                    scale: [1, 1.05, 1],
                    backgroundColor: ['#fee2e2', '#fecaca', '#fee2e2']
                  } : {}}
                  transition={{ 
                    repeat: timer <= 30 ? Infinity : 0, 
                    duration: 1
                  }}
                >
                  <Clock className={`h-4 w-4 mr-2 ${timer <= 30 ? 'text-red-500' : 'text-primary'}`} />
                  {formatTime(timer)}
                </motion.div>
              </div>
            )}
            {showResults && <DialogTitle>Quiz Results</DialogTitle>}
          </DialogHeader>

          {isQuizRunning && currentQuiz && (
            <>
              <div className="px-6 py-4">
                {/* Enhanced animated progress bar */}
                <div className="relative mb-4">
                  <motion.div
                    className={`h-2 rounded-full overflow-hidden ${progressBarPattern}`}
                  >
                    <Progress
                      value={((currentQuestionIndex + 1) / currentQuiz.questions.length) * 100}
                      className={`h-2 transition-all ${progressBarColor}`}
                    />
                  </motion.div>
                  
                  {/* Fun animated progress indicators */}
                  <motion.div 
                    className="absolute top-0 left-0 h-full"
                    style={{ 
                      left: `${((currentQuestionIndex + 1) / currentQuiz.questions.length) * 100}%`,
                      transform: 'translateX(-50%)'
                    }}
                    animate={{
                      y: [0, -3, 0],
                      scale: [1, 1.2, 1]
                    }}
                    transition={{ 
                      duration: 1.5, 
                      repeat: Infinity,
                      repeatType: "reverse"
                    }}
                  >
                    <div className="w-3 h-3 bg-primary rounded-full" />
                  </motion.div>
                </div>
                
                <motion.p 
                  className="text-sm text-gray-500 text-right mb-4"
                  animate={{ 
                    opacity: [0.7, 1, 0.7],
                    scale: loadingQuestion ? [1, 1.05, 1] : 1
                  }}
                  transition={{ 
                    duration: 1.5, 
                    repeat: Infinity,
                    repeatType: "reverse"
                  }}
                >
                  Question {currentQuestionIndex + 1} of {currentQuiz.questions.length}
                </motion.p>

                <AnimatePresence mode="wait">
                  <motion.div 
                    key={currentQuestionIndex}
                    initial={{ opacity: 0, x: 50 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -50 }}
                    className="space-y-6"
                  >
                    <div>
                      <h3 className="text-lg font-semibold mb-2">
                        {currentQuiz.questions[currentQuestionIndex].question}
                      </h3>
                      {currentQuiz.questions[currentQuestionIndex].questionImages.length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-4">
                          {currentQuiz.questions[currentQuestionIndex].questionImages.map((img, i) => (
                            <img
                              key={i}
                              src={img}
                              alt={`Question ${currentQuestionIndex + 1} image ${i + 1}`}
                              className="max-h-40 rounded"
                            />
                          ))}
                        </div>
                      )}
                    </div>

                    <RadioGroup
                      value={selectedAnswers[currentQuestionIndex] || ""}
                      onValueChange={handleAnswer}
                      className="space-y-2"
                    >
                      {currentQuiz.questions[currentQuestionIndex].options.map((option, i) => (
                        <motion.div 
                          key={i} 
                          className="flex items-center space-x-2"
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.1 }}
                        >
                          <RadioGroupItem value={option} id={`option-${i}`} />
                          <Label htmlFor={`option-${i}`} className="text-base">
                            {option}
                          </Label>
                        </motion.div>
                      ))}
                    </RadioGroup>
                  </motion.div>
                </AnimatePresence>
              </div>
              <DialogFooter className="px-6 py-4 bg-gray-50 flex justify-between">
                <div>
                  {currentQuestionIndex > 0 && (
                    <Button variant="outline" onClick={previousQuestion}>
                      <ArrowLeft className="mr-2 h-4 w-4" />
                      Previous
                    </Button>
                  )}
                </div>
                <Button onClick={nextQuestion}>
                  {currentQuestionIndex < currentQuiz.questions.length - 1 ? (
                    <>
                      Next Question
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </>
                  ) : (
                    'Finish Quiz'
                  )}
                </Button>
              </DialogFooter>
            </>
          )}

          {showResults && currentQuiz && (
            <>
              <div className="px-6 py-4">
                <motion.div 
                  className="text-center mb-6"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.5 }}
                >
                  <div className="inline-flex items-center justify-center w-24 h-24 rounded-full bg-primary/10 mb-4">
                    <div className="text-3xl font-bold text-primary quiz-score-counter">
                      {score}/{currentQuiz.questions.length}
                    </div>
                  </div>
                  <h3 className="text-lg font-semibold quiz-results-heading">
                    {score === currentQuiz.questions.length
                      ? 'Perfect Score! 🎉'
                      : score >= currentQuiz.questions.length / 2
                      ? 'Good Job! 👍'
                      : 'Keep Practicing! 💪'}
                  </h3>
                  <p className="text-gray-500 mt-1 quiz-score">
                    You answered {score} out of {currentQuiz.questions.length} questions correctly.
                  </p>
                </motion.div>

                <motion.div 
                  className="space-y-6"
                  variants={containerVariants}
                  initial="hidden"
                  animate="visible"
                >
                  {currentQuiz.questions.map((question, index) => (
                    <motion.div 
                      key={index} 
                      className="border dark:border-gray-700 rounded-lg p-4 dark:bg-gray-900/30"
                      variants={itemVariants}
                      whileHover={{ 
                        scale: 1.01,
                        boxShadow: "0px 4px 8px rgba(0, 0, 0, 0.1)"
                      }}
                      transition={{ type: "spring", stiffness: 400, damping: 10 }}
                    >
                      <div className="flex items-start gap-2">
                        {selectedAnswers[index] === question.correctAnswer ? (
                          <motion.div 
                            className="bg-green-500 text-white p-1 rounded-full mt-1"
                            animate={{
                              scale: [1, 1.2, 1],
                              boxShadow: [
                                "0px 0px 0px rgba(0,200,0,0)",
                                "0px 0px 8px rgba(0,200,0,0.5)",
                                "0px 0px 0px rgba(0,200,0,0)"
                              ]
                            }}
                            transition={{
                              duration: 2,
                              repeat: Infinity,
                              repeatType: "reverse"
                            }}
                          >
                            <Check className="h-4 w-4" />
                          </motion.div>
                        ) : (
                          <motion.div 
                            className="bg-red-500 text-white p-1 rounded-full mt-1"
                            initial={{ rotate: 0 }}
                            animate={{ rotate: [0, -10, 10, -10, 0] }}
                            transition={{
                              duration: 0.5,
                              delay: 0.2
                            }}
                          >
                            <X className="h-4 w-4" />
                          </motion.div>
                        )}
                        <div>
                          <h4 className="font-medium dark:text-white question-text">{question.question}</h4>
                          <div className="mt-2 space-y-1">
                            {question.options.map((option, i) => (
                              <div 
                                key={i} 
                                className={`text-sm p-2 rounded ${
                                  option === question.correctAnswer
                                    ? 'bg-green-100 dark:bg-green-900/30 border border-green-300 dark:border-green-600 dark:text-gray-100'
                                    : selectedAnswers[index] === option && selectedAnswers[index] !== question.correctAnswer
                                    ? 'bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-600 dark:text-gray-100'
                                    : 'bg-gray-50 dark:bg-gray-800 dark:text-gray-100'
                                }`}
                              >
                                {option}
                                {option === question.correctAnswer && (
                                  <span className="ml-2 text-green-600 dark:text-green-400 text-xs font-medium">(Correct)</span>
                                )}
                              </div>
                            ))}
                          </div>
                          {/* Question Images */}                          {question.questionImages.length > 0 && (
                            <div className="mt-3">
                              <p className="font-medium text-sm mb-2 dark:text-gray-300">Question Images:</p>
                              <div className="overflow-x-auto flex gap-2 pb-2 max-h-48">
                                {question.questionImages.map((img, imgIndex) => (
                                  <img 
                                    key={imgIndex} 
                                    src={img} 
                                    alt={`Question ${index + 1} image ${imgIndex + 1}`} 
                                    className="max-h-40 object-contain rounded border border-gray-200 dark:border-gray-700"
                                  />
                                ))}
                              </div>
                            </div>
                          )}

                          <div className="mt-3 text-sm text-gray-600 dark:text-gray-300 explanation-container">
                            <p className="font-medium dark:text-gray-200">Explanation:</p>
                            <p className="explanation-text">{question.answerDescription}</p>
                          </div>

                          {/* Answer Images */}
                          {question.answerImages.length > 0 && (
                            <div className="mt-3">
                              <p className="font-medium text-sm mb-2 dark:text-gray-300">Answer Images:</p>
                              <div className="overflow-x-auto flex gap-2 pb-2 max-h-48">
                                {question.answerImages.map((img, imgIndex) => (
                                  <img 
                                    key={imgIndex} 
                                    src={img} 
                                    alt={`Answer ${index + 1} image ${imgIndex + 1}`} 
                                    className="max-h-40 object-contain rounded border border-gray-200 dark:border-gray-700"
                                  />
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </motion.div>

                <div className="text-center">
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
                    You can take this quiz again after 10 minutes.
                  </p>
                </div>
              </div>
              <DialogFooter className="sticky bottom-0 z-10 bg-background px-6 py-4 border-t">
                <div className="flex w-full flex-col sm:flex-row sm:justify-between gap-3">
                  <div className="flex gap-2">
                    <Button 
                      variant="outline" 
                      onClick={() => {
                        if (currentQuiz) {
                          // Create a quiz attempt object for sharing
                          const attempt: QuizAttempt = {
                            date: new Date(),
                            score: score,
                            totalQuestions: currentQuiz.questions.length,
                            timeSpent: currentQuiz.timer - timer,
                            questionResults: currentQuiz.questions.map((question, idx) => ({
                              question: question.question,
                              userAnswer: selectedAnswers[idx] || '',
                              correctAnswer: question.correctAnswer,
                              isCorrect: selectedAnswers[idx] === question.correctAnswer
                            }))
                          };
                          
                          handleShareResult(currentQuiz, attempt);
                        }
                      }}
                      className="w-full sm:w-auto"
                    >
                      <Share2 className="h-4 w-4 mr-2" />
                      Share Results
                    </Button>
                    <Button 
                      variant="outline" 
                      onClick={() => {
                        // Create and save result image
                        if (currentQuiz) {
                          const attempt = {
                            date: new Date(),
                            score: score,
                            totalQuestions: currentQuiz.questions.length,
                            timeSpent: currentQuiz.timer - timer,
                            questionResults: currentQuiz.questions.map((q, i) => ({
                              question: q.question,
                              userAnswer: selectedAnswers[i] || '',
                              correctAnswer: q.correctAnswer,
                              isCorrect: selectedAnswers[i] === q.correctAnswer
                            }))
                          };
                          
                          saveResultImage(currentQuiz, attempt);
                        } else {
                          toast({
                            title: "Error",
                            description: "Could not generate result image. Please try again.",
                            variant: "destructive"
                          });
                        }
                      }}
                      className="w-full sm:w-auto"
                    >
                      <Image className="h-4 w-4 mr-2" />
                      Save as Image
                    </Button>
                  </div>
                  <Button onClick={resetQuiz} className="w-full sm:w-auto">Close Results</Button>
                </div>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Password Dialog for Quiz Deletion */}
      <Dialog open={deletePasswordDialogOpen} onOpenChange={setDeletePasswordDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Password Required</DialogTitle>
            <DialogDescription>
              Enter the master password to delete this quiz.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Input
              type="password"
              placeholder="Enter password"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button onClick={() => setDeletePasswordDialogOpen(false)} variant="outline">
              Cancel
            </Button>
            <Button onClick={handleDeleteQuizConfirm}>
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}