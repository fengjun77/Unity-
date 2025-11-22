
import React, { useState, useEffect } from 'react';
import { AppView, Topic, QuizQuestion, QuizResult, UserData, SavedNote } from './types';
import { generateDailyTopics, generateQuiz, generateStudyNotes, generateComprehensiveQuiz } from './services/geminiService';
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
  
  // Learning State
  const [topics, setTopics] = useState<Topic[]>([]);
  
  // Quiz State
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [quizAnswers, setQuizAnswers] = useState<number[]>([]);
  const [quizResult, setQuizResult] = useState<QuizResult | null>(null);
  
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
        } else if (loadedUser.activeSession.step === 'QUIZ') {
             // We don't save answers in progress for simplicity, just the questions
             setQuizAnswers(new Array(loadedUser.activeSession.questions.length).fill(-1));
             setView(AppView.QUIZ);
        }
    } else {
        setView(AppView.HOME);
    }
  };

  // Navigation Logic
  const goHome = () => {
     // If in a session, warn or just let them go, state is preserved in 'user' or component state
     // Ideally we just switch view, but if they want to "Back to Lesson" we need to track that.
     setView(AppView.HOME);
  };

  const resumeSession = () => {
      if (topics.length > 0 && questions.length === 0) setView(AppView.LEARNING);
      if (questions.length > 0) setView(AppView.QUIZ);
  };

  // Action: Start New Day
  const startDay = async () => {
    if (!user) return;
    setLoading(true);
    setQuizResult(null);
    setQuestions([]);
    setTopics([]);
    
    const data = await generateDailyTopics(user.currentDay);
    setTopics(data);
    
    // Auto generate quiz immediately to have it ready and saved in session
    const qs = await generateQuiz(data);
    setQuestions(qs);
    setQuizAnswers(new Array(qs.length).fill(-1));
    
    // Save Session
    const updatedUser = saveActiveSession(user, data, qs, 'LEARNING');
    setUser(updatedUser);

    setLoading(false);
    setView(AppView.LEARNING);
  };

  // Action: Go to Quiz
  const enterQuizMode = () => {
      if (!user) return;
      const updatedUser = saveActiveSession(user, topics, questions, 'QUIZ');
      setUser(updatedUser);
      setView(AppView.QUIZ);
  };

  // Action: Submit Quiz
  const submitQuiz = () => {
    let score = 0;
    questions.forEach((q, idx) => {
      if (quizAnswers[idx] === q.correctIndex) score++;
    });
    setQuizResult({ score, total: questions.length, answers: quizAnswers });
    // Stay on QUIZ view but show results overlay
  };

  // Action: Generate Note & Finish Day
  const generateNotesAction = async () => {
    if (!quizResult || !user) return;
    setLoading(true);
    setView(AppView.NOTES_GENERATION);
    
    const noteContent = await generateStudyNotes(topics, quizResult.score);
    setCurrentNoteContent(noteContent);

    const newNote: SavedNote = {
        id: Date.now().toString(),
        day: user.currentDay,
        date: new Date().toLocaleDateString(),
        topics: topics,
        content: noteContent,
        quizScore: quizResult.score
    };

    // Save to persistence
    const updatedUser = completeDay(user, newNote);
    setUser(updatedUser);
    
    setLoading(false);
    setView(AppView.NOTES_GENERATION); // Actually we show the just generated note
  };

  // Action: Comprehensive Exam
  const startComprehensiveExam = async () => {
      if (!user || user.savedNotes.length === 0) return;
      setLoading(true);
      setQuizResult(null);
      
      const allContent = user.savedNotes.map(n => n.content).join("\n\n");
      const qs = await generateComprehensiveQuiz(allContent);
      
      setQuestions(qs);
      setQuizAnswers(new Array(qs.length).fill(-1));
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
    const hasSession = topics.length > 0 && (user.activeSession !== null);

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
                 <p className="text-slate-400 mb-8">学习 10 个新的 Unity/C# 核心概念，并完成测试生成笔记。</p>
                 <button
                    onClick={startDay}
                    disabled={loading || hasSession}
                    className="w-full py-4 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold rounded-xl shadow-lg transition-all transform hover:-translate-y-1 disabled:opacity-50 disabled:cursor-not-allowed"
                 >
                    {loading ? "生成中..." : hasSession ? "请先完成当前课程" : `开始 Day ${user.currentDay}`}
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
                                {user.savedNotes.reduce((acc, n) => acc + n.topics.length, 0)}
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
                     
                     {user.savedNotes.length >= 3 && (
                         <button 
                            onClick={startComprehensiveExam}
                            className="w-full py-3 bg-purple-900/50 hover:bg-purple-800/50 border border-purple-500/30 text-purple-200 font-semibold rounded-xl transition-colors"
                         >
                            参加阶段性汇总考试
                         </button>
                     )}
                 </div>
             </div>
         </div>
      </div>
    );
  };

  const renderLearning = () => (
    <div className="max-w-5xl mx-auto p-6 pb-32">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div>
            <h2 className="text-3xl font-bold text-white flex items-center gap-3">
                <span className="bg-cyan-600 text-xs px-2 py-1 rounded text-white">Day {user?.currentDay}</span>
                今日核心知识
            </h2>
            <p className="text-slate-400 mt-1">包含 Unity 引擎、C# 语言与网络基础</p>
        </div>
        <button 
            onClick={enterQuizMode}
            className="px-8 py-3 bg-green-600 hover:bg-green-500 text-white rounded-xl font-bold shadow-lg transition-all flex items-center gap-2 hover:scale-105"
        >
            学习完毕，开始测试 <span className="text-xl">→</span>
        </button>
      </div>
      
      <div className="grid gap-8">
        {topics.map((topic, index) => (
          <div key={index} className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden shadow-md hover:border-cyan-500/30 transition-all">
            <div className="p-6 border-b border-slate-700/50 bg-slate-800/50 flex justify-between items-start">
                <div className="flex items-center gap-3">
                    <span className="flex items-center justify-center w-8 h-8 rounded-full bg-slate-700 text-cyan-400 font-bold border border-slate-600">{index + 1}</span>
                    <h3 className="text-xl font-bold text-slate-100">{topic.title}</h3>
                </div>
                <div className="flex gap-2">
                    <span className={`text-xs px-2 py-1 rounded border font-mono ${
                        topic.category === 'Unity' ? 'border-blue-500/30 text-blue-400 bg-blue-900/20' :
                        topic.category === 'C#' ? 'border-purple-500/30 text-purple-400 bg-purple-900/20' :
                        'border-orange-500/30 text-orange-400 bg-orange-900/20'
                    }`}>{topic.category}</span>
                    <span className={`text-xs px-2 py-1 rounded border ${
                        topic.difficulty === '高级' ? 'border-red-500/50 text-red-400' : 
                        topic.difficulty === '中级' ? 'border-yellow-500/50 text-yellow-400' : 
                        'border-green-500/50 text-green-400'
                    }`}>{topic.difficulty}</span>
                </div>
            </div>
            <div className="p-6">
                <p className="text-slate-300 mb-6 leading-relaxed text-lg">{topic.concept}</p>
                {topic.exampleCode && (
                <div className="relative group">
                    <div className="absolute top-2 right-2 text-xs text-slate-500 font-mono">C# Example</div>
                    <div className="bg-[#1e1e1e] rounded-lg p-5 border-l-4 border-cyan-600 font-mono text-sm overflow-x-auto text-slate-300 shadow-inner">
                        <pre className="whitespace-pre-wrap break-words font-mono leading-6">{topic.exampleCode}</pre>
                    </div>
                </div>
                )}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-12 text-center">
        <button 
            onClick={enterQuizMode}
            className="px-16 py-5 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white rounded-2xl font-bold shadow-xl text-xl transition-transform hover:-translate-y-1"
        >
            开始测试
        </button>
      </div>
    </div>
  );

  const renderQuiz = (isComprehensive = false) => {
      if (quizResult && !isComprehensive) {
          return (
            <div className="max-w-2xl mx-auto p-8 text-center pt-20">
                <div className="inline-block p-6 rounded-full bg-slate-800 border border-slate-700 mb-8">
                    <div className="text-6xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500">
                        {quizResult.score} <span className="text-2xl text-slate-500 font-normal">/ {quizResult.total}</span>
                    </div>
                </div>
                <h2 className="text-3xl font-bold text-white mb-4">
                    {quizResult.score === quizResult.total ? "完美通过！🎉" : quizResult.score > quizResult.total / 2 ? "通过测试！👍" : "还需要加强哦 💪"}
                </h2>
                <p className="text-slate-400 mb-10 text-lg">测试已完成，点击下方按钮生成今日的专属复习笔记并保存进度。</p>
                <button
                    onClick={generateNotesAction}
                    className="px-10 py-4 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl font-bold text-lg transition-all shadow-lg hover:shadow-cyan-500/20"
                >
                    生成并保存笔记
                </button>
            </div>
          )
      }
      
      if (quizResult && isComprehensive) {
           return (
            <div className="max-w-2xl mx-auto p-8 text-center pt-20">
                 <h2 className="text-4xl font-bold text-white mb-6">汇总考试结果</h2>
                 <div className="text-6xl font-black text-purple-400 mb-8">
                        {quizResult.score} / {quizResult.total}
                 </div>
                 <button
                    onClick={() => setView(AppView.HOME)}
                    className="px-8 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-xl"
                >
                    返回首页
                </button>
            </div>
           );
      }

      return (
        <div className="max-w-3xl mx-auto p-6 pb-32">
             <div className="mb-8 flex items-center justify-between">
                <h2 className="text-3xl font-bold text-white flex items-center gap-3">
                    <span className={`rounded-lg px-3 py-1 text-lg ${isComprehensive ? 'bg-purple-900 text-purple-300' : 'bg-cyan-900 text-cyan-300'}`}>
                        {isComprehensive ? '汇总考试' : '每日测试'}
                    </span>
                </h2>
                <div className="text-slate-400 font-mono">
                    已答: {quizAnswers.filter(a => a !== -1).length} / {questions.length}
                </div>
             </div>
             
             <div className="space-y-10">
                 {questions.map((q, qIdx) => (
                     <div key={qIdx} className="bg-slate-800 border border-slate-700 rounded-2xl p-8 shadow-lg">
                         <h3 className="text-xl font-semibold text-white mb-6 leading-relaxed">
                             <span className="text-slate-500 mr-2">{qIdx + 1}.</span>
                             {q.question}
                         </h3>
                         <div className="space-y-3">
                             {q.options.map((opt, oIdx) => (
                                 <button
                                    key={oIdx}
                                    onClick={() => {
                                        const newAnswers = [...quizAnswers];
                                        newAnswers[qIdx] = oIdx;
                                        setQuizAnswers(newAnswers);
                                    }}
                                    className={`w-full text-left p-4 rounded-xl border transition-all flex items-start gap-3 group ${
                                        quizAnswers[qIdx] === oIdx 
                                        ? 'bg-cyan-900/40 border-cyan-500 text-cyan-100 shadow-[0_0_15px_rgba(6,182,212,0.15)]' 
                                        : 'bg-slate-900/50 border-slate-700 text-slate-400 hover:bg-slate-700 hover:border-slate-600'
                                    }`}
                                 >
                                     <span className={`flex-shrink-0 w-6 h-6 rounded flex items-center justify-center text-xs font-bold border ${
                                         quizAnswers[qIdx] === oIdx ? 'border-cyan-400 text-cyan-400' : 'border-slate-600 text-slate-600 group-hover:border-slate-500'
                                     }`}>
                                         {String.fromCharCode(65 + oIdx)}
                                     </span> 
                                     <span className="pt-0.5">{opt}</span>
                                 </button>
                             ))}
                         </div>
                     </div>
                 ))}
             </div>
             <div className="mt-12 flex justify-end">
                 <button
                    onClick={submitQuiz}
                    disabled={quizAnswers.includes(-1)}
                    className="px-10 py-4 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed text-white rounded-xl font-bold shadow-lg transition-colors text-lg"
                 >
                    提交试卷
                 </button>
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
                                  <span className="text-slate-500 text-sm hidden sm:inline">| 测试得分: {note.quizScore}/5</span>
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
