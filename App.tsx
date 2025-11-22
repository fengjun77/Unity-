
import React, { useState, useEffect } from 'react';
import { AppView, Topic, QuizQuestion, QuizResult, UserData, SavedNote } from './types';
import { generateTopicBatch, generateQuizForBatch, generateStudyNotes, generateComprehensiveQuiz } from './services/geminiService';
import { loadUser, saveUser, completeDay, saveActiveSession, clearActiveSession, getAllUsers } from './services/storage';
import { Spinner } from './components/Spinner';
import { ChatWidget } from './components/ChatWidget';
import { MarkdownView } from './components/MarkdownView';

const App: React.FC = () => {
  // User State
  const [user, setUser] = useState<UserData | null>(null);
  const [usernameInput, setUsernameInput] = useState('');
  const [existingUsers, setExistingUsers] = useState<string[]>([]);

  // App Flow State
  const [view, setView] = useState<AppView>(AppView.LOGIN);
  const [loading, setLoading] = useState(false);
  const [isReviewing, setIsReviewing] = useState(false);
  
  // Learning State
  const [topics, setTopics] = useState<Topic[]>([]);
  const [currentTopicIndex, setCurrentTopicIndex] = useState(0);
  const DAILY_TOPIC_COUNT = 10; // Target count
  
  // Quiz State
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [quizAnswers, setQuizAnswers] = useState<number[]>([]);
  const [quizResult, setQuizResult] = useState<QuizResult | null>(null);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  
  // Notes State
  const [currentNoteContent, setCurrentNoteContent] = useState<string>("");
  
  // Load existing users on mount
  useEffect(() => {
    setExistingUsers(getAllUsers());
  }, []);

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
             // Re-initialize answers array if resuming
             const currentAnswers = new Array(loadedUser.activeSession.questions.length).fill(-1);
             setQuizAnswers(currentAnswers);
             setView(AppView.QUIZ);
             setCurrentQuestionIndex(0);
        }
    } else {
        setView(AppView.HOME);
    }
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

  // Action: Start New Day (Progressive Loading)
  const startDay = async () => {
    if (!user) return;
    setLoading(true);
    setQuizResult(null);
    setQuestions([]);
    setTopics([]); // Clear previous
    setIsReviewing(false);
    setCurrentTopicIndex(0);
    
    try {
        // 1. Fetch First Batch (Topics 1-2) - FAST
        const batch1 = await generateTopicBatch(user.currentDay, 1, 2);
        setTopics(batch1);
        setLoading(false); // Enable UI immediately
        setView(AppView.LEARNING);

        // Save session after first batch
        let currentTopics = batch1;
        saveActiveSession(user, currentTopics, [], 'LEARNING');
        
        // 1a. Generate Quiz for Batch 1 (Background)
        generateQuizForBatch(batch1).then(qs => {
             setQuestions(prev => [...prev, ...qs]);
             // Don't overwrite answers if user somehow started? Usually answers are init on enterQuiz
        });

        // 2. Fetch Remaining Batch (Topics 3-10) - BACKGROUND
        const batch2 = await generateTopicBatch(user.currentDay, 3, 8);
        
        // Update State
        setTopics(prev => {
            const newTopics = [...prev, ...batch2];
            currentTopics = newTopics;
            return newTopics;
        });

        // Save session update
        saveActiveSession(user, currentTopics, [], 'LEARNING');

        // 2a. Generate Quiz for Batch 2 (Background)
        generateQuizForBatch(batch2).then(qs => {
             setQuestions(prev => {
                 const newQs = [...prev, ...qs];
                 saveActiveSession(user, currentTopics, newQs, 'LEARNING');
                 return newQs;
             });
        });

    } catch (e) {
        console.error("Error starting day", e);
        setLoading(false);
    }
  };

  // Action: Go to Quiz
  const enterQuizMode = () => {
      if (!user) return;
      // Initialize answers array based on currently loaded questions
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
    // Stay on QUIZ view but show results overlay
  };

  // Action: Generate Note & Finish Day
  const generateNotesAction = async () => {
    if (!quizResult || !user) return;
    setLoading(true);
    setView(AppView.NOTES_GENERATION);
    
    const noteContent = await generateStudyNotes(topics, quizResult.score);
    setCurrentNoteContent(noteContent);

    // Collect mistakes from current quiz result
    const mistakes = quizResult.wrongQuestionIndices.map(idx => questions[idx].question);

    const newNote: SavedNote = {
        id: Date.now().toString(),
        day: user.currentDay,
        date: new Date().toLocaleDateString(),
        topics: topics,
        content: noteContent,
        quizScore: quizResult.score,
        mistakes: mistakes
    };

    // Save to persistence
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
      
      const allTopics = user.savedNotes.flatMap(n => n.topics);
      const topicSummaries = allTopics.map(t => `${t.title} (${t.category})`);
      const targetQuestionCount = allTopics.length * 2;
      const allMistakes = user.savedNotes.flatMap(n => n.mistakes || []);

      const qs = await generateComprehensiveQuiz(topicSummaries, allMistakes, targetQuestionCount);
      
      setQuestions(qs);
      setQuizAnswers(new Array(qs.length).fill(-1));
      setCurrentQuestionIndex(0);
      setLoading(false);
      setView(AppView.COMPREHENSIVE_EXAM);
  };

  // --- RENDER FUNCTIONS ---

  const renderLogin = () => (
      <div className="min-h-screen flex items-center justify-center px-4">
          <div className="bg-slate-800 p-8 rounded-2xl shadow-2xl w-full max-w-md border border-slate-700">
              <div className="text-center mb-8">
                <div className="w-16 h-16 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-xl mx-auto flex items-center justify-center text-3xl font-bold text-white mb-4">U</div>
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
                  <button 
                    onClick={() => handleLogin(usernameInput)}
                    disabled={!usernameInput.trim()}
                    className="w-full bg-cyan-600 hover:bg-cyan-500 text-white font-bold py-3 rounded-lg transition-colors disabled:opacity-50"
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
    
    const totalTopicsLearned = user.savedNotes.reduce((acc, n) => acc + n.topics.length, 0);
    const canTakeComprehensive = totalTopicsLearned >= 10; 

    return (
      <div className="max-w-5xl mx-auto px-6 py-12">
         <div className="flex flex-col md:flex-row justify-between items-end mb-12 border-b border-slate-700 pb-8 gap-6">
             <div>
                 <h1 className="text-4xl font-bold text-white mb-2">欢迎回来, <span className="text-cyan-400">{user.username}</span></h1>
                 <p className="text-slate-400">当前进度: <span className="text-white font-mono">Day {user.currentDay}</span></p>
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

         <div className="grid md:grid-cols-2 gap-8">
             {/* Main Action Card */}
             <div className="bg-gradient-to-br from-slate-800 to-slate-900 p-8 rounded-2xl border border-slate-700 shadow-xl relative overflow-hidden group">
                 <div className="absolute top-0 right-0 w-32 h-32 bg-cyan-500/10 rounded-full blur-3xl -mr-10 -mt-10"></div>
                 <h3 className="text-2xl font-bold text-white mb-4">今日任务</h3>
                 <p className="text-slate-400 mb-8">学习 10 个新的 Unity/C# 核心概念，并完成 20 题的强化训练。</p>
                 <button
                    onClick={startDay}
                    disabled={loading || hasSession}
                    className="w-full py-4 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold rounded-xl shadow-lg transition-all transform hover:-translate-y-1 disabled:opacity-50 disabled:cursor-not-allowed"
                 >
                    {loading ? "AI 正在极速生成..." : hasSession ? "请先完成当前课程" : `开始 Day ${user.currentDay}`}
                 </button>
             </div>

             {/* Stats / Review Card */}
             <div className="bg-slate-800 p-8 rounded-2xl border border-slate-700 shadow-xl flex flex-col justify-between">
                 <div>
                    <h3 className="text-2xl font-bold text-white mb-4">复习 & 进阶</h3>
                    <div className="flex gap-4 mb-6">
                        <div className="bg-slate-900 p-4 rounded-lg flex-1 text-center border border-slate-700">
                            <div className="text-2xl font-bold text-cyan-400">{user.savedNotes.length}</div>
                            <div className="text-xs text-slate-500 uppercase">已学天数</div>
                        </div>
                        <div className="bg-slate-900 p-4 rounded-lg flex-1 text-center border border-slate-700">
                            <div className="text-2xl font-bold text-green-400">
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
                            className="w-full py-3 bg-purple-900/50 hover:bg-purple-800/50 border border-purple-500/30 text-purple-200 font-semibold rounded-xl transition-colors flex flex-col items-center justify-center"
                         >
                            <span>阶段性汇总考试</span>
                            <span className="text-xs text-purple-400 mt-1">基于 {totalTopicsLearned} 个知识点生成 {Math.min(totalTopicsLearned * 2, 50)} 道题 (优先错题)</span>
                         </button>
                     )}
                     {!canTakeComprehensive && (
                        <div className="text-center text-xs text-slate-500 pt-2">
                            学习满 10 个知识点后解锁综合考试
                        </div>
                     )}
                 </div>
             </div>
         </div>
      </div>
    );
  };

  const renderLearning = () => {
    // If topics are still loading the first batch, we might show spinner (handled by App loading state).
    // But if we are in progressive loading, topics[currentTopicIndex] might be undefined.
    const topic = topics[currentTopicIndex];
    
    return (
        <div className="max-w-4xl mx-auto p-6 pb-32 flex flex-col min-h-[85vh]">
          {/* Progress Bar */}
          <div className="mb-8">
             <div className="flex justify-between text-sm text-slate-400 mb-2">
                <span>进度</span>
                <span>{currentTopicIndex + 1} / {DAILY_TOPIC_COUNT}</span>
             </div>
             <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                <div 
                    className="h-full bg-cyan-500 transition-all duration-500 ease-out"
                    style={{ width: `${((currentTopicIndex + 1) / DAILY_TOPIC_COUNT) * 100}%` }}
                ></div>
             </div>
          </div>

          {/* Header */}
          <div className="flex justify-between items-end mb-6">
            <div>
                <h2 className="text-3xl font-bold text-white">Day {user?.currentDay} 核心知识</h2>
                <p className="text-slate-400 mt-1">每日精进，积少成多</p>
            </div>
            {/* Indication if background loading is happening */}
            {topics.length < DAILY_TOPIC_COUNT && (
                 <div className="flex items-center gap-2 text-xs text-cyan-400 animate-pulse bg-cyan-900/20 px-3 py-1 rounded-full border border-cyan-800">
                    <div className="w-2 h-2 bg-cyan-400 rounded-full"></div>
                    后台生成中 ({topics.length}/{DAILY_TOPIC_COUNT})
                 </div>
            )}
          </div>
          
          {/* Single Topic Card - Check availability */}
          {topic ? (
              <div className="flex-1 bg-slate-800 border border-slate-700 rounded-2xl overflow-hidden shadow-2xl flex flex-col animate-fade-in">
                <div className="p-8 border-b border-slate-700/50 bg-slate-800/50 flex justify-between items-start">
                    <div className="flex items-center gap-4">
                        <span className="flex items-center justify-center w-10 h-10 rounded-full bg-slate-700 text-cyan-400 font-bold border border-slate-600 text-lg">
                            {currentTopicIndex + 1}
                        </span>
                        <h3 className="text-2xl font-bold text-slate-100">{topic.title}</h3>
                    </div>
                    <div className="flex gap-2">
                        <span className={`text-sm px-3 py-1 rounded-full border font-mono ${
                            topic.category === 'Unity' ? 'border-blue-500/30 text-blue-400 bg-blue-900/20' :
                            topic.category === 'C#' ? 'border-purple-500/30 text-purple-400 bg-purple-900/20' :
                            'border-orange-500/30 text-orange-400 bg-orange-900/20'
                        }`}>{topic.category}</span>
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
                        <div className="absolute top-3 right-3 text-xs text-slate-500 font-mono px-2 py-1 bg-slate-800 rounded">C# Example</div>
                        <div className="bg-[#111] rounded-xl p-6 border-l-4 border-cyan-600 font-mono text-sm overflow-x-auto text-slate-300 shadow-inner">
                            <pre className="whitespace-pre-wrap break-words font-mono leading-6">{topic.exampleCode}</pre>
                        </div>
                    </div>
                    )}
                </div>
              </div>
          ) : (
              // Loading Placeholder for this specific card
              <div className="flex-1 bg-slate-800 border border-slate-700 rounded-2xl flex flex-col justify-center items-center shadow-inner text-slate-500">
                  <Spinner />
                  <p className="mt-4 animate-pulse">正在生成第 {currentTopicIndex + 1} 个知识点...</p>
              </div>
          )}
          
          {/* Navigation Buttons */}
          <div className="mt-8 flex justify-between gap-4">
             <button
                onClick={() => setCurrentTopicIndex(prev => Math.max(0, prev - 1))}
                disabled={currentTopicIndex === 0}
                className="px-8 py-4 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed text-white rounded-xl font-bold transition-colors flex items-center gap-2"
             >
                ← 上一个
             </button>
             
             {currentTopicIndex < DAILY_TOPIC_COUNT - 1 ? (
                 <button
                    onClick={() => setCurrentTopicIndex(prev => prev + 1)}
                    disabled={!topic && (currentTopicIndex >= topics.length)} // Can't go next if current isn't even loaded? Actually user can jump to next loading screen
                    className="px-10 py-4 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl font-bold shadow-lg transition-transform hover:translate-x-1 flex items-center gap-2 disabled:bg-slate-700 disabled:opacity-50"
                 >
                    下一个 →
                 </button>
             ) : (
                 <button
                    onClick={enterQuizMode}
                    className="px-10 py-4 bg-green-600 hover:bg-green-500 text-white rounded-xl font-bold shadow-lg transition-transform hover:-translate-y-1 flex items-center gap-2"
                 >
                    开始测试 ✨
                 </button>
             )}
          </div>
        </div>
    );
  };

  const renderQuiz = (isComprehensive = false) => {
      // STATE 1: Result Summary
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
      
      // STATE 2: Review Mode
      if (quizResult && isReviewing) {
          return (
            <div className="max-w-3xl mx-auto p-6 pb-32 animate-fade-in">
                 <div className="mb-8 sticky top-0 bg-slate-900/95 backdrop-blur p-4 z-20 border-b border-slate-700 flex justify-between items-center rounded-b-xl shadow-lg">
                    <h2 className="text-2xl font-bold text-white">试卷解析</h2>
                    <button 
                         onClick={() => setIsReviewing(false)} 
                         className="text-cyan-400 hover:text-cyan-300 text-sm font-bold"
                    >
                        返回结果页
                    </button>
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
                                         <div className="prose prose-invert max-w-none prose-p:text-xl prose-p:font-semibold prose-pre:bg-slate-950 prose-pre:border prose-pre:border-slate-800">
                                            <MarkdownView content={q.question} />
                                         </div>
                                     </div>
                                 </div>
                                 
                                 <div className="space-y-3 pl-11">
                                     {q.options.map((opt, oIdx) => {
                                         const isSelected = quizAnswers[qIdx] === oIdx;
                                         const isThisCorrect = q.correctIndex === oIdx;
                                         
                                         let optionClass = "bg-slate-800/50 border-slate-700 text-slate-400"; 
                                         
                                         if (isThisCorrect) {
                                             optionClass = "bg-green-900/20 border-green-500/50 text-green-300"; 
                                         } 
                                         
                                         if (isSelected && !isThisCorrect) {
                                             optionClass = "bg-red-900/20 border-red-500 text-red-300"; 
                                         }
                                         
                                         if (isSelected && isThisCorrect) {
                                              optionClass = "bg-green-900/40 border-green-500 text-green-200 font-bold"; 
                                         }

                                         return (
                                             <div
                                                key={oIdx}
                                                className={`w-full text-left p-4 rounded-xl border flex items-start gap-3 ${optionClass}`}
                                             >
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

      // STATE 3: Taking Quiz (Paginated View with Progressive Loading)
      const q = questions[currentQuestionIndex];
      // Note: Quiz questions might still be generating in background if user skipped Learning fast.
      // But typically for Daily quiz, we wait for questions.
      // If q is undefined, it means we are waiting for background generation.

      if (!q) {
          return (
              <div className="max-w-3xl mx-auto p-12 text-center">
                  <Spinner />
                  <p className="mt-4 text-slate-400 animate-pulse">正在生成题目 ({questions.length} 已就绪)...</p>
              </div>
          )
      }

      // Calculate total questions dynamically if we are still generating, or use loaded if done.
      // For Daily: Target is Topics * 2. 
      const estimatedTotal = isComprehensive ? questions.length : DAILY_TOPIC_COUNT * 2;
      // If we have more questions than estimated (edge case), use actual length
      const displayTotal = Math.max(questions.length, estimatedTotal);

      return (
        <div className="max-w-3xl mx-auto p-6 pb-32 flex flex-col min-h-[85vh]">
             {/* Header & Progress */}
             <div className="mb-6">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-2xl font-bold text-white flex items-center gap-3">
                        <span className={`rounded-lg px-3 py-1 text-sm ${isComprehensive ? 'bg-purple-900 text-purple-300' : 'bg-cyan-900 text-cyan-300'}`}>
                            {isComprehensive ? '汇总考试' : '每日测试'}
                        </span>
                        {/* Show indicator if questions are still pouring in */}
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
             
             {/* Single Question Card */}
             <div className="flex-1 bg-slate-800 border border-slate-700 rounded-2xl p-8 shadow-2xl flex flex-col animate-fade-in">
                 <div className="mb-8 prose prose-invert max-w-none prose-p:text-xl prose-p:font-semibold prose-p:text-white prose-pre:bg-[#1e1e1e] prose-pre:border prose-pre:border-slate-700">
                    <div className="flex gap-4">
                        <span className="text-slate-500 font-semibold text-2xl">{currentQuestionIndex + 1}.</span>
                        <div className="flex-1">
                            <MarkdownView content={q.question} />
                        </div>
                    </div>
                 </div>

                 <div className="space-y-4 flex-1">
                     {q.options.map((opt, oIdx) => (
                         <button
                            key={oIdx}
                            onClick={() => {
                                const newAnswers = [...quizAnswers];
                                // Ensure array is big enough if questions grew dynamically
                                if (newAnswers.length <= currentQuestionIndex) {
                                    // Fill gaps if any
                                    for(let i=newAnswers.length; i<=currentQuestionIndex; i++) newAnswers[i] = -1;
                                }
                                newAnswers[currentQuestionIndex] = oIdx;
                                setQuizAnswers(newAnswers);
                            }}
                            className={`w-full text-left p-5 rounded-xl border transition-all flex items-start gap-4 group ${
                                quizAnswers[currentQuestionIndex] === oIdx 
                                ? 'bg-cyan-900/40 border-cyan-500 text-cyan-100 shadow-[0_0_15px_rgba(6,182,212,0.15)] transform scale-[1.01]' 
                                : 'bg-slate-900/50 border-slate-700 text-slate-400 hover:bg-slate-700 hover:border-slate-600'
                            }`}
                         >
                             <span className={`flex-shrink-0 w-8 h-8 rounded flex items-center justify-center text-sm font-bold border transition-colors ${
                                 quizAnswers[currentQuestionIndex] === oIdx ? 'border-cyan-400 text-cyan-400 bg-cyan-900/50' : 'border-slate-600 text-slate-600 group-hover:border-slate-500'
                             }`}>
                                 {String.fromCharCode(65 + oIdx)}
                             </span> 
                             <span className="pt-1 text-lg">{opt}</span>
                         </button>
                     ))}
                 </div>
             </div>
             
             {/* Navigation */}
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
                         disabled={currentQuestionIndex >= questions.length - 1} // Can't go forward if question isn't generated yet
                         className="px-10 py-4 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold shadow-lg transition-transform hover:translate-x-1 disabled:bg-slate-700 disabled:opacity-50 disabled:cursor-wait"
                     >
                         {currentQuestionIndex >= questions.length - 1 ? "题目生成中..." : "下一题 →"}
                     </button>
                 ) : (
                     <button
                        onClick={submitQuiz}
                        disabled={quizAnswers.includes(-1) || quizAnswers.length < displayTotal} // Require all answers
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
                <h2 className="text-3xl font-bold text-white">Day {user?.currentDay} 学习笔记</h2>
                <p className="text-green-400 text-sm mt-1">已自动保存到您的笔记库</p>
            </div>
            <button 
                onClick={() => {
                    // User finished reading the new note, go back home
                    setView(AppView.HOME);
                }} 
                className="px-6 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
            >
                返回首页
            </button>
          </div>
          <div className="bg-[#0d1117] p-8 rounded-xl border border-slate-700 shadow-2xl">
              <MarkdownView content={currentNoteContent} />
          </div>
          <div className="mt-8 text-center">
             <button 
                onClick={() => setView(AppView.HOME)}
                className="px-8 py-3 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl font-bold"
             >
                 完成今日学习
             </button>
          </div>
      </div>
  );

  const renderNotesList = () => (
      <div className="max-w-4xl mx-auto p-6 pb-32">
          <div className="flex items-center gap-4 mb-8">
              <button onClick={goHome} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white">
                 <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
              </button>
              <h2 className="text-3xl font-bold text-white">我的笔记库</h2>
          </div>
          
          {user?.savedNotes.length === 0 ? (
              <div className="text-center py-20 text-slate-500">
                  暂无笔记，快去开始学习吧！
              </div>
          ) : (
              <div className="space-y-6">
                  {user?.savedNotes.slice().reverse().map((note) => (
                      <div key={note.id} className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
                          <div 
                            className="p-4 bg-slate-900/50 border-b border-slate-700 flex justify-between items-center cursor-pointer hover:bg-slate-700/50 transition-colors"
                            onClick={() => setCurrentNoteContent(currentNoteContent === note.content ? "" : note.content)}
                          >
                              <div className="flex items-center gap-4">
                                  <span className="bg-cyan-900 text-cyan-300 px-3 py-1 rounded font-mono text-sm">Day {note.day}</span>
                                  <span className="text-slate-400 text-sm">{note.date}</span>
                                  <span className="text-slate-500 text-sm hidden sm:inline">| 测试得分: {note.quizScore}/20</span>
                                  {note.mistakes && note.mistakes.length > 0 && (
                                      <span className="text-red-400 text-xs border border-red-900/50 px-2 py-0.5 rounded bg-red-900/10">
                                          错题: {note.mistakes.length}
                                      </span>
                                  )}
                              </div>
                              <svg className={`w-5 h-5 text-slate-400 transition-transform ${currentNoteContent === note.content ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                          </div>
                          
                          {currentNoteContent === note.content && (
                              <div className="p-8 bg-[#0d1117] animate-fade-in border-t border-slate-700">
                                  <MarkdownView content={note.content} />
                              </div>
                          )}
                      </div>
                  ))}
              </div>
          )}
      </div>
  );

  if (view === AppView.LOGIN) return renderLogin();

  return (
    <div className="min-h-screen bg-slate-900 text-slate-200 font-sans selection:bg-cyan-500/30 selection:text-cyan-200">
      {/* Header */}
      <header className="bg-slate-900/80 backdrop-blur-md sticky top-0 z-40 border-b border-slate-800">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
             <div 
                className="flex items-center gap-2 cursor-pointer"
                onClick={goHome}
             >
                 <div className="w-8 h-8 bg-gradient-to-br from-cyan-500 to-blue-600 rounded flex items-center justify-center font-bold text-white">U</div>
                 <span className="font-bold text-xl text-white tracking-tight">Unity<span className="text-cyan-400">Master</span></span>
             </div>
             
             <nav className="flex gap-2 sm:gap-6 text-sm font-medium text-slate-400 items-center">
                {(view === AppView.LEARNING || view === AppView.QUIZ) && (
                    <button 
                        onClick={goHome}
                        className="text-yellow-500 hover:text-yellow-400 px-3 py-1 border border-yellow-500/30 rounded bg-yellow-500/10 mr-4"
                    >
                        返回首页 (保存进度)
                    </button>
                )}
                
                <button 
                    onClick={() => setView(AppView.NOTES_LIST)}
                    className={`hover:text-white transition-colors ${view === AppView.NOTES_LIST ? 'text-white' : ''}`}
                >
                    我的笔记
                </button>
                
                <button 
                    onClick={() => {
                        setUser(null);
                        setView(AppView.LOGIN);
                    }}
                    className="hover:text-red-400 transition-colors ml-4 border-l border-slate-700 pl-6"
                >
                    退出
                </button>
             </nav>
          </div>
      </header>

      {/* Main Content */}
      <main className="animate-fade-in min-h-[calc(100vh-4rem)]">
        {loading ? <Spinner /> : (
            <>
                {view === AppView.HOME && renderHome()}
                {view === AppView.LEARNING && renderLearning()}
                {view === AppView.QUIZ && renderQuiz(false)}
                {view === AppView.COMPREHENSIVE_EXAM && renderQuiz(true)}
                {view === AppView.NOTES_GENERATION && renderNotesGeneration()}
                {view === AppView.NOTES_LIST && renderNotesList()}
            </>
        )}
      </main>

      <ChatWidget />
    </div>
  );
};

export default App;
