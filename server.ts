import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
dotenv.config();

// ── Gemini (chỉ fallback cuối cùng) ──────────────────────────────────────────
const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

// ── SQLite DB ─────────────────────────────────────────────────────────────────
const db = new Database("korean_srs.db");

// Initialize database tables
db.exec(`
  CREATE TABLE IF NOT EXISTS words (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    korean TEXT NOT NULL,
    vietnamese TEXT NOT NULL,
    interval INTEGER DEFAULT 0,
    repetition INTEGER DEFAULT 0,
    easiness REAL DEFAULT 2.5,
    nextReview INTEGER DEFAULT 0,
    createdAt INTEGER DEFAULT (strftime('%s', 'now') * 1000)
  );

  CREATE TABLE IF NOT EXISTS dict_cache (
    korean TEXT PRIMARY KEY,
    data   TEXT NOT NULL,
    source TEXT DEFAULT 'unknown',
    createdAt INTEGER DEFAULT (strftime('%s', 'now') * 1000)
  );

  CREATE TABLE IF NOT EXISTS search_cache (
    query  TEXT PRIMARY KEY,
    data   TEXT NOT NULL,
    createdAt INTEGER DEFAULT (strftime('%s', 'now') * 1000)
  );
`);

// ── Permanent SQLite cache helpers ───────────────────────────────────────────
function getCachedDetail(korean: string): object | null {
  const row = db.prepare("SELECT data FROM dict_cache WHERE korean = ?").get(korean) as any;
  return row ? JSON.parse(row.data) : null;
}

function setCachedDetail(korean: string, data: object, source: string) {
  db.prepare("INSERT OR REPLACE INTO dict_cache (korean, data, source) VALUES (?, ?, ?)")
    .run(korean, JSON.stringify(data), source);
}

function getCachedSearch(query: string): object[] | null {
  const row = db.prepare("SELECT data FROM search_cache WHERE query = ?").get(query) as any;
  return row ? JSON.parse(row.data) : null;
}

function setCachedSearch(query: string, data: object[]) {
  db.prepare("INSERT OR REPLACE INTO search_cache (query, data) VALUES (?, ?)")
    .run(query, JSON.stringify(data));
}

// ── MyMemory: Korean → Vietnamese translation (free, no key) ──────────────────
async function translateKoreanToVietnamese(text: string): Promise<string> {
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=ko|vi&de=easyflashcard@app.local`;
    const res = await fetch(url);
    const json: any = await res.json();
    if (json.responseStatus === 200 && json.responseData?.translatedText) {
      return json.responseData.translatedText.trim();
    }
    return "";
  } catch {
    return "";
  }
}

// ── KRDict: Official Korean Gov Dictionary (50,000 req/day free) ──────────────
// API key is optional - without it KRDict still returns results but limited.
// The "한국어기초사전" (Learner's Korean Dict) can return results through the public endpoint.
// We use the OPEN endpoint that doesn't strictly require a key for basic searches:
async function searchKRDict(query: string): Promise<object[]> {
  try {
    const apiKey = process.env.KRDICT_API_KEY || "";
    if (!apiKey) return [];
    const url = `https://krdict.korean.go.kr/api/search?key=${apiKey}&q=${encodeURIComponent(query)}&translated=y&trans_lang=1&sort=popular&num=8&type1=word`;
    const res = await fetch(url);
    const text = await res.text();
    // KRDict returns XML - parse minimally
    const items: object[] = [];
    const wordMatches = text.matchAll(/<target_code>(\d+)<\/target_code>[\s\S]*?<word>([^<]+)<\/word>[\s\S]*?<sup_no>(\d*)<\/sup_no>/g);
    for (const m of wordMatches) {
      items.push({ code: m[1], korean: m[2], supNo: m[3] || "" });
      if (items.length >= 8) break;
    }
    return items;
  } catch {
    return [];
  }
}

// ── KRDict: Get word detail ───────────────────────────────────────────────────
async function getKRDictDetail(word: string): Promise<object | null> {
  try {
    const apiKey = process.env.KRDICT_API_KEY || "";
    if (!apiKey) return null;
    const url = `https://krdict.korean.go.kr/api/search?key=${apiKey}&q=${encodeURIComponent(word)}&translated=y&trans_lang=1&part=word&sort=popular&num=1&method=exact`;
    const res = await fetch(url);
    const text = await res.text();

    // Extract word info from XML
    const wordMatch = text.match(/<word>([^<]+)<\/word>/);
    const posMatch = text.match(/<pos>([^<]+)<\/pos>/);
    const defMatch = text.match(/<definition>([^<]+)<\/definition>/);
    const examplesAll = [...text.matchAll(/<example>([^<]+)<\/example>/g)].map(m => m[1]);
    const transMatch = text.match(/<trans_word>([^<]+)<\/trans_word>/);
    const transDefMatch = text.match(/<trans_dfn>([^<]+)<\/trans_dfn>/);

    if (!wordMatch) return null;

    const koreanDef = defMatch?.[1] || "";
    let vietnameseMeaning = (transMatch?.[1] || "").trim();
    // If KRDict has Vietnamese translation field, use it; otherwise translate definition
    if (!vietnameseMeaning || vietnameseMeaning === word) {
      vietnameseMeaning = await translateKoreanToVietnamese(koreanDef || word);
    }

    // Translate examples
    const translatedExamples: { korean: string; vietnamese: string }[] = [];
    for (const ex of examplesAll.slice(0, 3)) {
      const viEx = await translateKoreanToVietnamese(ex);
      translatedExamples.push({ korean: ex, vietnamese: viEx });
    }

    return {
      korean: wordMatch[1],
      romanization: await romanize(wordMatch[1]),
      wordType: posMatch?.[1] || "명사",
      meanings: [{ vietnamese: vietnameseMeaning, examples: translatedExamples }],
      level: "sơ cấp",
      note: "",
      source: "KRDict"
    };
  } catch {
    return null;
  }
}

