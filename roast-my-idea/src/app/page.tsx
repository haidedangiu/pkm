'use client';

import { useState } from 'react';

export default function Home() {
  const [idea, setIdea] = useState('');
  const [roast, setRoast] = useState('');
  const [loading, setLoading] = useState(false);

  const handleRoast = async () => {
    if (!idea.trim()) return;
    
    setLoading(true);
    setRoast('');
    
    try {
      const res = await fetch('/api/roast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idea }),
      });
      
      const data = await res.json();
      setRoast(data.roast);
    } catch (err) {
      setRoast('Selbst mein Roast-Generator hat aufgegeben. Das sagt alles.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-8">
      <div className="max-w-2xl w-full space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-5xl font-bold tracking-tight">
            Roast My Idea
          </h1>
          <p className="text-gray-400 text-lg">
            Gib deine Startup-Idee ein. Wir sagen dir warum sie scheitern wird.
          </p>
        </div>

        <div className="space-y-4">
          <textarea
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            placeholder="z.B. Uber für Hunde, Tinder für Pflanzen, Blockchain für Bäckereien..."
            className="w-full h-32 p-4 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-orange-500 resize-none"
          />
          
          <button
            onClick={handleRoast}
            disabled={loading || !idea.trim()}
            className="w-full py-4 bg-orange-600 hover:bg-orange-500 disabled:bg-gray-700 disabled:cursor-not-allowed rounded-lg font-bold text-lg transition-colors"
          >
            {loading ? 'Lade Beleidigungen...' : 'ROAST ME'}
          </button>
        </div>

        {roast && (
          <div className="p-6 bg-gray-900 border border-orange-500 rounded-lg">
            <p className="text-xl leading-relaxed">{roast}</p>
          </div>
        )}

        <p className="text-center text-gray-600 text-sm">
          Keine Idee ist zu dumm. Wir finden trotzdem was.
        </p>
      </div>
    </main>
  );
}
