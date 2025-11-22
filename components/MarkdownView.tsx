import React from 'react';

interface Props {
  content: string;
}

export const MarkdownView: React.FC<Props> = ({ content }) => {
  if (!content) return null;

  // Split content into code blocks and text blocks
  const parts = content.split(/(```[\s\S]*?```)/g);

  return (
    <div className="space-y-4 text-slate-300 leading-relaxed">
      {parts.map((part, partIdx) => {
        if (part.startsWith('```')) {
          // Remove backticks and language identifier
          const codeContent = part.replace(/^```[a-z]*\n?/, '').replace(/```$/, '');
          return (
            <div key={partIdx} className="bg-slate-950 rounded-lg p-4 border border-slate-700 my-4 overflow-x-auto">
              <pre className="font-mono text-sm text-cyan-300 whitespace-pre">{codeContent}</pre>
            </div>
          );
        }

        // Render text blocks line by line for headers etc.
        const paragraphs = part.split('\n');
        return (
          <div key={partIdx}>
            {paragraphs.map((p, idx) => {
              if (!p.trim()) return null;
              
              if (p.startsWith('###')) {
                return <h3 key={idx} className="text-xl font-bold text-unity-accent mt-6 mb-2">{p.replace('###', '').trim()}</h3>;
              }
              if (p.startsWith('##')) {
                return <h2 key={idx} className="text-2xl font-bold text-white mt-8 mb-3 border-b border-slate-700 pb-2">{p.replace('##', '').trim()}</h2>;
              }
              if (p.startsWith('#')) {
                return <h1 key={idx} className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500 mb-6">{p.replace('#', '').trim()}</h1>;
              }
              
              // Detect list items
              if (p.trim().startsWith('- ') || p.trim().startsWith('* ')) {
                return <li key={idx} className="ml-4 list-disc marker:text-cyan-500 pl-2 mb-1">{p.replace(/^[-*]\s/, '')}</li>
              }

              // Inline code lines (not block)
              if (p.includes('`')) {
                  const inlineParts = p.split('`');
                  return (
                      <p key={idx} className="mb-2">
                          {inlineParts.map((ip, i) => 
                              i % 2 === 1 ? <span key={i} className="bg-slate-800 text-cyan-300 px-1.5 py-0.5 rounded text-sm font-mono mx-0.5">{ip}</span> : ip
                          )}
                      </p>
                  )
              }

              return <p key={idx} className="mb-2">{p}</p>;
            })}
          </div>
        );
      })}
    </div>
  );
};