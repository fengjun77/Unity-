import React, { useState, useMemo, useRef } from 'react';
import { SavedNote, Topic } from '../types';
import { MarkdownView } from './MarkdownView';

interface NotesViewProps {
  savedNotes: SavedNote[];
}

export const NotesView: React.FC<NotesViewProps> = ({ savedNotes }) => {
  const [noteSearchQuery, setNoteSearchQuery] = useState("");
  const [noteFilter, setNoteFilter] = useState<'ALL' | 'UNITY' | 'CSHARP'>('ALL');
  const [activeNoteTopic, setActiveNoteTopic] = useState<Topic | null>(null);
  const notesContentRef = useRef<HTMLDivElement>(null);

  const allTopics = useMemo(() => {
      if (!savedNotes) return [];
      return savedNotes.flatMap(note => 
          note.topics.map(topic => ({
              ...topic,
              originalDay: note.day,
              originalDate: note.date,
              sourceTrack: note.track
          }))
      );
  }, [savedNotes]);

  const filteredTopics = useMemo(() => {
      let result = allTopics;
      if (noteFilter === 'UNITY') result = result.filter(t => (t as any).sourceTrack === 'UNITY');
      if (noteFilter === 'CSHARP') result = result.filter(t => (t as any).sourceTrack === 'CSHARP_ALGO');
      
      if (noteSearchQuery.trim()) {
          const lowerQuery = noteSearchQuery.toLowerCase();
          result = result.filter(t => 
              t.title.toLowerCase().includes(lowerQuery) || 
              t.concept.toLowerCase().includes(lowerQuery)
          );
      }
      return result;
  }, [allTopics, noteSearchQuery, noteFilter]);

  const handleTopicSelect = (topic: Topic) => {
      setActiveNoteTopic(topic);
      if (notesContentRef.current) {
          notesContentRef.current.scrollTop = 0;
      }
  };

  // We use flex-1 and h-full here instead of fixed positioning to avoid context stacking issues with animations
  return (
    <div className="flex h-full bg-slate-900 overflow-hidden">
        {/* Left Sidebar */}
        <div className="w-1/3 min-w-[300px] max-w-sm border-r border-slate-700 bg-slate-800 flex flex-col z-10 shadow-xl">
            <div className="p-4 border-b border-slate-700 bg-slate-800 z-10 shadow-sm">
                <div className="flex gap-2 mb-3">
                    {(['ALL', 'UNITY', 'CSHARP'] as const).map(f => (
                        <button 
                            key={f}
                            onClick={() => setNoteFilter(f)}
                            className={`flex-1 py-1.5 text-xs font-bold rounded transition-colors ${
                                noteFilter === f 
                                ? 'bg-cyan-600 text-white' 
                                : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                            }`}
                        >
                            {f === 'ALL' ? '全部' : f === 'UNITY' ? 'Unity' : 'C# / Algo'}
                        </button>
                    ))}
                </div>
                <div className="relative">
                    <svg className="w-5 h-5 absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                    <input 
                        type="text" 
                        placeholder="搜索知识点..." 
                        value={noteSearchQuery}
                        onChange={(e) => setNoteSearchQuery(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-600 rounded-lg pl-10 pr-4 py-2 text-white focus:ring-2 focus:ring-cyan-500 outline-none text-sm"
                    />
                </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar">
                {filteredTopics.length === 0 ? (
                    <div className="p-8 text-center text-slate-500 text-sm">未找到相关内容</div>
                ) : (
                    <div className="divide-y divide-slate-700/50">
                        {filteredTopics.map((t, idx) => (
                            <button
                                key={idx}
                                onClick={() => handleTopicSelect(t)}
                                className={`w-full text-left p-4 hover:bg-slate-700/50 transition-colors flex flex-col gap-1 group ${
                                    activeNoteTopic === t ? 'bg-cyan-900/20 border-l-4 border-cyan-500 pl-3' : 'border-l-4 border-transparent'
                                }`}
                            >
                                <h4 className={`font-medium line-clamp-1 group-hover:text-white ${activeNoteTopic === t ? 'text-cyan-300' : 'text-slate-300'}`}>
                                    {t.title}
                                </h4>
                                <div className="flex justify-between items-center w-full">
                                    <span className="text-[10px] text-slate-500 font-mono bg-slate-800 px-1.5 rounded">
                                        Day {(t as any).originalDay}
                                    </span>
                                    <span className={`text-[10px] px-2 py-0.5 rounded-full border ${
                                        (t as any).sourceTrack === 'UNITY' ? 'border-blue-900 text-blue-400' : 'border-purple-900 text-purple-400'
                                    }`}>
                                        {(t as any).sourceTrack === 'UNITY' ? 'Unity' : 'C#'}
                                    </span>
                                </div>
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>

        {/* Right Pane */}
        <div ref={notesContentRef} className="flex-1 overflow-y-auto bg-[#0d1117] relative scroll-smooth">
            {activeNoteTopic ? (
                <div className="p-8 max-w-4xl mx-auto animate-fade-in pb-32">
                    <div className="mb-6 pb-6 border-b border-slate-800">
                        <div className="flex items-center gap-3 mb-2">
                            <span className="text-xs font-bold text-cyan-400 uppercase tracking-wider">
                                Day {(activeNoteTopic as any).originalDay} • {(activeNoteTopic as any).originalDate}
                            </span>
                            <span className={`text-xs px-2 py-0.5 rounded border ${
                                activeNoteTopic.difficulty === '高级' ? 'border-red-900 text-red-400' : 'border-green-900 text-green-400'
                            }`}>
                                {activeNoteTopic.difficulty}
                            </span>
                        </div>
                        <h1 className="text-3xl font-bold text-white">{activeNoteTopic.title}</h1>
                    </div>
                    <MarkdownView content={activeNoteTopic.concept} />
                    {activeNoteTopic.exampleCode && (
                         <div className="mt-8 bg-slate-900 rounded-xl p-6 border border-slate-800">
                            <h4 className="text-sm text-slate-500 font-mono mb-3 border-b border-slate-800 pb-2">Code Example</h4>
                            <pre className="whitespace-pre-wrap break-words font-mono text-sm text-slate-300 leading-relaxed">
                                {activeNoteTopic.exampleCode}
                            </pre>
                         </div>
                    )}
                </div>
            ) : (
                <div className="h-full flex flex-col items-center justify-center text-slate-500 p-8">
                    <div className="w-20 h-20 bg-slate-800 rounded-full flex items-center justify-center mb-4 text-slate-600">
                        <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
                    </div>
                    <h3 className="text-xl font-bold text-slate-400 mb-2">选择一个知识点开始复习</h3>
                    <p className="text-sm max-w-xs text-center">从左侧列表中点击标题，或使用上方搜索框查找特定内容。</p>
                </div>
            )}
        </div>
    </div>
  );
};