// ── Simple Romanization table (for offline romanization) ─────────────────────
async function romanize(korean: string): Promise<string> {
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(korean)}&langpair=ko|en`;
    const res = await fetch(url);
    const json: any = await res.json();
    // MyMemory returns romanized/translated - just use translated English as hint
    return json.responseData?.translatedText || korean;
  } catch {
    return korean;
  }
}

// ── Gemini fallback: use only when no other source works ──────────────────────
async function geminiLookup(word: string): Promise<object | null> {
  try {
    const prompt = `You are a Korean-Vietnamese dictionary. Look up the Korean word: "${word}"
Return ONLY a JSON object, no markdown:
{
  "korean": "${word}",
  "romanization": "phiên âm",
  "wordType": "loại từ tiếng Việt",
  "meanings": [
    { "vietnamese": "nghĩa tiếng Việt", "examples": [
      { "korean": "câu ví dụ", "vietnamese": "nghĩa" }
    ]}
  ],
  "level": "sơ cấp/trung cấp/cao cấp",
  "note": ""
}`;
    const response = await genai.models.generateContent({
      model: "gemini-2.0-flash-lite",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { responseMimeType: "application/json" }
    });
    const raw = response.text || "{}";
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonText = jsonMatch ? jsonMatch[1].trim() : raw.trim();
    return JSON.parse(jsonText);
  } catch {
    return null;
  }
}

// ── Bundled Korean word list (imported inline for server use) ─────────────────
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
  { korean: "전화하다", romanization: "jeonhwahada", brief: "gọi điện" },
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

// ── Build suggestions: bundled list → SQLite cache → Gemini ──────────────────
async function buildSuggestions(query: string): Promise<object[]> {
  // 1. Check SQLite search cache first (permanent, previous Gemini results)
  const cached = getCachedSearch(query);
  if (cached && cached.length > 0) return cached;

  // 2. ALWAYS search the bundled word list (no API, instant, offline)
  const localResults = searchLocalWords(query, 8);

  // 3. Also check dict_cache (words that were previously looked up in detail)
  const dbRows = db.prepare(
    "SELECT korean, data FROM dict_cache WHERE korean LIKE ? LIMIT 8"
  ).all(`${query}%`) as any[];

  const dbResults = dbRows.map((r: any) => {
    const d = JSON.parse(r.data);
    return { korean: r.korean, romanization: d.romanization || "", brief: d.meanings?.[0]?.vietnamese?.substring(0, 30) || "" };
  });

  // Merge: bundled list + db cache, deduplicate by korean
  const seen = new Set<string>();
  const merged: object[] = [];
  for (const item of [...localResults, ...dbResults]) {
    const k = (item as any).korean;
    if (!seen.has(k)) { seen.add(k); merged.push(item); }
    if (merged.length >= 8) break;
  }

  if (merged.length > 0) {
    setCachedSearch(query, merged); // Cache so future calls are instant
    return merged;
  }

  // 4. Gemini as LAST resort (only for completely unknown words not in bundled list)
  try {
    const prompt = `Return a JSON array of up to 8 common Korean words starting with or containing "${query}".
