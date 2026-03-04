import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Plus, BookOpen, CheckCircle2, XCircle, Trash2, RotateCcw,
  ChevronRight, LayoutGrid, List, Search, Volume2, X,
  BookMarked, Loader2, PlusCircle, ChevronDown, ChevronUp
} from 'lucide-react';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface Word {
  id: number;
  korean: string;
  vietnamese: string;
  interval: number;
  repetition: number;
  easiness: number;
  nextReview: number;
  createdAt: number;
  examples?: { korean: string; vietnamese: string }[];
}

interface GameData {
  streak: number;
  lastReviewDate: string; // YYYY-MM-DD
  xp: number;
  level: number;
  totalReviewed: number;
}

interface DictSuggestion {
  korean: string;
  romanization: string;
  brief: string;
}

interface DictExample {
  korean: string;
  vietnamese: string;
}

interface DictMeaning {
  vietnamese: string;
  examples: DictExample[];
}

interface DictDetail {
  korean: string;
  romanization: string;
  wordType: string;
  meanings: DictMeaning[];
  level: string;
  note?: string;
  source?: string;
}

// ─── Storage ────────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'korean_srs_words';
const DICT_CACHE_KEY = 'korean_dict_cache';
const GAMIFICATION_KEY = 'korean_srs_gamification';

