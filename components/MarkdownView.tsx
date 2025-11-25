import React from 'react';

interface Props {
  content: string;
}

export const MarkdownView: React.FC<Props> = ({ content }) => {
  if (!content) return null;

  // 1. CRITICAL FIX: Replace literal escaped newlines ("\n") from JSON with actual newlines
  // 2. Normalize multiple newlines to max 2 to prevent huge gaps
  const normalizedContent = content
    .replace(/\\n/g, '\n') 
    .replace(/\n{3,}/g, '\n\n');

  // Split content into code blocks and text blocks
  const parts = normalizedContent.split(/(```[\s\S]*?```)/g);

  return (
    <div className="space-y-4 text-slate-300 leading-relaxed font-sans text-base">
      {parts.map((part, partIdx) => {
        // Handle Code Blocks
        if (part.startsWith('```')) {
          const codeLines = part.split('\n');
          let codeContent = "";
          let lang = "";
          
          if (codeLines.length > 1) {
             const firstLine = codeLines[0].trim();
             lang = firstLine.replace(/^```/, '');
             codeContent = codeLines.slice(1, -1).join('\n');
          } else {
             codeContent = part.replace(/^```[a-z]*\s?/, '').replace(/```$/, '');
          }
          
          return (
            <div key={partIdx} className="bg-[#1e1e1e] rounded-lg border border-slate-700 my-6 overflow-hidden shadow-lg">
              <div className="bg-[#2d2d2d] px-4 py-2 text-xs text-slate-400 border-b border-slate-700 flex justify-between uppercase tracking-wider font-bold">
                 <span>{lang || 'CODE'}</span>
              </div>
              <div className="p-4 overflow-x-auto">
                <pre className="font-mono text-sm text-cyan-100 whitespace-pre tab-4">{codeContent}</pre>
              </div>
            </div>
          );
        }

        // Handle Regular Markdown Text
        return (
          <div key={partIdx} className="whitespace-pre-wrap">
            {part.split('\n').map((line, idx) => {
              const trimmed = line.trim();
              if (!trimmed) return <div key={idx} className="h-3"></div>; 
              
              // Headers
              if (trimmed.startsWith('###')) {
                return (
                    <h3 key={idx} className="text-lg font-bold text-unity-accent mt-8 mb-4 flex items-center gap-2 pb-2 border-b border-slate-800">
                        <span className="text-cyan-600">▍</span>
                        {trimmed.replace(/#{1,6}\s/, '')}
                    </h3>
                );
              }
              if (trimmed.startsWith('##')) {
                return <h2 key={idx} className="text-xl font-bold text-white mt-10 mb-5 border-b border-slate-700 pb-2">{trimmed.replace(/#{1,6}\s/, '')}</h2>;
              }
              if (trimmed.startsWith('#')) {
                return <h1 key={idx} className="text-2xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500 mb-6">{trimmed.replace(/#{1,6}\s/, '')}</h1>;
              }
              
              // Lists
              if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
                const content = trimmed.replace(/^[-*]\s/, '');
                return (
                  <div key={idx} className="flex items-start gap-3 mb-3 ml-1">
                      <span className="text-cyan-500 mt-2 text-[6px] flex-shrink-0">●</span>
                      <span className="text-slate-300 leading-7">
                          {parseInline(content)}
                      </span>
                  </div>
                )
              }

              if (/^\d+\.\s/.test(trimmed)) {
                   const [num, ...rest] = trimmed.split('.');
                   return (
                       <div key={idx} className="flex items-start gap-3 mb-3 ml-1">
                           <span className="text-cyan-500 font-mono font-bold mt-0.5 flex-shrink-0">{num}.</span>
                           <span className="text-slate-300 leading-7">{parseInline(rest.join('.').trim())}</span>
                       </div>
                   )
              }

              // Normal text
              return <p key={idx} className="mb-4 text-slate-300 leading-7">{parseInline(trimmed)}</p>;
            })}
          </div>
        );
      })}
    </div>
  );
};

// Helper for bold/code inline parsing
const parseInline = (text: string) => {
    const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
    return parts.map((p, i) => {
        if (p.startsWith('`') && p.endsWith('`')) {
            return <span key={i} className="bg-slate-800 text-cyan-200 px-1.5 py-0.5 rounded text-sm font-mono border border-slate-700 mx-1">{p.slice(1, -1)}</span>
        }
        if (p.startsWith('**') && p.endsWith('**')) {
            return <strong key={i} className="text-white font-bold">{p.slice(2, -2)}</strong>
        }
        return p;
    });
};