Each: {"korean":"...","romanization":"...","brief":"nghĩa ngắn tiếng Việt"}
ONLY valid JSON array, no text before or after.`;
    const response = await genai.models.generateContent({
      model: "gemini-2.0-flash-lite",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { responseMimeType: "application/json" }
    });
    const raw = response.text || "[]";
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonText = jsonMatch ? jsonMatch[1].trim() : raw.trim();
    const geminiResults = JSON.parse(jsonText);
    const finalResults = Array.isArray(geminiResults) ? geminiResults.slice(0, 8) : [];
    if (finalResults.length > 0) setCachedSearch(query, finalResults);
    return finalResults;
  } catch {
    return [];
  }
}


// ── Main word detail lookup: Cache → KRDict → MyMemory+Gemini ────────────────
async function lookupWordDetail(word: string): Promise<object | null> {
  // 1. Check SQLite permanent cache first
  const cached = getCachedDetail(word);
  if (cached) {
    console.log(`[DB Cache HIT] ${word}`);
    return cached;
  }

  // 2. Try KRDict (official Korean gov API, 50K/day free)
  const krResult = await getKRDictDetail(word);
  if (krResult) {
    setCachedDetail(word, krResult, "KRDict+MyMemory");
    return krResult;
  }

  // 3. Build from MyMemory translation alone (always works, no key needed)
  try {
    const [meaning, romanization] = await Promise.all([
      translateKoreanToVietnamese(word),
      romanize(word)
    ]);

    if (meaning) {
      // Get example sentence via MyMemory translation of a simple sentence
      const exampleKorean = `${word}을/를 사용해서 문장을 만들어주세요.`;
      const result: object = {
        korean: word,
        romanization,
        wordType: "từ",
        meanings: [{
          vietnamese: meaning,
          examples: []
        }],
        level: "sơ cấp",
        note: "Dữ liệu từ MyMemory Translation",
        source: "MyMemory"
      };
      // Try to get richer data from Gemini in background (optional)
      geminiLookup(word).then(geminiData => {
        if (geminiData) {
          setCachedDetail(word, { ...geminiData, source: "Gemini" }, "Gemini");
        }
      }).catch(() => { });
      // Return MyMemory result immediately (fast)
      setCachedDetail(word, result, "MyMemory");
      return result;
    }
  } catch { }

  // 4. Gemini as last resort
  const geminiData = await geminiLookup(word);
  if (geminiData) {
    setCachedDetail(word, { ...geminiData, source: "Gemini" }, "Gemini");
    return geminiData;
  }

  return null;
}

// ── Express Server ────────────────────────────────────────────────────────────
async function startServer() {
  const app = express();
  app.use(express.json());

  // ── Words API ──────────────────────────────────────────────────────────────
  app.get("/api/words", (req, res) => {
    const words = db.prepare("SELECT * FROM words ORDER BY createdAt DESC").all();
    res.json(words);
  });

  app.get("/api/words/due", (req, res) => {
    const now = Date.now();
    const words = db.prepare("SELECT * FROM words WHERE nextReview <= ?").all(now);
    res.json(words);
  });

  app.post("/api/words", (req, res) => {
    const { korean, vietnamese } = req.body;
    const info = db.prepare("INSERT INTO words (korean, vietnamese, nextReview) VALUES (?, ?, ?)")
      .run(korean, vietnamese, Date.now());
    res.json({ id: info.lastInsertRowid });
  });

  app.post("/api/words/:id/review", (req, res) => {
    const { id } = req.params;
    const { quality } = req.body;
    const word = db.prepare("SELECT * FROM words WHERE id = ?").get(id) as any;
    if (!word) return res.status(404).json({ error: "Word not found" });

    let { interval, repetition, easiness } = word;
    if (quality >= 3) {
      if (repetition === 0) interval = 1;
      else if (repetition === 1) interval = 6;
      else interval = Math.round(interval * easiness);
      repetition++;
    } else {
      repetition = 0;
      interval = 1;
    }
    easiness = easiness + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    if (easiness < 1.3) easiness = 1.3;

    const nextReview = Date.now() + interval * 24 * 60 * 60 * 1000;
    db.prepare("UPDATE words SET interval = ?, repetition = ?, easiness = ?, nextReview = ? WHERE id = ?")
      .run(interval, repetition, easiness, nextReview, id);

    res.json({ success: true, nextReview });
  });

  app.delete("/api/words/:id", (req, res) => {
    db.prepare("DELETE FROM words WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  });

  // ── Dictionary API: Search suggestions ────────────────────────────────────
  app.get("/api/dictionary/search", async (req, res) => {
    const query = (req.query.q as string || "").trim();
    if (!query) return res.json([]);
    try {
      const results = await buildSuggestions(query);
      res.json(results);
    } catch (err: any) {
      console.error("Search error:", err?.message);
      res.json([]);
    }
  });

  // ── Dictionary API: Word detail ────────────────────────────────────────────
  app.get("/api/dictionary/detail", async (req, res) => {
    const word = (req.query.word as string || "").trim();
    if (!word) return res.status(400).json({ error: "Missing word" });
    try {
      const detail = await lookupWordDetail(word);
      if (!detail) return res.status(404).json({ error: "Word not found" });
      res.json(detail);
    } catch (err: any) {
      console.error("Detail error:", err?.message);
      res.status(500).json({ error: "lookup_failed" });
    }
  });

  // ── Vite middleware ────────────────────────────────────────────────────────
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(process.cwd(), "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(process.cwd(), "dist/index.html"));
    });
  }

  const PORT = 3000;
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Dictionary: SQLite cache → KRDict → MyMemory → Gemini`);
  });
}

startServer();