function loadWords(): Word[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveWords(words: Word[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(words));
}

function loadGameData(): GameData {
  try {
    const raw = localStorage.getItem(GAMIFICATION_KEY);
    return raw ? JSON.parse(raw) : { streak: 0, lastReviewDate: '', xp: 0, level: 1, totalReviewed: 0 };
  } catch { return { streak: 0, lastReviewDate: '', xp: 0, level: 1, totalReviewed: 0 }; }
}

function saveGameData(data: GameData) {
  localStorage.setItem(GAMIFICATION_KEY, JSON.stringify(data));
}

function calcLevel(xp: number): number {
  return Math.floor(xp / 200) + 1;
}

function xpForNextLevel(level: number): number {
  return level * 200;
}

function updateGameDataAfterReview(quality: number): { newData: GameData; leveledUp: boolean } {
  const data = loadGameData();
  const today = new Date().toISOString().slice(0, 10);
  const xpGain = quality === 5 ? 15 : 10;
  const newXp = data.xp + xpGain;
  const newLevel = calcLevel(newXp);
  const leveledUp = newLevel > data.level;

  // Streak logic
  let newStreak = data.streak;
  if (data.lastReviewDate === today) {
    // same day - streak unchanged
  } else {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yStr = yesterday.toISOString().slice(0, 10);
    if (data.lastReviewDate === yStr) {
      newStreak += 1; // continued streak
    } else if (data.lastReviewDate !== today) {
      newStreak = 1; // reset
    }
  }

  const newData: GameData = {
    streak: newStreak,
    lastReviewDate: today,
    xp: newXp,
    level: newLevel,
    totalReviewed: data.totalReviewed + 1,
  };
  saveGameData(newData);
  return { newData, leveledUp };
}

// Request notification permission on startup
function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

// ─── Client-side Dictionary (no server needed) ─────────────────────────────

// Gemini API key (embedded for standalone APK use)
const GEMINI_API_KEY = 'AIzaSyBh2JCOM4PBYqAz9iufN4lRzVIvoY_0mHY';

// Bundled ~180 common Korean words (TOPIK Level 1-2) - always available offline
interface KoreanWord { korean: string; romanization: string; brief: string; }
const KOREAN_WORDLIST: KoreanWord[] = [
  { korean: "안녕하세요", romanization: "annyeonghaseyo", brief: "xin chào" },
  { korean: "안녕", romanization: "annyeong", brief: "chào (thân mật)" },
  { korean: "감사합니다", romanization: "gamsahamnida", brief: "cảm ơn" },
  { korean: "고마워요", romanization: "gomawoyo", brief: "cảm ơn (thân mật)" },
  { korean: "죄송합니다", romanization: "joesonghamnida", brief: "xin lỗi" },
  { korean: "미안해요", romanization: "mianhaeyo", brief: "xin lỗi (thân mật)" },
  { korean: "네", romanization: "ne", brief: "vâng, có" },
  { korean: "아니요", romanization: "aniyo", brief: "không" },
  { korean: "괜찮아요", romanization: "gwaenchanayo", brief: "không sao" },
  { korean: "반갑습니다", romanization: "bangapseumnida", brief: "rất vui gặp bạn" },
  { korean: "잠깐만요", romanization: "jamkkanmanyo", brief: "chờ một chút" },
  { korean: "부탁합니다", romanization: "butakamnida", brief: "làm ơn" },
  { korean: "나", romanization: "na", brief: "tôi (thân mật)" },
  { korean: "저", romanization: "jeo", brief: "tôi (lịch sự)" },
  { korean: "너", romanization: "neo", brief: "bạn (thân mật)" },
  { korean: "우리", romanization: "uri", brief: "chúng tôi" },
  { korean: "사람", romanization: "saram", brief: "người" },
  { korean: "남자", romanization: "namja", brief: "đàn ông, con trai" },
  { korean: "여자", romanization: "yeoja", brief: "phụ nữ, con gái" },
  { korean: "아이", romanization: "ai", brief: "đứa trẻ" },
  { korean: "친구", romanization: "chingu", brief: "bạn bè" },
  { korean: "가족", romanization: "gajok", brief: "gia đình" },
  { korean: "아버지", romanization: "abeoji", brief: "cha, bố" },
  { korean: "어머니", romanization: "eomeoni", brief: "mẹ" },
  { korean: "형", romanization: "hyeong", brief: "anh (nam gọi)" },
  { korean: "오빠", romanization: "oppa", brief: "anh (nữ gọi)" },
  { korean: "누나", romanization: "nuna", brief: "chị (nam gọi)" },
  { korean: "언니", romanization: "eonni", brief: "chị (nữ gọi)" },
  { korean: "남동생", romanization: "namdongsaeng", brief: "em trai" },
  { korean: "여동생", romanization: "yeodongsaeng", brief: "em gái" },
  { korean: "할아버지", romanization: "harabeoji", brief: "ông nội/ngoại" },
  { korean: "할머니", romanization: "halmeoni", brief: "bà nội/ngoại" },
  { korean: "선생님", romanization: "seonsaengnim", brief: "thầy/cô giáo" },
  { korean: "학생", romanization: "haksaeng", brief: "học sinh" },
  { korean: "일", romanization: "il", brief: "một; ngày; việc làm" },
  { korean: "이", romanization: "i", brief: "hai" },
  { korean: "삼", romanization: "sam", brief: "ba" },
  { korean: "사", romanization: "sa", brief: "bốn" },
  { korean: "오", romanization: "o", brief: "năm" },
  { korean: "육", romanization: "yuk", brief: "sáu" },
  { korean: "칠", romanization: "chil", brief: "bảy" },
  { korean: "팔", romanization: "pal", brief: "tám" },
  { korean: "구", romanization: "gu", brief: "chín" },
  { korean: "십", romanization: "sip", brief: "mười" },
  { korean: "백", romanization: "baek", brief: "một trăm" },
  { korean: "천", romanization: "cheon", brief: "một nghìn" },
  { korean: "하나", romanization: "hana", brief: "một (thuần Hàn)" },
  { korean: "둘", romanization: "dul", brief: "hai (thuần Hàn)" },
  { korean: "셋", romanization: "set", brief: "ba (thuần Hàn)" },
  { korean: "넷", romanization: "net", brief: "bốn (thuần Hàn)" },
  { korean: "다섯", romanization: "daseot", brief: "năm (thuần Hàn)" },
  { korean: "여섯", romanization: "yeoseot", brief: "sáu (thuần Hàn)" },
  { korean: "일곱", romanization: "ilgop", brief: "bảy (thuần Hàn)" },
  { korean: "여덟", romanization: "yeodeol", brief: "tám (thuần Hàn)" },
  { korean: "아홉", romanization: "ahop", brief: "chín (thuần Hàn)" },
  { korean: "열", romanization: "yeol", brief: "mười (thuần Hàn)" },
  { korean: "지금", romanization: "jigeum", brief: "bây giờ" },
  { korean: "오늘", romanization: "oneul", brief: "hôm nay" },
  { korean: "어제", romanization: "eoje", brief: "hôm qua" },
  { korean: "내일", romanization: "naeil", brief: "ngày mai" },
  { korean: "시간", romanization: "sigan", brief: "giờ, thời gian" },
  { korean: "아침", romanization: "achim", brief: "buổi sáng" },
  { korean: "점심", romanization: "jeomsim", brief: "buổi trưa" },
  { korean: "저녁", romanization: "jeonyeok", brief: "buổi tối" },
  { korean: "밤", romanization: "bam", brief: "đêm" },
  { korean: "주말", romanization: "jumal", brief: "cuối tuần" },
  { korean: "월요일", romanization: "woryoil", brief: "thứ Hai" },
  { korean: "화요일", romanization: "hwaryoil", brief: "thứ Ba" },
  { korean: "수요일", romanization: "suyoil", brief: "thứ Tư" },
  { korean: "목요일", romanization: "mogyoil", brief: "thứ Năm" },
  { korean: "금요일", romanization: "geumyoil", brief: "thứ Sáu" },
  { korean: "토요일", romanization: "toyoil", brief: "thứ Bảy" },
  { korean: "일요일", romanization: "iryoil", brief: "Chủ Nhật" },
  { korean: "집", romanization: "jip", brief: "nhà" },
  { korean: "학교", romanization: "hakgyo", brief: "trường học" },
  { korean: "회사", romanization: "hoesa", brief: "công ty" },
  { korean: "병원", romanization: "byeongwon", brief: "bệnh viện" },
  { korean: "식당", romanization: "sikdang", brief: "nhà hàng" },
  { korean: "카페", romanization: "kape", brief: "cà phê" },
  { korean: "마트", romanization: "mateu", brief: "siêu thị" },
  { korean: "편의점", romanization: "pyeonuijeom", brief: "cửa hàng tiện lợi" },
  { korean: "공원", romanization: "gongwon", brief: "công viên" },
  { korean: "도서관", romanization: "doseogwan", brief: "thư viện" },
  { korean: "은행", romanization: "eunhaeng", brief: "ngân hàng" },
  { korean: "공항", romanization: "gonghang", brief: "sân bay" },
  { korean: "지하철", romanization: "jihacheol", brief: "tàu điện ngầm" },
  { korean: "버스", romanization: "beoseu", brief: "xe buýt" },
  { korean: "택시", romanization: "taeksi", brief: "taxi" },
  { korean: "한국", romanization: "hanguk", brief: "Hàn Quốc" },
  { korean: "베트남", romanization: "beteunam", brief: "Việt Nam" },
  { korean: "밥", romanization: "bap", brief: "cơm" },
  { korean: "물", romanization: "mul", brief: "nước" },
  { korean: "빵", romanization: "ppang", brief: "bánh mì" },
  { korean: "고기", romanization: "gogi", brief: "thịt" },
  { korean: "생선", romanization: "saengseon", brief: "cá" },
  { korean: "야채", romanization: "yachae", brief: "rau củ" },
  { korean: "과일", romanization: "gwail", brief: "trái cây" },
  { korean: "사과", romanization: "sagwa", brief: "táo" },
  { korean: "커피", romanization: "keopi", brief: "cà phê" },
  { korean: "차", romanization: "cha", brief: "trà" },
  { korean: "술", romanization: "sul", brief: "rượu, bia" },
  { korean: "김치", romanization: "gimchi", brief: "kimchi" },
  { korean: "라면", romanization: "ramyeon", brief: "mì gói" },
  { korean: "떡", romanization: "tteok", brief: "bánh gạo" },
  { korean: "맛있다", romanization: "masitda", brief: "ngon" },
  { korean: "맵다", romanization: "maepda", brief: "cay" },
  { korean: "달다", romanization: "dalda", brief: "ngọt" },
  { korean: "돈", romanization: "don", brief: "tiền" },
  { korean: "싸다", romanization: "ssada", brief: "rẻ" },
  { korean: "비싸다", romanization: "bissada", brief: "đắt" },
  { korean: "옷", romanization: "ot", brief: "quần áo" },
  { korean: "신발", romanization: "sinbal", brief: "giày dép" },
  { korean: "가다", romanization: "gada", brief: "đi" },
  { korean: "오다", romanization: "oda", brief: "đến" },
  { korean: "있다", romanization: "itda", brief: "có, tồn tại" },
  { korean: "없다", romanization: "eopda", brief: "không có" },
  { korean: "하다", romanization: "hada", brief: "làm" },
  { korean: "먹다", romanization: "meokda", brief: "ăn" },
  { korean: "마시다", romanization: "masida", brief: "uống" },
  { korean: "보다", romanization: "boda", brief: "xem, nhìn" },
  { korean: "듣다", romanization: "deutda", brief: "nghe" },
  { korean: "말하다", romanization: "malhada", brief: "nói" },
  { korean: "읽다", romanization: "ikda", brief: "đọc" },
  { korean: "쓰다", romanization: "sseuda", brief: "viết" },
  { korean: "공부하다", romanization: "gongbuhada", brief: "học bài" },
  { korean: "일하다", romanization: "ilhada", brief: "làm việc" },
  { korean: "자다", romanization: "jada", brief: "ngủ" },
  { korean: "앉다", romanization: "anda", brief: "ngồi" },
  { korean: "서다", romanization: "seoda", brief: "đứng" },
  { korean: "걷다", romanization: "geotda", brief: "đi bộ" },
  { korean: "뛰다", romanization: "ttwida", brief: "chạy" },
  { korean: "좋아하다", romanization: "joahada", brief: "thích" },
  { korean: "싫어하다", romanization: "sireohada", brief: "ghét" },
  { korean: "알다", romanization: "alda", brief: "biết" },
  { korean: "모르다", romanization: "moreuda", brief: "không biết" },
  { korean: "원하다", romanization: "wonhada", brief: "muốn" },
  { korean: "만나다", romanization: "mannada", brief: "gặp gỡ" },
  { korean: "주다", romanization: "juda", brief: "cho, tặng" },
  { korean: "받다", romanization: "batda", brief: "nhận" },
  { korean: "사랑하다", romanization: "saranghada", brief: "yêu" },
  { korean: "시작하다", romanization: "sijakhada", brief: "bắt đầu" },
  { korean: "찾다", romanization: "chatda", brief: "tìm" },
  { korean: "크다", romanization: "keuda", brief: "to, lớn" },
  { korean: "작다", romanization: "jakda", brief: "nhỏ" },
  { korean: "많다", romanization: "manta", brief: "nhiều" },
  { korean: "적다", romanization: "jeokda", brief: "ít" },
  { korean: "좋다", romanization: "jota", brief: "tốt, hay" },
  { korean: "나쁘다", romanization: "nappeuda", brief: "xấu, tệ" },
  { korean: "빠르다", romanization: "ppareuda", brief: "nhanh" },
  { korean: "예쁘다", romanization: "yeppeuda", brief: "đẹp" },
  { korean: "힘들다", romanization: "himdeulda", brief: "khó khăn, vất vả" },
  { korean: "쉽다", romanization: "swipda", brief: "dễ" },
  { korean: "어렵다", romanization: "eoryeopda", brief: "khó" },
  { korean: "재미있다", romanization: "jaemiitda", brief: "thú vị, vui" },
  { korean: "바쁘다", romanization: "bappeuda", brief: "bận rộn" },
  { korean: "피곤하다", romanization: "pigonhada", brief: "mệt mỏi" },
  { korean: "행복하다", romanization: "haengbokhada", brief: "hạnh phúc" },
  { korean: "슬프다", romanization: "seulpeuda", brief: "buồn" },
  { korean: "아프다", romanization: "apeuda", brief: "đau" },
  { korean: "이름", romanization: "ireum", brief: "tên" },
  { korean: "나이", romanization: "nai", brief: "tuổi" },
  { korean: "한국어", romanization: "hangugeo", brief: "tiếng Hàn" },
  { korean: "영어", romanization: "yeongeo", brief: "tiếng Anh" },
  { korean: "책", romanization: "chaek", brief: "sách" },
  { korean: "영화", romanization: "yeonghwa", brief: "phim" },
  { korean: "음악", romanization: "eumak", brief: "âm nhạc" },
  { korean: "노래", romanization: "norae", brief: "bài hát" },
  { korean: "날씨", romanization: "nalssi", brief: "thời tiết" },
  { korean: "비", romanization: "bi", brief: "mưa" },
  { korean: "눈", romanization: "nun", brief: "tuyết; mắt" },
  { korean: "하늘", romanization: "haneul", brief: "bầu trời" },
  { korean: "바다", romanization: "bada", brief: "biển" },
  { korean: "산", romanization: "san", brief: "núi" },
  { korean: "꽃", romanization: "kkot", brief: "hoa" },
  { korean: "나무", romanization: "namu", brief: "cây" },
  { korean: "머리", romanization: "meori", brief: "đầu, tóc" },
  { korean: "얼굴", romanization: "eolgul", brief: "khuôn mặt" },
  { korean: "손", romanization: "son", brief: "bàn tay" },
  { korean: "발", romanization: "bal", brief: "bàn chân" },
  { korean: "매우", romanization: "maeu", brief: "rất" },
  { korean: "너무", romanization: "neomu", brief: "quá, rất" },
  { korean: "조금", romanization: "jogeum", brief: "một chút" },
  { korean: "많이", romanization: "mani", brief: "nhiều" },
  { korean: "빨리", romanization: "ppalli", brief: "nhanh lên" },
  { korean: "항상", romanization: "hangsang", brief: "luôn luôn" },
  { korean: "자주", romanization: "jaju", brief: "thường xuyên" },
  { korean: "그리고", romanization: "geurigo", brief: "và, sau đó" },
  { korean: "하지만", romanization: "hajiman", brief: "nhưng" },
  { korean: "그래서", romanization: "geuraeseo", brief: "vì vậy" },
  { korean: "왜", romanization: "wae", brief: "tại sao" },
  { korean: "어디", romanization: "eodi", brief: "ở đâu" },
  { korean: "언제", romanization: "eonje", brief: "khi nào" },
  { korean: "어떻게", romanization: "eotteoke", brief: "như thế nào" },
  { korean: "무엇", romanization: "mueot", brief: "cái gì" },
  { korean: "누구", romanization: "nugu", brief: "ai" },
  { korean: "숙제", romanization: "sukje", brief: "bài tập về nhà" },
  { korean: "시험", romanization: "siheom", brief: "kỳ thi" },
  { korean: "전화", romanization: "jeonhwa", brief: "điện thoại" },
  { korean: "컴퓨터", romanization: "keompyuteo", brief: "máy tính" },
  { korean: "색", romanization: "saek", brief: "màu sắc" },
  { korean: "빨간색", romanization: "ppalgansaek", brief: "màu đỏ" },
  { korean: "파란색", romanization: "paransaek", brief: "màu xanh dương" },
  { korean: "초록색", romanization: "choroksaek", brief: "màu xanh lá" },
  { korean: "노란색", romanization: "noransaek", brief: "màu vàng" },
  { korean: "흰색", romanization: "huinsaek", brief: "màu trắng" },
  { korean: "검은색", romanization: "geomeunsaek", brief: "màu đen" },
];

function searchLocalWords(query: string, limit = 8): KoreanWord[] {
  const q = query.trim();
  if (!q) return [];
  const starts: KoreanWord[] = [];
  const contains: KoreanWord[] = [];
  for (const w of KOREAN_WORDLIST) {
    if (w.korean.startsWith(q)) starts.push(w);
    else if (w.korean.includes(q) || w.romanization.toLowerCase().includes(q.toLowerCase())) contains.push(w);
    if (starts.length >= limit) break;
  }
  return [...starts, ...contains].slice(0, limit);
}

// Dict detail cache in localStorage (permanent)
function getDictCache(korean: string): DictDetail | null {
  try {
    const raw = localStorage.getItem(DICT_CACHE_KEY);
    const cache = raw ? JSON.parse(raw) : {};
    return cache[korean] || null;
  } catch { return null; }
}

function setDictCache(korean: string, detail: DictDetail) {
  try {
    const raw = localStorage.getItem(DICT_CACHE_KEY);
    const cache = raw ? JSON.parse(raw) : {};
    cache[korean] = detail;
    localStorage.setItem(DICT_CACHE_KEY, JSON.stringify(cache));
  } catch { /* ignore storage full */ }
}

// Translate korean→vietnamese via MyMemory API (free, no key)
async function translateKoVi(text: string): Promise<string> {
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=ko|vi`;
    const res = await fetch(url);
    const j = await res.json();
    return (j.responseData?.translatedText || '').trim();
  } catch { return ''; }
}

// Full word detail lookup: localStorage cache → MyMemory → Gemini
async function lookupWordDetail(word: string): Promise<DictDetail | null> {
  // 1. localStorage cache
  const cached = getDictCache(word);
  if (cached) return cached;

  // 2. Check bundled wordlist for basic info
  const bundled = KOREAN_WORDLIST.find(w => w.korean === word);

  // 3. Try MyMemory translation (always works, free, no key)
  const vietnameseMeaning = await translateKoVi(word);

  if (vietnameseMeaning) {
    // Try Gemini for richer data in background, return MyMemory immediately
    const detail: DictDetail = {
      korean: word,
      romanization: bundled?.romanization || word,
      wordType: 'từ',
      meanings: [{ vietnamese: vietnameseMeaning, examples: [] }],
      level: 'sơ cấp',
      note: '',
      source: '🌐 MyMemory'
    };
    setDictCache(word, detail);

    // Fire-and-forget Gemini for richer detail in background
    fetchGeminiDetail(word).then(rich => {
      if (rich) setDictCache(word, rich);
    }).catch(() => { });

    return detail;
  }

  // 4. Gemini as last resort
  return fetchGeminiDetail(word);
}

async function fetchGeminiDetail(word: string): Promise<DictDetail | null> {
  try {
    const prompt = `Korean-Vietnamese dictionary. Word: "${word}"
Return ONLY valid JSON (no markdown):
{"korean":"${word}","romanization":"phiên âm","wordType":"loại từ tiếng Việt","meanings":[{"vietnamese":"nghĩa","examples":[{"korean":"câu ví dụ","vietnamese":"dịch"}]}],"level":"sơ cấp","note":""}`;
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json' }
        })
      }
    );
    const json = await res.json();
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonText = match ? match[1].trim() : text.trim();
    const detail: DictDetail = { ...JSON.parse(jsonText), source: '🤖 Gemini AI' };
    setDictCache(word, detail);
    return detail;
  } catch { return null; }
}

// ─── SM-2 Enhanced Algorithm (4-button: Again/Hard/Good/Easy) ───────────────────

function sm2(word: Word, quality: number): Word {
  let { interval, repetition, easiness } = word;

  if (quality <= 1) {
    // Again: reset
    repetition = 0;
    interval = 1;
  } else if (quality === 2) {
    // Hard: shorten, keep repetition
    interval = Math.max(1, Math.round(interval * 0.5));
  } else if (quality === 4) {
    // Good: normal SM-2
    if (repetition === 0) interval = 1;
    else if (repetition === 1) interval = 6;
    else interval = Math.round(interval * easiness);
    repetition++;
  } else {
    // Easy (quality=5): bonus interval
    if (repetition === 0) interval = 4;
    else if (repetition === 1) interval = 10;
    else interval = Math.round(interval * easiness * 1.3);
    repetition++;
  }

  easiness = easiness + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  if (easiness < 1.3) easiness = 1.3;
  if (interval > 180) interval = 180;

  const nextReview = Date.now() + interval * 24 * 60 * 60 * 1000;
  return { ...word, interval, repetition, easiness, nextReview };
}

// Estimate next interval label based on quality
function estimateInterval(word: Word, quality: number): string {
  const simulated = sm2(word, quality);
  const days = Math.round((simulated.nextReview - Date.now()) / (24 * 60 * 60 * 1000));
  if (days <= 0) return '< 1 ngày';
  if (days === 1) return '1 ngày';
  if (days < 30) return `${days} ngày`;
  return `${Math.round(days / 30)} tháng`;
}

// ─── TTS Helper ─────────────────────────────────────────────────────────────────

function speakKorean(text: string) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'ko-KR';
  utter.rate = 0.85;
  utter.pitch = 1;
  // Prefer a Korean voice if available
  const voices = window.speechSynthesis.getVoices();
  const koVoice = voices.find(v => v.lang.startsWith('ko'));
  if (koVoice) utter.voice = koVoice;
  window.speechSynthesis.speak(utter);
}

// ─── Dictionary View ─────────────────────────────────────────────────────────────

function DictionaryView({ onAddWord }: { onAddWord: (k: string, v: string, ex?: { korean: string; vietnamese: string }[]) => void }) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<DictSuggestion[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedWord, setSelectedWord] = useState<DictDetail | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [expandedMeaning, setExpandedMeaning] = useState<number | null>(0);
  const [addedToast, setAddedToast] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const fetchSuggestions = useCallback(async (q: string) => {
    if (!q.trim()) { setSuggestions([]); return; }
    setIsSearching(true);
    try {
      // Search bundled word list (offline, instant)
      const localResults = searchLocalWords(q, 8);

      // Also check localStorage dict cache for previously looked up words
      const cacheRaw = localStorage.getItem(DICT_CACHE_KEY);
      const cache: Record<string, DictDetail> = cacheRaw ? JSON.parse(cacheRaw) : {};
      const cacheResults = Object.keys(cache)
        .filter(k => k.startsWith(q) || k.includes(q))
        .slice(0, 8)
        .map(k => ({ korean: k, romanization: cache[k].romanization || '', brief: cache[k].meanings?.[0]?.vietnamese?.substring(0, 30) || '' }));

      const seen = new Set<string>();
      const merged: DictSuggestion[] = [];
      for (const item of [...localResults, ...cacheResults]) {
        if (!seen.has(item.korean)) { seen.add(item.korean); merged.push(item); }
        if (merged.length >= 8) break;
      }
      setSuggestions(merged);
      setShowSuggestions(merged.length > 0);
    } catch { setSuggestions([]); }
    finally { setIsSearching(false); }
  }, []);

  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (val.length === 0) { setSuggestions([]); setShowSuggestions(false); return; }
    debounceRef.current = setTimeout(() => fetchSuggestions(val), 1200);
  };

  const fetchDetail = async (korean: string) => {
    setShowSuggestions(false);
    setSelectedWord(null);
    setExpandedMeaning(0);
    setIsLoadingDetail(true);
    setNotFound(false);
    setQuery(korean);
    try {
      const detail = await lookupWordDetail(korean);
      if (!detail) { setNotFound(true); return; }
      setSelectedWord(detail);
    } catch { setNotFound(true); }
    finally { setIsLoadingDetail(false); }
  };

  const handleSpeak = (text: string) => {
    setIsSpeaking(true);
    speakKorean(text);
    setTimeout(() => setIsSpeaking(false), 2000);
  };

  const handleAddToFlashcard = () => {
    if (!selectedWord || !selectedWord.meanings?.[0]) return;
    const examples = selectedWord.meanings[0].examples || [];
    onAddWord(selectedWord.korean, selectedWord.meanings[0].vietnamese, examples);
    setAddedToast(true);
    setTimeout(() => setAddedToast(false), 2500);
  };

  const levelColor = (level: string) => {
    if (level?.includes('sơ')) return 'bg-emerald-100 text-emerald-700';
    if (level?.includes('trung')) return 'bg-amber-100 text-amber-700';
    return 'bg-rose-100 text-rose-700';
  };

  return (
    <motion.div
      key="dictionary"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="space-y-4"
    >
      <h2 className="text-2xl font-bold">Từ điển Hàn–Việt</h2>

      {/* Search input */}
      <div className="relative">
        <div className="flex items-center gap-2 bg-white border border-black/10 rounded-2xl px-4 py-3 shadow-sm focus-within:ring-2 focus-within:ring-emerald-500 transition-all">
          <Search size={18} className="text-gray-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={handleQueryChange}
            onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
            placeholder="Nhập từ tiếng Hàn... (한국어)"
            className="flex-1 outline-none text-base bg-transparent"
          />
          {isSearching && <Loader2 size={16} className="text-emerald-500 animate-spin shrink-0" />}
          {query && !isSearching && (
            <button onClick={() => { setQuery(''); setSuggestions([]); setSelectedWord(null); setShowSuggestions(false); }}>
              <X size={16} className="text-gray-400" />
            </button>
          )}
        </div>

        {/* Suggestions dropdown */}
        <AnimatePresence>
          {showSuggestions && suggestions.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="absolute z-30 left-0 right-0 mt-2 bg-white rounded-2xl shadow-xl border border-black/5 overflow-hidden"
            >
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  onClick={() => fetchDetail(s.korean)}
                  className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 active:bg-gray-100 transition-colors border-b border-black/5 last:border-0"
                >
                  <div className="text-left">
                    <p className="font-bold text-base">{s.korean}</p>
                    <p className="text-xs text-gray-400">{s.romanization}</p>
                  </div>
                  <span className="text-sm text-gray-500 text-right max-w-[45%] truncate">{s.brief}</span>
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Loading detail state */}
      {isLoadingDetail && (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <Loader2 size={36} className="text-emerald-500 animate-spin" />
          <p className="text-gray-500 font-medium">Đang tra từ...</p>
        </div>
      )}

      {/* Not found */}
      {notFound && !isLoadingDetail && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-rose-50 border border-rose-100 rounded-2xl px-5 py-4 text-center"
        >
          <p className="text-rose-600 font-bold">Không tìm thấy từ này</p>
          <p className="text-sm text-rose-400 mt-1">Thử kiểm tra chính tả hoặc tìm từ khác</p>
        </motion.div>
      )}

      {/* Word Detail Card */}
      <AnimatePresence>
        {selectedWord && !isLoadingDetail && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="bg-white rounded-3xl border border-black/5 shadow-md overflow-hidden"
          >
            {/* Header */}
            <div className="bg-gradient-to-br from-emerald-500 to-emerald-600 px-6 pt-6 pb-8 text-white relative">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <h3 className="text-4xl font-bold tracking-wider">{selectedWord.korean}</h3>
                    <button
                      onClick={() => handleSpeak(selectedWord.korean)}
                      className={`p-2 rounded-full transition-all ${isSpeaking ? 'bg-white/40 scale-110' : 'bg-white/20 hover:bg-white/30'}`}
                    >
                      <Volume2 size={18} className={isSpeaking ? 'animate-pulse' : ''} />
                    </button>
                  </div>
                  <p className="text-white/80 text-sm font-medium">{selectedWord.romanization}</p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  {selectedWord.level && (
                    <span className="text-xs font-bold px-2 py-1 rounded-full"
                      style={{ background: 'rgba(255,255,255,0.22)', color: 'white' }}>
                      {selectedWord.level}
                    </span>
                  )}
                  {selectedWord.source && (
                    <span className="text-[10px] font-bold px-2 py-1 rounded-full"
                      style={{ background: 'rgba(0,0,0,0.15)', color: 'rgba(255,255,255,0.8)' }}>
                      {selectedWord.source === 'Gemini' ? '🤖 AI' :
                        selectedWord.source?.includes('KRDict') ? '🇰🇷 KRDict' :
                          selectedWord.source?.includes('MyMemory') ? '🌐 Free' : '📦 Cache'}
                    </span>
                  )}
                </div>
              </div>
              {selectedWord.wordType && (
                <span className="inline-block mt-3 bg-white/20 text-white/90 text-xs font-semibold px-3 py-1 rounded-full">
                  {selectedWord.wordType}
                </span>
              )}
            </div>

            {/* Meanings */}
            <div className="px-5 py-4 space-y-2">
              <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Nghĩa</h4>
              {selectedWord.meanings?.map((m, mi) => (
                <div key={mi} className="border border-black/5 rounded-2xl overflow-hidden">
                  <button
                    onClick={() => setExpandedMeaning(expandedMeaning === mi ? null : mi)}
                    className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-emerald-500 text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                        {mi + 1}
                      </span>
                      <span className="font-semibold text-base text-left">{m.vietnamese}</span>
                    </div>
                    {expandedMeaning === mi ? <ChevronUp size={16} className="text-gray-400 shrink-0" /> : <ChevronDown size={16} className="text-gray-400 shrink-0" />}
                  </button>

                  <AnimatePresence>
                    {expandedMeaning === mi && m.examples?.length > 0 && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="px-4 py-3 space-y-3 bg-white">
                          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Ví dụ</p>
                          {m.examples.map((ex, ei) => (
                            <div key={ei} className="bg-gray-50 rounded-xl px-3 py-3">
                              <div className="flex items-start justify-between gap-2">
                                <p className="font-semibold text-sm text-gray-800 leading-relaxed">{ex.korean}</p>
                                <button
                                  onClick={() => handleSpeak(ex.korean)}
                                  className="p-1 rounded-full hover:bg-emerald-50 text-emerald-500 transition-colors shrink-0 mt-0.5"
                                >
                                  <Volume2 size={13} />
                                </button>
                              </div>
                              <p className="text-xs text-gray-500 mt-1 leading-relaxed">{ex.vietnamese}</p>
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ))}

              {/* Note */}
              {selectedWord.note && (
                <div className="bg-amber-50 border border-amber-100 rounded-2xl px-4 py-3 mt-2">
                  <p className="text-xs font-bold text-amber-600 uppercase tracking-wider mb-1">Ghi chú</p>
                  <p className="text-sm text-amber-800">{selectedWord.note}</p>
                </div>
              )}
            </div>

            {/* Add to flashcard button */}
            <div className="px-5 pb-5">
              <button
                onClick={handleAddToFlashcard}
                className="w-full py-4 bg-emerald-500 text-white rounded-2xl font-bold flex items-center justify-center gap-2 shadow-lg shadow-emerald-200 active:scale-95 transition-all hover:bg-emerald-600"
              >
                <PlusCircle size={20} />
                Thêm vào Flashcard
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Empty state */}
      {!isLoadingDetail && !selectedWord && !showSuggestions && (
        <div className="text-center py-16">
          <div className="bg-gray-100 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4">
            <BookMarked size={36} className="text-gray-400" />
          </div>
          <h3 className="font-bold text-gray-700 text-lg">Tra từ tiếng Hàn</h3>
          <p className="text-gray-400 text-sm mt-2 px-8">Nhập từ bất kỳ để xem nghĩa, phát âm và câu ví dụ</p>
        </div>
      )}

      {/* Toast */}
      <AnimatePresence>
        {addedToast && (
          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 40, scale: 0.9 }}
            className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-sm font-semibold px-5 py-3 rounded-2xl shadow-xl z-50 flex items-center gap-2"
          >
            <CheckCircle2 size={16} className="text-emerald-400" />
            Đã thêm vào flashcard!
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Main App ───────────────────────────────────────────────────────────────────

export default function App() {
  const [view, setView] = useState<'dashboard' | 'add' | 'review' | 'list' | 'dictionary'>('dashboard');
  const [words, setWords] = useState<Word[]>([]);
  const [dueWords, setDueWords] = useState<Word[]>([]);
  const [currentReviewIndex, setCurrentReviewIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [newKorean, setNewKorean] = useState('');
  const [newVietnamese, setNewVietnamese] = useState('');
  const [newExamples, setNewExamples] = useState<{ korean: string; vietnamese: string }[]>([]);
  const [isFrontKorean, setIsFrontKorean] = useState(true);
  const [gameData, setGameData] = useState<GameData>(() => loadGameData());
  const [showLevelUp, setShowLevelUp] = useState(false);
  const [levelUpNum, setLevelUpNum] = useState(1);

  const refreshData = () => {
    const all = loadWords().sort((a, b) => b.createdAt - a.createdAt);
    const now = Date.now();
    const due = all.filter(w => w.nextReview <= now).sort(() => Math.random() - 0.5);
    setWords(all);
    setDueWords(due);
  };

  useEffect(() => {
    refreshData();
    requestNotificationPermission();
  }, []);

  const handleAddWord = (e: React.FormEvent | null, korean?: string, vietnamese?: string, examples?: { korean: string; vietnamese: string }[]) => {
    if (e) e.preventDefault();
    const k = korean ?? newKorean;
    const v = vietnamese ?? newVietnamese;
    if (!k || !v) return;
    const all = loadWords();
    const exs = examples ?? newExamples;
    const newWord: Word = {
      id: Date.now(),
      korean: k.trim(),
      vietnamese: v.trim(),
      interval: 0,
      repetition: 0,
      easiness: 2.5,
      nextReview: Date.now(),
      createdAt: Date.now(),
      examples: exs.length > 0 ? exs : undefined,
    };
    saveWords([...all, newWord]);
    setNewKorean('');
    setNewVietnamese('');
    setNewExamples([]);
    refreshData();
    if (!korean) setView('dashboard');
  };

  // Called from DictionaryView
  const handleAddFromDictionary = (k: string, v: string, ex?: { korean: string; vietnamese: string }[]) => {
    handleAddWord(null, k, v, ex);
  };

  const handleReview = (quality: number) => {
    const word = dueWords[currentReviewIndex];
    const updated = sm2(word, quality);
    const all = loadWords();
    const newAll = all.map(w => w.id === updated.id ? updated : w);
    saveWords(newAll);

    // Update gamification
    const { newData, leveledUp } = updateGameDataAfterReview(quality);
    setGameData(newData);
    if (leveledUp) {
      setLevelUpNum(newData.level);
      setShowLevelUp(true);
      setTimeout(() => setShowLevelUp(false), 3000);
    }

    setIsFlipped(false);
    setTimeout(() => {
      if (currentReviewIndex < dueWords.length - 1) {
        setCurrentReviewIndex(prev => prev + 1);
        setIsFrontKorean(Math.random() > 0.5);
      } else {
        refreshData();
        setCurrentReviewIndex(0);
        setView('dashboard');
      }
    }, 200);
  };

  const deleteWord = (id: number) => {
    const all = loadWords();
    saveWords(all.filter(w => w.id !== id));
    refreshData();
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

          {/* ── Dashboard ─────────────────────────────── */}
          {view === 'dashboard' && (
            <motion.div
              key="dashboard"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-6"
            >
              {/* Gamification Card */}
              {(() => {
                const xpInLevel = gameData.xp - (gameData.level - 1) * 200;
                const xpNeeded = 200;
                const pct = Math.min(100, Math.round((xpInLevel / xpNeeded) * 100));
                return (
                  <div className="bg-gradient-to-br from-violet-500 to-indigo-600 rounded-3xl p-5 text-white shadow-lg shadow-indigo-200">
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex items-center gap-2">
                        <span className="text-2xl">🔥</span>
                        <div>
                          <p className="text-xs text-white/70 font-medium">Streak</p>
                          <p className="font-bold text-lg leading-none">{gameData.streak} ngày</p>
                        </div>
                      </div>
                      <div className="bg-white/20 rounded-2xl px-3 py-2 text-center">
                        <p className="text-[10px] text-white/70 font-bold uppercase">Cấp độ</p>
                        <p className="text-xl font-black">{gameData.level}</p>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px] text-white/70 font-medium">
                        <span>{gameData.xp} XP</span>
                        <span>{xpForNextLevel(gameData.level)} XP</span>
                      </div>
                      <div className="w-full bg-white/20 rounded-full h-2.5">
                        <div
                          className="bg-white rounded-full h-2.5 transition-all duration-700"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <p className="text-[11px] text-white/60">{gameData.totalReviewed} từ đã ôn · {pct}% đến cấp {gameData.level + 1}</p>
                    </div>
                  </div>
                );
              })()}

              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={() => setView('review')}
                  disabled={dueWords.length === 0}
                  className={`p-6 rounded-3xl flex flex-col items-center justify-center gap-3 transition-all ${dueWords.length > 0
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

          {/* ── Add Word ──────────────────────────────── */}
          {view === 'add' && (
            <motion.div
              key="add"
              initial={{ opacity: 0, x: 50 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -50 }}
            >
              <h2 className="text-2xl font-bold mb-6">Thêm từ mới</h2>
              <form onSubmit={(e) => handleAddWord(e)} className="space-y-4">
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

                {/* Example Sentences */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-bold text-gray-400 uppercase">Câu ví dụ</label>
                    <button
                      type="button"
                      onClick={() => setNewExamples(ex => [...ex, { korean: '', vietnamese: '' }])}
                      className="flex items-center gap-1 text-xs text-emerald-600 font-bold px-2 py-1 bg-emerald-50 rounded-lg hover:bg-emerald-100 transition-colors"
                    >
                      <Plus size={12} /> Thêm câu ví dụ
                    </button>
                  </div>
                  {newExamples.map((ex, i) => (
                    <div key={i} className="bg-gray-50 rounded-2xl p-3 mb-2 space-y-2">
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={ex.korean}
                          onChange={e => {
                            const updated = [...newExamples];
                            updated[i] = { ...updated[i], korean: e.target.value };
                            setNewExamples(updated);
                          }}
                          placeholder="Câu tiếng Hàn"
                          className="flex-1 p-2 text-sm bg-white border border-black/10 rounded-xl outline-none focus:ring-1 focus:ring-emerald-500"
                        />
                        <button type="button" onClick={() => setNewExamples(ex => ex.filter((_, j) => j !== i))} className="text-rose-400 p-1">
                          <X size={14} />
                        </button>
                      </div>
                      <input
                        type="text"
                        value={ex.vietnamese}
                        onChange={e => {
                          const updated = [...newExamples];
                          updated[i] = { ...updated[i], vietnamese: e.target.value };
                          setNewExamples(updated);
                        }}
                        placeholder="Nghĩa tiếng Việt"
                        className="w-full p-2 text-sm bg-white border border-black/10 rounded-xl outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                    </div>
                  ))}
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => { setView('dashboard'); setNewExamples([]); }}
                    className="flex-1 p-4 bg-gray-100 rounded-2xl font-bold active:scale-95 transition-all"
                  >
                    Hủy
                  </button>
                  <button
                    type="submit"
                    className="flex-1 p-4 bg-emerald-500 text-white rounded-2xl font-bold shadow-lg shadow-emerald-200 active:scale-95 transition-all"
                  >
                    Lưu từ vựng
                  </button>
                </div>
              </form>
            </motion.div>
          )}

          {/* ── Review ────────────────────────────────── */}
          {view === 'review' && dueWords.length > 0 && (
            <motion.div
              key="review"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="space-y-6"
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
                className="relative h-72 w-full perspective-1000 cursor-pointer"
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
                    {isFrontKorean && (
                      <button
                        onClick={(e) => { e.stopPropagation(); speakKorean(dueWords[currentReviewIndex].korean); }}
                        className="mt-6 p-2 bg-emerald-50 rounded-full text-emerald-500"
                      >
                        <Volume2 size={20} />
                      </button>
                    )}
                    <p className="mt-6 text-gray-400 text-sm animate-bounce">Chạm để xem nghĩa</p>
                  </div>

                  {/* Back */}
                  <div
                    className="absolute inset-0 backface-hidden bg-emerald-500 text-white rounded-[40px] shadow-xl flex flex-col items-center justify-center p-8 text-center gap-3"
                    style={{ transform: 'rotateY(180deg)' }}
                  >
                    <span className="text-xs font-bold text-white/60 uppercase tracking-widest">
                      {isFrontKorean ? 'Tiếng Việt' : 'Tiếng Hàn'}
                    </span>
                    <h3 className="text-3xl font-bold">
                      {isFrontKorean ? dueWords[currentReviewIndex].vietnamese : dueWords[currentReviewIndex].korean}
                    </h3>
                    {/* Example sentence on back */}
                    {dueWords[currentReviewIndex].examples?.[0] && (
                      <div className="mt-2 bg-white/15 rounded-2xl px-4 py-3 text-left w-full">
                        <p className="text-xs text-white/60 font-bold mb-1">VÍ DỤ</p>
                        <p className="text-sm font-semibold">{dueWords[currentReviewIndex].examples![0].korean}</p>
                        <p className="text-xs text-white/75 mt-0.5">{dueWords[currentReviewIndex].examples![0].vietnamese}</p>
                      </div>
                    )}
                  </div>
                </motion.div>
              </div>

              {isFlipped && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="grid grid-cols-4 gap-2"
                >
                  {[
                    { q: 1, label: 'Lại', emoji: '🔴', bg: 'bg-rose-50', text: 'text-rose-600', border: 'border-rose-100' },
                    { q: 2, label: 'Khó', emoji: '🟠', bg: 'bg-orange-50', text: 'text-orange-600', border: 'border-orange-100' },
                    { q: 4, label: 'Ổn', emoji: '🟢', bg: 'bg-emerald-50', text: 'text-emerald-600', border: 'border-emerald-100' },
                    { q: 5, label: 'Dễ', emoji: '🔵', bg: 'bg-blue-50', text: 'text-blue-600', border: 'border-blue-100' },
                  ].map(({ q, label, emoji, bg, text, border }) => (
                    <button
                      key={q}
                      onClick={(e) => { e.stopPropagation(); handleReview(q); }}
                      className={`py-4 px-1 ${bg} ${text} rounded-2xl font-bold flex flex-col items-center gap-1 border ${border} active:scale-95 transition-all`}
                    >
                      <span className="text-lg">{emoji}</span>
                      <span className="text-sm font-bold">{label}</span>
                      <span className="text-[10px] opacity-60">{estimateInterval(dueWords[currentReviewIndex], q)}</span>
                    </button>
                  ))}
                </motion.div>
              )}
            </motion.div>
          )}

          {/* ── Word List ─────────────────────────────── */}
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
                  <div key={word.id} className="bg-white p-4 rounded-2xl border border-black/5 shadow-sm">
                    <div className="flex justify-between items-center">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-bold text-lg">{word.korean}</p>
                          <button onClick={() => speakKorean(word.korean)} className="text-emerald-400 p-1 hover:bg-emerald-50 rounded-full transition-colors">
                            <Volume2 size={14} />
                          </button>
                          {word.examples && word.examples.length > 0 && (
                            <span className="text-[10px] font-bold bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded-full">
                              {word.examples.length} ví dụ
                            </span>
                          )}
                        </div>
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
                    {/* Example sentences preview */}
                    {word.examples && word.examples.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-black/5 space-y-2">
                        {word.examples.slice(0, 2).map((ex, i) => (
                          <div key={i} className="bg-gray-50 rounded-xl px-3 py-2">
                            <p className="text-xs font-semibold text-gray-700">{ex.korean}</p>
                            <p className="text-[11px] text-gray-400 mt-0.5">{ex.vietnamese}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {words.length === 0 && (
                  <p className="text-center text-gray-400 py-10">Chưa có từ nào trong danh sách.</p>
                )}
              </div>
            </motion.div>
          )}

          {/* ── Dictionary ────────────────────────────── */}
          {view === 'dictionary' && (
            <DictionaryView onAddWord={handleAddFromDictionary} />
          )}

        </AnimatePresence>
      </main>

      {/* Navigation Bar */}
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
          onClick={() => setView('dictionary')}
          className={`p-2 rounded-xl transition-all relative ${view === 'dictionary' ? 'text-emerald-500 bg-emerald-50' : 'text-gray-400'}`}
        >
          <Search size={24} />
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

      {/* Level-Up Celebration Modal */}
      <AnimatePresence>
        {showLevelUp && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="fixed inset-0 flex items-center justify-center z-50 pointer-events-none"
          >
            <div className="bg-gradient-to-br from-violet-500 to-indigo-600 text-white rounded-3xl p-8 text-center shadow-2xl mx-8">
              <p className="text-5xl mb-3">🎉</p>
              <h2 className="text-2xl font-black mb-1">Lên cấp!</h2>
              <p className="text-white/80 text-lg font-bold">✨ Cấp độ {levelUpNum} ✨</p>
              <p className="text-white/60 text-sm mt-2">Tiếp tục cố lên nhé!</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
