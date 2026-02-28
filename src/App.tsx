import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, BookOpen, CheckCircle2, XCircle, Trash2, RotateCcw, ChevronRight, LayoutGrid, List } from 'lucide-react';

interface Word {
  id: number;
  korean: string;
  vietnamese: string;
  nextReview: number;
  repetition: number;
}

export default function App() {
  const [view, setView] = useState<'dashboard' | 'add' | 'review' | 'list'>('dashboard');
  const [words, setWords] = useState<Word[]>([]);
  const [dueWords, setDueWords] = useState<Word[]>([]);
  const [currentReviewIndex, setCurrentReviewIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [newKorean, setNewKorean] = useState('');
  const [newVietnamese, setNewVietnamese] = useState('');
  const [isFrontKorean, setIsFrontKorean] = useState(true);

  useEffect(() => {
    fetchWords();
    fetchDueWords();
  }, []);

  const fetchWords = async () => {
    const res = await fetch('/api/words');
    const data = await res.json();
    setWords(data);
  };

  const fetchDueWords = async () => {
    const res = await fetch('/api/words/due');
    const data = await res.json();
    // Shuffle due words
    setDueWords(data.sort(() => Math.random() - 0.5));
  };

  const handleAddWord = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKorean || !newVietnamese) return;
    await fetch('/api/words', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ korean: newKorean, vietnamese: newVietnamese }),
    });
    setNewKorean('');
    setNewVietnamese('');
    fetchWords();
    fetchDueWords();
    setView('dashboard');
  };

  const handleReview = async (quality: number) => {
    const word = dueWords[currentReviewIndex];
    await fetch(`/api/words/${word.id}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quality }),
    });

    setIsFlipped(false);
    setTimeout(() => {
      if (currentReviewIndex < dueWords.length - 1) {
        setCurrentReviewIndex(prev => prev + 1);
        setIsFrontKorean(Math.random() > 0.5);
      } else {
        setView('dashboard');
        fetchDueWords();
        setCurrentReviewIndex(0);
      }
    }, 200);
  };

  const deleteWord = async (id: number) => {
    await fetch(`/api/words/${id}`, { method: 'DELETE' });
    fetchWords();
    fetchDueWords();
  };

  return (
    <div className="min-h-screen bg-[#FDFCFB] text-[#2D2D2D] font-sans pb-20">
      {/* Header */}
      <header className="p-6 flex justify-between items-center border-b border-black/5 bg-white/80 backdrop-blur-md sticky top-0 z-10">
        <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
          <span className="bg-emerald-500 text-white p-1 rounded-lg">한</span>
          Korean SRS
        </h1>
        {dueWords.length > 0 && (
          <div className="bg-orange-100 text-orange-700 px-3 py-1 rounded-full text-xs font-bold animate-pulse">
            {dueWords.length} từ cần ôn
          </div>
        )}
      </header>

      <main className="max-w-md mx-auto p-6">
        <AnimatePresence mode="wait">
          {view === 'dashboard' && (
            <motion.div
              key="dashboard"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-6"
            >
              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={() => setView('review')}
                  disabled={dueWords.length === 0}
                  className={`p-6 rounded-3xl flex flex-col items-center justify-center gap-3 transition-all ${
                    dueWords.length > 0 
                    ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-200 active:scale-95' 
                    : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  }`}
                >
                  <BookOpen size={32} />
                  <span className="font-bold">Ôn tập</span>
                </button>
                <button
                  onClick={() => setView('add')}
                  className="p-6 bg-white border border-black/5 rounded-3xl flex flex-col items-center justify-center gap-3 shadow-sm active:scale-95 transition-all"
                >
                  <Plus size={32} className="text-emerald-500" />
                  <span className="font-bold">Thêm từ</span>
                </button>
              </div>

              <div className="bg-white p-6 rounded-3xl border border-black/5 shadow-sm">
                <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4">Thống kê</h2>
                <div className="flex justify-between items-end">
                  <div>
                    <p className="text-4xl font-bold">{words.length}</p>
                    <p className="text-sm text-gray-500">Tổng số từ</p>
                  </div>
                  <button 
                    onClick={() => setView('list')}
                    className="text-emerald-500 text-sm font-bold flex items-center gap-1"
                  >
                    Xem tất cả <ChevronRight size={16} />
                  </button>
                </div>
              </div>

              {dueWords.length === 0 && (
                <div className="text-center py-12">
                  <div className="bg-emerald-50 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4">
                    <CheckCircle2 size={40} className="text-emerald-500" />
                  </div>
                  <h3 className="font-bold text-lg">Tuyệt vời!</h3>
                  <p className="text-gray-500">Bạn đã hoàn thành tất cả các từ cần ôn hôm nay.</p>
                </div>
              )}
            </motion.div>
          )}

          {view === 'add' && (
            <motion.div
              key="add"
              initial={{ opacity: 0, x: 50 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -50 }}
            >
              <h2 className="text-2xl font-bold mb-6">Thêm từ mới</h2>
              <form onSubmit={handleAddWord} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Tiếng Hàn</label>
                  <input
                    autoFocus
                    type="text"
                    value={newKorean}
                    onChange={e => setNewKorean(e.target.value)}
                    className="w-full p-4 bg-white border border-black/10 rounded-2xl focus:ring-2 focus:ring-emerald-500 outline-none transition-all text-lg"
                    placeholder="VD: 안녕하세요"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Nghĩa tiếng Việt</label>
                  <input
                    type="text"
                    value={newVietnamese}
                    onChange={e => setNewVietnamese(e.target.value)}
                    className="w-full p-4 bg-white border border-black/10 rounded-2xl focus:ring-2 focus:ring-emerald-500 outline-none transition-all text-lg"
                    placeholder="VD: Xin chào"
                  />
                </div>
                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setView('dashboard')}
                    className="flex-1 p-4 bg-gray-100 rounded-2xl font-bold active:scale-95 transition-all"
                  >
                    Hủy
                  </button>
                  <button
                    type="submit"
                    className="flex-2 p-4 bg-emerald-500 text-white rounded-2xl font-bold shadow-lg shadow-emerald-200 active:scale-95 transition-all"
                  >
                    Lưu từ vựng
                  </button>
                </div>
              </form>
            </motion.div>
          )}

          {view === 'review' && dueWords.length > 0 && (
            <motion.div
              key="review"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="space-y-8"
            >
              <div className="flex justify-between items-center">
                <span className="text-sm font-bold text-gray-400">
                  Đang ôn: {currentReviewIndex + 1} / {dueWords.length}
                </span>
                <button onClick={() => setView('dashboard')} className="text-gray-400">
                  <XCircle size={24} />
                </button>
              </div>

              <div 
                className="relative h-80 w-full perspective-1000 cursor-pointer"
                onClick={() => setIsFlipped(!isFlipped)}
              >
                <motion.div
                  className="w-full h-full relative preserve-3d transition-all duration-500"
                  animate={{ rotateY: isFlipped ? 180 : 0 }}
                >
                  {/* Front */}
                  <div className="absolute inset-0 backface-hidden bg-white border-2 border-emerald-500/20 rounded-[40px] shadow-xl flex flex-col items-center justify-center p-8 text-center">
                    <span className="text-xs font-bold text-emerald-500 uppercase tracking-widest mb-4">
                      {isFrontKorean ? 'Tiếng Hàn' : 'Tiếng Việt'}
                    </span>
                    <h3 className="text-4xl font-bold">
                      {isFrontKorean ? dueWords[currentReviewIndex].korean : dueWords[currentReviewIndex].vietnamese}
                    </h3>
                    <p className="mt-8 text-gray-400 text-sm animate-bounce">Chạm để xem nghĩa</p>
                  </div>

                  {/* Back */}
                  <div 
                    className="absolute inset-0 backface-hidden bg-emerald-500 text-white rounded-[40px] shadow-xl flex flex-col items-center justify-center p-8 text-center"
                    style={{ transform: 'rotateY(180deg)' }}
                  >
                    <span className="text-xs font-bold text-white/60 uppercase tracking-widest mb-4">
                      {isFrontKorean ? 'Tiếng Việt' : 'Tiếng Hàn'}
                    </span>
                    <h3 className="text-4xl font-bold">
                      {isFrontKorean ? dueWords[currentReviewIndex].vietnamese : dueWords[currentReviewIndex].korean}
                    </h3>
                  </div>
                </motion.div>
              </div>

              {isFlipped && (
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="grid grid-cols-2 gap-4"
                >
                  <button
                    onClick={(e) => { e.stopPropagation(); handleReview(0); }}
                    className="p-5 bg-rose-50 text-rose-600 rounded-3xl font-bold flex flex-col items-center gap-2 border border-rose-100 active:scale-95 transition-all"
                  >
                    <RotateCcw size={24} />
                    Chưa nhớ
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleReview(5); }}
                    className="p-5 bg-emerald-50 text-emerald-600 rounded-3xl font-bold flex flex-col items-center gap-2 border border-emerald-100 active:scale-95 transition-all"
                  >
                    <CheckCircle2 size={24} />
                    Đã nhớ
                  </button>
                </motion.div>
              )}
            </motion.div>
          )}

          {view === 'list' && (
            <motion.div
              key="list"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">Danh sách từ</h2>
                <button onClick={() => setView('dashboard')} className="text-gray-400">
                  <XCircle size={24} />
                </button>
              </div>
              <div className="space-y-3">
                {words.map(word => (
                  <div key={word.id} className="bg-white p-4 rounded-2xl border border-black/5 flex justify-between items-center shadow-sm">
                    <div>
                      <p className="font-bold text-lg">{word.korean}</p>
                      <p className="text-gray-500 text-sm">{word.vietnamese}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <p className="text-[10px] font-bold text-gray-400 uppercase">Lần lặp</p>
                        <p className="text-xs font-bold">{word.repetition}</p>
                      </div>
                      <button 
                        onClick={() => deleteWord(word.id)}
                        className="text-rose-400 p-2 hover:bg-rose-50 rounded-full transition-colors"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </div>
                ))}
                {words.length === 0 && (
                  <p className="text-center text-gray-400 py-10">Chưa có từ nào trong danh sách.</p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Navigation Bar (Mobile Style) */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur-lg border-t border-black/5 p-4 flex justify-around items-center z-20">
        <button 
          onClick={() => setView('dashboard')}
          className={`p-2 rounded-xl transition-all ${view === 'dashboard' ? 'text-emerald-500 bg-emerald-50' : 'text-gray-400'}`}
        >
          <LayoutGrid size={24} />
        </button>
        <button 
          onClick={() => setView('review')}
          className={`p-2 rounded-xl transition-all ${view === 'review' ? 'text-emerald-500 bg-emerald-50' : 'text-gray-400'}`}
        >
          <BookOpen size={24} />
        </button>
        <button 
          onClick={() => setView('list')}
          className={`p-2 rounded-xl transition-all ${view === 'list' ? 'text-emerald-500 bg-emerald-50' : 'text-gray-400'}`}
        >
          <List size={24} />
        </button>
      </nav>

      <style>{`
        .perspective-1000 { perspective: 1000px; }
        .preserve-3d { transform-style: preserve-3d; }
        .backface-hidden { backface-visibility: hidden; }
      `}</style>
    </div>
  );
}
