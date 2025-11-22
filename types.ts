
export enum AppView {
  LOGIN = 'LOGIN',
  HOME = 'HOME',
  LEARNING = 'LEARNING',
  QUIZ = 'QUIZ',
  NOTES_GENERATION = 'NOTES_GENERATION', // The step where notes are being created
  NOTES_LIST = 'NOTES_LIST', // The library of saved notes
  COMPREHENSIVE_EXAM = 'COMPREHENSIVE_EXAM',
}

export interface Topic {
  title: string;
  concept: string;
  exampleCode?: string;
  difficulty: '初级' | '中级' | '高级';
  category?: 'Unity' | 'C#' | 'Network';
}

export interface QuizQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
  timestamp: number;
}

export interface QuizResult {
  score: number;
  total: number;
  answers: number[];
}

export interface SavedNote {
  id: string;
  day: number;
  date: string;
  topics: Topic[];
  content: string;
  quizScore: number;
}

export interface UserData {
  username: string;
  currentDay: number;
  savedNotes: SavedNote[];
  // Simple state persistence for the current active session
  activeSession?: {
    topics: Topic[];
    questions: QuizQuestion[];
    step: 'LEARNING' | 'QUIZ';
  } | null;
}
