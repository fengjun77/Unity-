import React, { useState, useEffect, useRef, useMemo } from 'react';
import { AppView, Topic, QuizQuestion, QuizResult, UserData, SavedNote, TrackType } from './types';
import { generateTopicBatch, generateQuizForBatch, generateStudyNotes, generateComprehensiveQuiz } from './services/geminiService';
import { loadUser, saveUser, completeDay, saveActiveSession, clearActiveSession, getAllUsers } from './services/storage';
import { Spinner } from './components/Spinner';
import { ChatWidget } from './components/ChatWidget';
import { MarkdownView } from './components/MarkdownView';
import { NotesView } from './components/NotesView';

const App: React.FC = () => {
  // User State
  const [user, setUser] = useState<UserData | null>(null);
  const [usernameInput, setUsernameInput] = useState('');
  const [existingUsers, setExistingUsers] = useState<string[]>([]);
  
  // Test Mode State
  const [isTestMode, setIsTestMode] = useState(false);

  // App Flow State
  const [view, setView] = useState<AppView>(AppView.LOGIN);
  const [loading, setLoading] = useState(false);
  const [isReviewing, setIsReviewing] = useState(false);
  
  // Learning State
  const [topics, setTopics] = useState<Topic[]>([]);
  const [currentTopicIndex, setCurrentTopicIndex] = useState(0);
  const dailyTopicCount = isTestMode ? 2 : 10; // Dynamic based on test mode
  
  // Quiz State
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [quizAnswers, setQuizAnswers] = useState<number[]>([]);
  const [quizResult, setQuizResult] = useState<QuizResult | null>(null);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  
  // Notes Generation State (Library state moved to NotesView)
  const [currentNoteContent, setCurrentNoteContent] = useState<string>("");
  
  // Load existing users on mount
  useEffect(() => {
    setExistingUsers(getAllUsers());
  }, []);

  // Auto-scroll to top when navigating topics or questions
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [currentTopicIndex, currentQuestionIndex, view]);

  // Auto-save session whenever topics or questions are updated (and we are in a session view)
  useEffect(() => {
    if (user && topics.length > 0 && (view === AppView.LEARNING || view === AppView.QUIZ)) {
      const updatedUser = saveActiveSession(user, topics, questions, view === AppView.QUIZ ? 'QUIZ' : 'LEARNING');
      // Passive sync
    }
  }, [topics, questions, view, user?.username]);

  // Login Logic
  const handleLogin = (name: string) => {
    if (!name.trim()) return;
    const loadedUser = loadUser(name);
    setUser(loadedUser);
    
    // Resume session if exists
    if (loadedUser.activeSession) {
        setTopics(loadedUser.activeSession.topics);
        setQuestions(loadedUser.activeSession.questions);
        if (loadedUser.activeSession.step === 'LEARNING') {
            setView(AppView.LEARNING);
            setCurrentTopicIndex(0);
        } else if (loadedUser.activeSession.step === 'QUIZ') {
             const currentAnswers = new Array(loadedUser.activeSession.questions.length).fill(-1);
             setQuizAnswers(currentAnswers);
             setView(AppView.QUIZ);
             setCurrentQuestionIndex(0);
        }
    } else {
        setView(AppView.HOME);
    }
  };

  // Switching Tracks
  const switchTrack = (track: TrackType) => {
      if (!user) return;
      const updated = { ...user, currentTrack: track };
      saveUser(updated);
      setUser(updated);
  };

  // Navigation Logic
  const goHome = () => {
     setView(AppView.HOME);
     setIsReviewing(false);
  };

  const resumeSession = () => {
      if (topics.length > 0 && questions.length === 0) {
          setView(AppView.LEARNING);
          setCurrentTopicIndex(0);
      }
      if (questions.length > 0) {
          setView(AppView.QUIZ);
          setCurrentQuestionIndex(0);
      }
  };

  // Action: Start New Day (Progressive Loading with Batching)
  const startDay = async () => {
    if (!user) return;
    setLoading(true);
    setQuizResult(null);
    setQuestions([]);
    setTopics([]); 
    setIsReviewing(false);
    setCurrentTopicIndex(0);
    
    const currentDay = user.progress[user.currentTrack];

    try {
        // 1. Fetch Initial Batch (1 topic for immediate start)
        const batch1 = await generateTopicBatch(currentDay, 1, 1, [], user.currentTrack);
        setTopics(batch1);
        setLoading(false); 
        setView(AppView.LEARNING);

        // Generate Quiz for Batch 1 (Background)
        generateQuizForBatch(batch1).then(qs => {
             setQuestions(prev => [...prev, ...qs]);
        });

        // 2. Fetch Remaining Topics in Batches
        // We use an IIFE for the background process
        (async () => {
            let loadedTitles = batch1.map(t => t.title);
            let currentIdx = 2; // Start from the 2nd topic

            while (currentIdx <= dailyTopicCount) {
                // Calculate batch size (max 3 at a time to reduce request count)
                // e.g. if we need 9 more, we do 3, 3, 3.
                const batchSize = Math.min(3, dailyTopicCount - currentIdx + 1);
                
                // DELAY: Wait 10 seconds between batches to strictly respect API Quota
                // Batching 3 topics = 1 request. + 1 Quiz request = 2 requests per 10s.
                // This is ~12 RPM, which is safe for free tier.
                await new Promise(r => setTimeout(r, 10000));

                try {
                    // console.log(`Background loading: fetching batch of ${batchSize} starting at ${currentIdx}`);
                    const nextBatch = await generateTopicBatch(currentDay, currentIdx, batchSize, loadedTitles, user.currentTrack);
                    
                    if (nextBatch.length > 0) {
                        // Update context for next iteration to avoid duplicates
                        nextBatch.forEach(t => loadedTitles.push(t.title));
                        
                        setTopics(prev => [...prev, ...nextBatch]);
                        
                        // Wait slightly before generating quiz to spread burst
                        await new Promise(r => setTimeout(r, 2000));
                        
                        // Generate quizzes for this entire batch in one go (1 request)
                        const qs = await generateQuizForBatch(nextBatch);
                        setQuestions(prev => [...prev, ...qs]);
                    } else {
                        // If we got nothing, stop.
                        console.warn("Background batch generation returned empty.");
                        break;
                    }
                } catch (e) {
                    console.warn("Background fetch error:", e);
                    break;
                }
                
                currentIdx += batchSize;
            }
        })();

    } catch (e) {
        console.error("Error starting day", e);
        setLoading(false);
    }
  };

  // Action: Go to Quiz
  const enterQuizMode = () => {
      if (!user) return;
      setQuizAnswers(new Array(questions.length).fill(-1));
      
      const updatedUser = saveActiveSession(user, topics, questions, 'QUIZ');
      setUser(updatedUser);
      setView(AppView.QUIZ);
      setCurrentQuestionIndex(0);
      setIsReviewing(false);
  };

  // Action: Submit Quiz
  const submitQuiz = () => {
    let score = 0;
    const wrongIndices: number[] = [];
    questions.forEach((q, idx) => {
      if (quizAnswers[idx] === q.correctIndex) {
        score++;
      } else {
        wrongIndices.push(idx);
      }
    });
    setQuizResult({ 
      score, 
      total: questions.length, 
      answers: quizAnswers,
      wrongQuestionIndices: wrongIndices
    });
  };

  // Action: Generate Note & Finish Day
  const generateNotesAction = async () => {
    if (!quizResult || !user) return;
    setLoading(true);
    setView(AppView.NOTES_GENERATION);
    
    const noteContent = await generateStudyNotes(topics, quizResult.score);
    setCurrentNoteContent(noteContent);

    const mistakes = quizResult.wrongQuestionIndices.map(idx => questions[idx].question);

    const newNote: SavedNote = {
        id: Date.now().toString(),
        day: user.progress[user.currentTrack],
        date: new Date().toLocaleDateString(),
        topics: topics,
        content: noteContent,
        quizScore: quizResult.score,
        mistakes: mistakes,
        track: user.currentTrack
    };

    const updatedUser = completeDay(user, newNote);
    setUser(updatedUser);
    
    setLoading(false);
    setView(AppView.NOTES_GENERATION); 
  };

  // Action: Comprehensive Exam
  const startComprehensiveExam = async () => {
      if (!user || user.savedNotes.length === 0) return;
      setLoading(true);
      setQuizResult(null);
      setIsReviewing(false);
      
      // Filter notes by current track for comprehensive exam
      const trackNotes = user.savedNotes.filter(n => n.track === user.currentTrack);
      const allTopics = trackNotes.flatMap(n => n.topics);
      const topicSummaries = allTopics.map(t => `${t.title} (${t.category})`);
      const targetQuestionCount = isTestMode ? 5 : Math.min(allTopics.length * 2, 50);
      const allMistakes = trackNotes.flatMap(n => n.mistakes || []);

      const qs = await generateComprehensiveQuiz(topicSummaries, allMistakes, targetQuestionCount);
      
      setQuestions(qs);
      setQuizAnswers(new Array(qs.length).fill(-1));
      setCurrentQuestionIndex(0);
      setLoading(false);
      setView(AppView.COMPREHENSIVE_EXAM);
  };

  // --- RENDER FUNCTIONS ---

  const renderLogin = () => (
      <div className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden">
          <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-5"></div>
          
          <div className="bg-slate-800 p-8 rounded-2xl shadow-2xl w-full max-w-md border border-slate-700 relative z-10">
              <div className="text-center mb-8">
                <div className="w-16 h-16 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-xl mx-auto flex items-center justify-center text-3xl font-bold text-white mb-4 shadow-lg shadow-cyan-500/20">U</div>
                <h1 className="text-2xl font-bold text-white">Unity 面试大师</h1>
                <p className="text-slate-400 mt-2">登录以同步你的学习进度</p>
              </div>
              
              <div className="space-y-4">
                  <div>
                      <label className="block text-sm text-slate-400 mb-1">你的昵称</label>
                      <input 
                        type="text" 
                        value={usernameInput}
                        onChange={(e) => setUsernameInput(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-600 rounded-lg p-3 text-white focus:ring-2 focus:ring-cyan-500 outline-none"
                        placeholder="输入名字开始..."
                      />
                  </div>

                  <div className="flex items-center gap-2 p-3 bg-slate-900/50 rounded-lg border border-slate-700/50">
                      <input 
                        type="checkbox" 
                        id="testMode"
                        checked={isTestMode}
                        onChange={(e) => setIsTestMode(e.target.checked)}
                        className="w-4 h-4 rounded border-slate-600 text-cyan-500 focus:ring-cyan-500 bg-slate-800"
                      />
                      <label htmlFor="testMode" className="text-sm text-slate-300 cursor-pointer select-none">
                          启用快速体验模式 <span className="text-slate-500 text-xs">(每日仅 2 个知识点，用于测试功能)</span>
                      </label>
                  </div>

                  <button 
                    onClick={() => handleLogin(usernameInput)}
                    disabled={!usernameInput.trim()}
                    className="w-full bg-cyan-600 hover:bg-cyan-500 text-white font-bold py-3 rounded-lg transition-colors disabled:opacity-50 shadow-lg"
                  >
                      开始学习
                  </button>

                  {existingUsers.length > 0 && (
                      <div className="mt-6 pt-6 border-t border-slate-700">
                          <p className="text-xs text-slate-500 mb-3 uppercase tracking-wider">检测到历史记录</p>
                          <div className="flex flex-wrap gap-2">
                              {existingUsers.map(u => (
                                  <button 
                                    key={u}
                                    onClick={() => handleLogin(u)}
                                    className="bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm px-3 py-1 rounded-full transition-colors"
                                  >
                                      {u}
                                  </button>
                              ))}
                          </div>
                      </div>
                  )}
              </div>
          </div>
      </div>
  );

  const renderHome = () => {
    if (!user) return null;
    const hasSession = (user.activeSession !== null) && (user.activeSession.topics.length > 0);
    const currentTrack = user.currentTrack;
    const trackProgress = user.progress[currentTrack];
    
    const trackNotes = user.savedNotes.filter(n => n.track === currentTrack);
    const totalTopicsLearned = trackNotes.reduce((acc, n) => acc + n.topics.length, 0);
    const canTakeComprehensive = totalTopicsLearned >= (isTestMode ? 2 : 10);

    return (
      <div className="max-w-6xl mx-auto px-6 py-12">
         <div className="flex flex-col md:flex-row justify-between items-end mb-12 border-b border-slate-700 pb-8 gap-6">
             <div>
                 <h1 className="text-4xl font-bold text-white mb-2">欢迎回来, <span className="text-cyan-400">{user.username}</span></h1>
                 {isTestMode && <span className="bg-orange-900/30 text-orange-400 border border-orange-800/50 text-xs px-2 py-0.5 rounded ml-2 align-middle">测试模式</span>}
             </div>
             <div className="flex gap-4">
                 {hasSession && (
                     <button 
                        onClick={resumeSession}
                        className="px-6 py-3 bg-yellow-600 hover:bg-yellow-500 text-white rounded-xl font-bold shadow-lg animate-pulse"
                     >
                         继续未完成的学习
                     </button>
                 )}
             </div>
         </div>

         {/* Track Selector */}
         <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
            <div 
                onClick={() => switchTrack('UNITY')}
                className={`relative cursor-pointer p-6 rounded-2xl border transition-all duration-300 ${
                    currentTrack === 'UNITY' 
                    ? 'bg-gradient-to-br from-slate-800 to-slate-900 border-cyan-500 ring-1 ring-cyan-500/50 shadow-xl shadow-cyan-900/20' 
                    : 'bg-slate-900/50 border-slate-700 hover:bg-slate-800 opacity-60 hover:opacity-100'
                }`}
            >
                {currentTrack === 'UNITY' && <div className="absolute top-4 right-4 w-3 h-3 bg-cyan-500 rounded-full shadow-[0_0_10px_#06b6d4]"></div>}
                <h3 className="text-xl font-bold text-white mb-2">Unity 核心与架构</h3>
                <p className="text-slate-400 text-sm mb-4">渲染管线、生命周期、物理系统与引擎优化。</p>
                <div className="text-xs font-mono text-cyan-400">Current: Day {user.progress.UNITY}</div>
            </div>

            <div 
                onClick={() => switchTrack('CSHARP_ALGO')}
                className={`relative cursor-pointer p-6 rounded-2xl border transition-all duration-300 ${
                    currentTrack === 'CSHARP_ALGO' 
                    ? 'bg-gradient-to-br from-slate-800 to-slate-900 border-purple-500 ring-1 ring-purple-500/50 shadow-xl shadow-purple-900/20' 
                    : 'bg-slate-900/50 border-slate-700 hover:bg-slate-800 opacity-60 hover:opacity-100'
                }`}
            >
                 {currentTrack === 'CSHARP_ALGO' && <div className="absolute top-4 right-4 w-3 h-3 bg-purple-500 rounded-full shadow-[0_0_10px_#a855f7]"></div>}
                <h3 className="text-xl font-bold text-white mb-2">C# 高级编程 & 算法</h3>
                <p className="text-slate-400 text-sm mb-4">GC 原理、多线程、常用数据结构与算法面试题。</p>
                <div className="text-xs font-mono text-purple-400">Current: Day {user.progress.CSHARP_ALGO}</div>
            </div>
         </div>

         {/* Dashboard Content */}
         <div className="grid md:grid-cols-2 gap-8">
             {/* Main Action Card */}
             <div className={`bg-slate-800 p-8 rounded-2xl border border-slate-700 shadow-xl relative overflow-hidden group ${loading ? 'opacity-80' : ''}`}>
                 <div className={`absolute top-0 right-0 w-32 h-32 rounded-full blur-3xl -mr-10 -mt-10 ${currentTrack === 'UNITY' ? 'bg-cyan-500/10' : 'bg-purple-500/10'}`}></div>
                 <h3 className="text-2xl font-bold text-white mb-4">今日任务 ({currentTrack === 'UNITY' ? 'Unity' : 'C# / Algo'})</h3>
                 <p className="text-slate-400 mb-8">
                     {isTestMode ? '快速生成 2 个知识点进行体验。' : `学习 10 个新的核心概念，并完成 20 题的强化训练。`}
                 </p>
                 <button
                    onClick={startDay}
                    disabled={loading || hasSession}
                    className={`w-full py-4 text-white font-bold rounded-xl shadow-lg transition-all transform hover:-translate-y-1 disabled:opacity-50 disabled:cursor-not-allowed ${
                        currentTrack === 'UNITY' 
                        ? 'bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500' 
                        : 'bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500'
                    }`}
                 >
                    {loading ? "AI 正在极速生成..." : hasSession ? "请先完成当前课程" : `开始 Day ${trackProgress}`}
                 </button>
             </div>

             {/* Stats / Review Card */}
             <div className="bg-slate-800 p-8 rounded-2xl border border-slate-700 shadow-xl flex flex-col justify-between">
                 <div>
                    <h3 className="text-2xl font-bold text-white mb-4">复习 & 进阶</h3>
                    <div className="flex gap-4 mb-6">
                        <div className="bg-slate-900 p-4 rounded-lg flex-1 text-center border border-slate-700">
                            <div className="text-2xl font-bold text-white">{trackNotes.length}</div>
                            <div className="text-xs text-slate-500 uppercase">已学天数</div>
                        </div>
                        <div className="bg-slate-900 p-4 rounded-lg flex-1 text-center border border-slate-700">
                            <div className={`text-2xl font-bold ${currentTrack === 'UNITY' ? 'text-cyan-400' : 'text-purple-400'}`}>
                                {totalTopicsLearned}
                            </div>
                            <div className="text-xs text-slate-500 uppercase">掌握知识点</div>
                        </div>
                    </div>
                 </div>
                 
                 <div className="space-y-3">
                     <button 
                        onClick={() => setView(AppView.NOTES_LIST)}
                        className="w-full py-3 bg-slate-700 hover:bg-slate-600 text-slate-200 font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
                     >
                        <span>查看笔记库</span>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                     </button>
                     
                     {canTakeComprehensive && (
                         <button 
                            onClick={startComprehensiveExam}
                            className="w-full py-3 bg-indigo-900/50 hover:bg-indigo-800/50 border border-indigo-500/30 text-indigo-200 font-semibold rounded-xl transition-colors flex flex-col items-center justify-center"
                         >
                            <span>阶段性汇总考试</span>
                            <span className="text-xs text-indigo-400 mt-1">基于 {totalTopicsLearned} 个知识点生成试卷</span>
                         </button>
                     )}
                     {!canTakeComprehensive && (
                        <div className="text-center text-xs text-slate-500 pt-2">
                            学习满 {isTestMode ? '2' : '10'} 个知识点后解锁综合考试
                        </div>
                     )}
                 </div>
             </div>
         </div>
      </div>
    );
  };

  const renderLearning = () => {
    const topic = topics[currentTopicIndex];
    
    return (
        <div className="max-w-4xl mx-auto p-6 pb-32 flex flex-col min-h-[85vh]">
          {/* Progress Bar */}
          <div className="mb-8">
             <div className="flex justify-between text-sm text-slate-400 mb-2">
                <span>进度 ({user?.currentTrack === 'UNITY' ? 'Unity' : 'C#'})</span>
                <span>{currentTopicIndex + 1} / {dailyTopicCount}</span>
             </div>
             <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                <div 
                    className={`h-full transition-all duration-500 ease-out ${user?.currentTrack === 'UNITY' ? 'bg-cyan-500' : 'bg-purple-500'}`}
                    style={{ width: `${((currentTopicIndex + 1) / dailyTopicCount) * 100}%` }}
                ></div>
             </div>
          </div>

          {/* Header */}
          <div className="flex justify-between items-end mb-6">
            <div>
                <h2 className="text-3xl font-bold text-white">Day {user?.progress[user.currentTrack]} 核心知识</h2>
                <p className="text-slate-400 mt-1">每日精进，积少成多</p>
            </div>
            {topics.length < dailyTopicCount && (
                 <div className="flex items-center gap-2 text-xs text-cyan-400 animate-pulse bg-cyan-900/20 px-3 py-1 rounded-full border border-cyan-800">
                    <div className="w-2 h-2 bg-cyan-400 rounded-full"></div>
                    后台生成中 ({topics.length}/{dailyTopicCount})
                 </div>
            )}
          </div>
          
          {topic ? (
              <div className="flex-1 bg-slate-800 border border-slate-700 rounded-2xl overflow-hidden shadow-2xl flex flex-col animate-fade-in">
                <div className="p-8 border-b border-slate-700/50 bg-slate-800/50 flex justify-between items-start">
                    <div className="flex items-center gap-4">
                        <span className="flex items-center justify-center w-10 h-10 rounded-full bg-slate-700 text-white font-bold border border-slate-600 text-lg">
                            {currentTopicIndex + 1}
                        </span>
                        <h3 className="text-2xl font-bold text-slate-100">{topic.title}</h3>
                    </div>
                    <div className="flex gap-2">
                        <span className="text-sm px-3 py-1 rounded-full border font-mono border-slate-600 text-slate-400 bg-slate-700/50">{topic.category}</span>
                        <span className={`text-sm px-3 py-1 rounded-full border ${
                            topic.difficulty === '高级' ? 'border-red-500/50 text-red-400' : 
                            topic.difficulty === '中级' ? 'border-yellow-500/50 text-yellow-400' : 
                            'border-green-500/50 text-green-400'
                        }`}>{topic.difficulty}</span>
                    </div>
                </div>
                <div className="p-8 flex-1 overflow-y-auto">
                    <div className="text-slate-300 mb-8 leading-loose text-lg">
                        <MarkdownView content={topic.concept} />
                    </div>
                    {topic.exampleCode && (
                    <div className="relative group mt-6">
                        <div className="absolute top-3 right-3 text-xs text-slate-500 font-mono px-2 py-1 bg-slate-800 rounded">Code Example</div>
                        <div className="bg-[#111] rounded-xl p-6 border-l-4 border-cyan-600 font-mono text-sm overflow-x-auto text-slate-300 shadow-inner">
                            <pre className="whitespace-pre-wrap break-words font-mono leading-6">{topic.exampleCode}</pre>
                        </div>
                    </div>
                    )}
                </div>
              </div>
          ) : (
              <div className="flex-1 bg-slate-800 border border-slate-700 rounded-2xl flex flex-col justify-center items-center shadow-inner text-slate-500">
                  <Spinner />
                  <p className="mt-4 animate-pulse">正在生成第 {currentTopicIndex + 1} 个知识点...</p>
              </div>
          )}
          
          <div className="mt-8 flex justify-between gap-4">
             <button
                onClick={() => setCurrentTopicIndex(prev => Math.max(0, prev - 1))}
                disabled={currentTopicIndex === 0}
                className="px-8 py-4 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed text-white rounded-xl font-bold transition-colors flex items-center gap-2"
             >
                ← 上一个
             </button>
             
             {currentTopicIndex < dailyTopicCount - 1 ? (
                 <button
                    onClick={() => setCurrentTopicIndex(prev => prev + 1)}
                    className="px-10 py-4 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl font-bold shadow-lg transition-transform hover:translate-x-1 flex items-center gap-2 disabled:bg-slate-700 disabled:opacity-50"
                 >
                    下一个 →
                 </button>
             ) : (
                 <button
                    onClick={enterQuizMode}
                    disabled={questions.length === 0}
                    className="px-10 py-4 bg-green-600 hover:bg-green-500 text-white rounded-xl font-bold shadow-lg transition-transform hover:-translate-y-1 flex items-center gap-2 disabled:bg-slate-700 disabled:opacity-50 disabled:cursor-wait"
                 >
                    {questions.length === 0 ? "生成题目中..." : "开始测试 ✨"}
                 </button>
             )}
          </div>
        </div>
    );
  };

  const renderQuiz = (isComprehensive = false) => {
      if (quizResult && !isReviewing) {
          return (
            <div className="max-w-2xl mx-auto p-8 text-center pt-20 animate-fade-in">
                <div className="inline-block p-6 rounded-full bg-slate-800 border border-slate-700 mb-8">
                    <div className="text-6xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500">
                        {quizResult.score} <span className="text-2xl text-slate-500 font-normal">/ {quizResult.total}</span>
                    </div>
                </div>
                <h2 className="text-3xl font-bold text-white mb-4">
                    {quizResult.score === quizResult.total ? "完美通过！🎉" : quizResult.score > quizResult.total / 2 ? "测试完成！👍" : "还需要加强哦 💪"}
                </h2>
                <p className="text-slate-400 mb-10 text-lg">查看详细解析以巩固知识，或直接生成笔记。</p>
                
                <div className="flex flex-col gap-4">
                    <button
                        onClick={() => setIsReviewing(true)}
                        className="w-full px-10 py-4 bg-slate-700 hover:bg-slate-600 text-white rounded-xl font-bold text-lg transition-all border border-slate-600"
                    >
                        📝 查看错题与解析
                    </button>
                    
                    {isComprehensive ? (
                         <button
                            onClick={() => setView(AppView.HOME)}
                            className="w-full px-10 py-4 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl font-bold text-lg transition-all"
                        >
                            返回首页
                        </button>
                    ) : (
                         <button
                            onClick={generateNotesAction}
                            className="w-full px-10 py-4 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl font-bold text-lg transition-all shadow-lg hover:shadow-cyan-500/20"
                        >
                            生成并保存笔记
                        </button>
                    )}
                </div>
            </div>
          )
      }
      
      if (quizResult && isReviewing) {
          return (
            <div className="max-w-3xl mx-auto p-6 pb-32 animate-fade-in">
                 <div className="mb-8 sticky top-0 bg-slate-900/95 backdrop-blur p-4 z-20 border-b border-slate-700 flex justify-between items-center rounded-b-xl shadow-lg">
                    <h2 className="text-2xl font-bold text-white">试卷解析</h2>
                    <button onClick={() => setIsReviewing(false)} className="text-cyan-400 hover:text-cyan-300 text-sm font-bold">返回结果页</button>
                 </div>
                 
                 <div className="space-y-12">
                     {questions.map((q, qIdx) => {
                         const isCorrect = quizAnswers[qIdx] === q.correctIndex;
                         return (
                             <div key={qIdx} className={`border rounded-2xl p-8 shadow-lg ${isCorrect ? 'bg-slate-900 border-slate-800' : 'bg-slate-900 border-red-900/30'}`}>
                                 <div className="flex gap-3 mb-6">
                                     <span className={`flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full font-bold text-sm ${isCorrect ? 'bg-green-900 text-green-400' : 'bg-red-900 text-red-400'}`}>
                                         {isCorrect ? '✓' : '✗'}
                                     </span>
                                     <div className="flex-1">
                                         <div className="prose prose-invert max-w-none">
                                            <MarkdownView content={q.question} />
                                         </div>
                                     </div>
                                 </div>
                                 
                                 <div className="space-y-3 pl-11">
                                     {q.options.map((opt, oIdx) => {
                                         const isSelected = quizAnswers[qIdx] === oIdx;
                                         const isThisCorrect = q.correctIndex === oIdx;
                                         let optionClass = "bg-slate-800/50 border-slate-700 text-slate-400"; 
                                         if (isThisCorrect) optionClass = "bg-green-900/20 border-green-500/50 text-green-300"; 
                                         if (isSelected && !isThisCorrect) optionClass = "bg-red-900/20 border-red-500 text-red-300"; 
                                         if (isSelected && isThisCorrect) optionClass = "bg-green-900/40 border-green-500 text-green-200 font-bold"; 

                                         return (
                                             <div key={oIdx} className={`w-full text-left p-4 rounded-xl border flex items-start gap-3 ${optionClass}`}>
                                                 <span className="text-xs font-bold pt-0.5 opacity-70">{String.fromCharCode(65 + oIdx)}.</span>
                                                 <span>{opt}</span>
                                             </div>
                                         )
                                     })}
                                 </div>
                                 
                                 <div className="mt-6 ml-11 bg-slate-800 p-6 rounded-xl border-l-4 border-cyan-500">
                                     <h4 className="text-cyan-400 font-bold text-sm mb-2 uppercase tracking-wider">💡 解析</h4>
                                     <p className="text-slate-300 text-sm leading-relaxed">{q.explanation}</p>
                                 </div>
                             </div>
                         )
                     })}
                 </div>
                 
                 <div className="mt-12 flex justify-center">
                    <button 
                        onClick={isComprehensive ? () => setView(AppView.HOME) : generateNotesAction}
                        className="px-12 py-4 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl font-bold text-lg shadow-lg"
                    >
                        {isComprehensive ? "完成复习" : "生成学习笔记"}
                    </button>
                 </div>
            </div>
          );
      }

      const q = questions[currentQuestionIndex];
      if (!q) {
          return (
              <div className="max-w-3xl mx-auto p-12 text-center">
                  <Spinner />
                  <p className="mt-4 text-slate-400 animate-pulse">正在生成题目 ({questions.length} 已就绪)...</p>
              </div>
          )
      }

      const estimatedTotal = isComprehensive ? questions.length : dailyTopicCount * 2;
      const displayTotal = Math.max(questions.length, estimatedTotal);

      return (
        <div className="max-w-3xl mx-auto p-6 pb-32 flex flex-col min-h-[85vh]">
             <div className="mb-6">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-2xl font-bold text-white flex items-center gap-3">
                        <span className={`rounded-lg px-3 py-1 text-sm ${isComprehensive ? 'bg-purple-900 text-purple-300' : 'bg-cyan-900 text-cyan-300'}`}>
                            {isComprehensive ? '汇总考试' : '每日测试'}
                        </span>
                        {!isComprehensive && questions.length < displayTotal && (
                            <span className="text-xs text-slate-500 font-normal animate-pulse">题目生成中...</span>
                        )}
                    </h2>
                    <div className="text-slate-400 font-mono text-sm">
                        <span className="text-white font-bold">{currentQuestionIndex + 1}</span> / {displayTotal}
                    </div>
                </div>
                <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div 
                        className={`h-full transition-all duration-300 ease-out ${isComprehensive ? 'bg-purple-500' : 'bg-cyan-500'}`}
                        style={{ width: `${((currentQuestionIndex + 1) / displayTotal) * 100}%` }}
                    ></div>
                </div>
             </div>
             
             <div className="flex-1 bg-slate-800 border border-slate-700 rounded-2xl p-8 shadow-2xl flex flex-col animate-fade-in">
                 <div className="mb-8 prose prose-invert max-w-none prose-p:text-xl prose-p:font-semibold prose-p:text-white">
                    <div className="flex gap-4">
                        <span className="text-slate-500 font-semibold text-2xl">{currentQuestionIndex + 1}.</span>
                        <div className="flex-1"><MarkdownView content={q.question} /></div>
                    </div>
                 </div>

                 <div className="space-y-4 flex-1">
                     {q.options.map((opt, oIdx) => (
                         <button
                            key={oIdx}
                            onClick={() => {
                                const newAnswers = [...quizAnswers];
                                if (newAnswers.length <= currentQuestionIndex) {
                                    for(let i=newAnswers.length; i<=currentQuestionIndex; i++) newAnswers[i] = -1;
                                }
                                newAnswers[currentQuestionIndex] = oIdx;
                                setQuizAnswers(newAnswers);
                            }}
                            className={`w-full text-left p-5 rounded-xl border transition-all flex items-start gap-4 group ${
                                quizAnswers[currentQuestionIndex] === oIdx 
                                ? 'bg-cyan-900/40 border-cyan-500 text-cyan-100' 
                                : 'bg-slate-900/50 border-slate-700 text-slate-400 hover:bg-slate-700'
                            }`}
                         >
                             <span className={`flex-shrink-0 w-8 h-8 rounded flex items-center justify-center text-sm font-bold border transition-colors ${
                                 quizAnswers[currentQuestionIndex] === oIdx ? 'border-cyan-400 text-cyan-400 bg-cyan-900/50' : 'border-slate-600 text-slate-600 group-hover:border-slate-500'
                             }`}>{String.fromCharCode(65 + oIdx)}</span> 
                             <span className="pt-1 text-lg">{opt}</span>
                         </button>
                     ))}
                 </div>
             </div>
             
             <div className="mt-8 flex justify-between gap-4">
                 <button
                     onClick={() => setCurrentQuestionIndex(prev => Math.max(0, prev - 1))}
                     disabled={currentQuestionIndex === 0}
                     className="px-8 py-4 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed text-white rounded-xl font-bold transition-colors"
                 >
                     ← 上一题
                 </button>

                 {currentQuestionIndex < displayTotal - 1 ? (
                     <button
                         onClick={() => setCurrentQuestionIndex(prev => prev + 1)}
                         disabled={currentQuestionIndex >= questions.length - 1} 
                         className="px-10 py-4 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold shadow-lg transition-transform hover:translate-x-1 disabled:bg-slate-700 disabled:opacity-50 disabled:cursor-wait"
                     >
                         {currentQuestionIndex >= questions.length - 1 ? "题目生成中..." : "下一题 →"}
                     </button>
                 ) : (
                     <button
                        onClick={submitQuiz}
                        disabled={quizAnswers.includes(-1) || quizAnswers.length < displayTotal}
                        className="px-10 py-4 bg-green-600 hover:bg-green-500 disabled:bg-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed text-white rounded-xl font-bold shadow-lg transition-colors text-lg"
                     >
                        提交试卷 ✅
                     </button>
                 )}
             </div>
        </div>
      );
  };

  const renderNotesGeneration = () => (
      <div className="max-w-4xl mx-auto p-6 pb-32">
          <div className="flex justify-between items-center mb-6 border-b border-slate-700 pb-6">
            <div>
                <h2 className="text-3xl font-bold text-white">Day {user?.progress[user.currentTrack]} 学习笔记</h2>
                <p className="text-green-400 text-sm mt-1">已自动保存到您的笔记库</p>
            </div>
            <button onClick={() => setView(AppView.HOME)} className="px-6 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors">返回首页</button>
          </div>
          <div className="bg-[#0d1117] p-8 rounded-xl border border-slate-700 shadow-2xl">
              <MarkdownView content={currentNoteContent} />
          </div>
          <div className="mt-8 text-center">
             <button onClick={() => setView(AppView.HOME)} className="px-8 py-3 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl font-bold">完成今日学习</button>
          </div>
      </div>
  );

  if (view === AppView.LOGIN) return renderLogin();

  return (
    <div className="min-h-screen bg-slate-900 text-slate-200 font-sans selection:bg-cyan-500/30 selection:text-cyan-200">
      <header className="bg-slate-900/80 backdrop-blur-md sticky top-0 z-40 border-b border-slate-800">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
             <div className="flex items-center gap-2 cursor-pointer" onClick={goHome}>
                 <div className="w-8 h-8 bg-gradient-to-br from-cyan-500 to-blue-600 rounded flex items-center justify-center font-bold text-white">U</div>
                 <span className="font-bold text-xl text-white tracking-tight">Unity<span className="text-cyan-400">Master</span></span>
             </div>
             
             <nav className="flex gap-2 sm:gap-6 text-sm font-medium text-slate-400 items-center">
                {(view === AppView.LEARNING || view === AppView.QUIZ) && (
                    <button onClick={goHome} className="text-yellow-500 hover:text-yellow-400 px-3 py-1 border border-yellow-500/30 rounded bg-yellow-500/10 mr-4">返回首页 (保存进度)</button>
                )}
                <button onClick={() => setView(AppView.NOTES_LIST)} className={`hover:text-white transition-colors ${view === AppView.NOTES_LIST ? 'text-white' : ''}`}>我的笔记</button>
                <button onClick={() => { setUser(null); setView(AppView.LOGIN); }} className="hover:text-red-400 transition-colors ml-4 border-l border-slate-700 pl-6">退出</button>
             </nav>
          </div>
      </header>

      {/* Fixed main container logic: When in Notes List view, restrict height to viewport minus header to allow inner scroll. Otherwise min-height. */}
      <main className={`animate-fade-in ${view === AppView.NOTES_LIST ? 'h-[calc(100vh-4rem)] overflow-hidden' : 'min-h-[calc(100vh-4rem)]'}`}>
        {loading ? <Spinner /> : (
            <>
                {view === AppView.HOME && renderHome()}
                {view === AppView.LEARNING && renderLearning()}
                {view === AppView.QUIZ && renderQuiz(false)}
                {view === AppView.COMPREHENSIVE_EXAM && renderQuiz(true)}
                {view === AppView.NOTES_GENERATION && renderNotesGeneration()}
                {view === AppView.NOTES_LIST && user && <NotesView savedNotes={user.savedNotes} />}
            </>
        )}
      </main>

      <ChatWidget />
    </div>
  );
};

export default App;