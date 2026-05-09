import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { format, addDays } from 'date-fns'

interface ReviewCard {
  id: number
  card_type: string
  front: string
  back: string
  source_type: string
  source_id: number
  easiness_factor: number
  interval_days: number
  repetitions: number
  next_review: string | null
  last_reviewed: string | null
  test_mode: string
  current_stage: number
  phonetic: string | null
  emoji: string | null
  tags: string[] | null
  cefr_level: string | null
}

interface SourceVocab {
  definition?: string
  ipa?: string
  notes?: string
  example_sentences?: string
  emoji?: string
}

type Phase = 'start' | 'reviewing' | 'summary'

export default function Review() {
  const [phase, setPhase] = useState<Phase>('start')
  const [dueCount, setDueCount] = useState(0)
  const [limit, setLimit] = useState(20)
  const [cards, setCards] = useState<ReviewCard[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [correctCount, setCorrectCount] = useState(0)
  const [wrongCount, setWrongCount] = useState(0)
  const [wrongList, setWrongList] = useState<ReviewCard[]>([])
  const [loading, setLoading] = useState(true)
  const [notesExpanded, setNotesExpanded] = useState(false)

  // Cache for source vocab data
  const vocabCache = useRef<Record<number, SourceVocab>>({})
  const [currentVocab, setCurrentVocab] = useState<SourceVocab | null>(null)

  useEffect(() => {
    loadDueCount()
    // Preload voices
    speechSynthesis.getVoices()
  }, [])

  // Fetch source vocab when card changes
  useEffect(() => {
    if (!cards[currentIndex]) {
      setCurrentVocab(null)
      return
    }
    const card = cards[currentIndex]
    setNotesExpanded(false)
    if (card.source_type === 'french_vocab' && card.source_id) {
      fetchSourceVocab(card.source_id)
    } else {
      setCurrentVocab(null)
    }
  }, [currentIndex, cards])

  async function fetchSourceVocab(sourceId: number) {
    if (vocabCache.current[sourceId]) {
      setCurrentVocab(vocabCache.current[sourceId])
      return
    }
    const { data } = await supabase
      .from('french_vocab')
      .select('definition, ipa, notes, example_sentences, emoji')
      .eq('id', sourceId)
      .maybeSingle()
    if (data) {
      vocabCache.current[sourceId] = data
      setCurrentVocab(data)
    } else {
      setCurrentVocab(null)
    }
  }

  async function loadDueCount() {
    setLoading(true)
    const now = new Date().toISOString()
    const { count } = await supabase
      .from('review_cards')
      .select('*', { count: 'exact', head: true })
      .or(`next_review.is.null,next_review.lte.${now}`)
    setDueCount(count ?? 0)
    setLoading(false)
  }

  async function startSession() {
    const now = new Date().toISOString()
    const { data } = await supabase
      .from('review_cards')
      .select('*')
      .or(`next_review.is.null,next_review.lte.${now}`)
      .order('next_review', { ascending: true, nullsFirst: true })
      .limit(limit)

    if (data && data.length > 0) {
      vocabCache.current = {}
      setCards(data)
      setCurrentIndex(0)
      setRevealed(false)
      setCorrectCount(0)
      setWrongCount(0)
      setWrongList([])
      setNotesExpanded(false)
      setPhase('reviewing')
    }
  }

  const currentCard = cards[currentIndex] ?? null

  function getNextTestMode(mode: string): string {
    const rotation = ['fr_to_cn', 'cn_to_fr', 'listen']
    const idx = rotation.indexOf(mode)
    return rotation[(idx + 1) % rotation.length]
  }

  const advanceCard = useCallback(async (correct: boolean) => {
    if (!currentCard) return

    const ef = currentCard.easiness_factor
    let newEf: number
    let newInterval: number
    let newReps: number
    let newStage = currentCard.current_stage

    if (correct) {
      newEf = Math.min(2.5, ef + 0.1)
      newInterval = Math.max(1, Math.round(currentCard.interval_days * ef))
      newReps = currentCard.repetitions + 1
      if (newInterval > 21) newStage = 3
      else if (newInterval > 7) newStage = 2
    } else {
      newEf = Math.max(1.3, ef - 0.2)
      newInterval = 1
      newReps = 0
      newStage = 1
    }

    const now = new Date()
    const nextReview = addDays(now, newInterval)

    await supabase
      .from('review_cards')
      .update({
        easiness_factor: newEf,
        interval_days: newInterval,
        repetitions: newReps,
        next_review: nextReview.toISOString(),
        last_reviewed: now.toISOString(),
        test_mode: getNextTestMode(currentCard.test_mode),
        current_stage: newStage,
      })
      .eq('id', currentCard.id)

    if (correct) {
      setCorrectCount((c) => c + 1)
    } else {
      setWrongCount((c) => c + 1)
      setWrongList((prev) => [...prev, currentCard])
    }

    if (currentIndex + 1 >= cards.length) {
      // Session complete - update study_stats
      const todayCorrect = correct ? correctCount + 1 : correctCount
      const todayWrong = correct ? wrongCount : wrongCount + 1
      await updateStudyStats(cards.length, todayCorrect, todayWrong)
      setPhase('summary')
    } else {
      setCurrentIndex((i) => i + 1)
      setRevealed(false)
    }
  }, [currentCard, currentIndex, cards.length, correctCount, wrongCount])

  async function updateStudyStats(total: number, correct: number, wrong: number) {
    const today = format(new Date(), 'yyyy-MM-dd')

    const { data: existing } = await supabase
      .from('study_stats')
      .select('*')
      .eq('date', today)
      .maybeSingle()

    if (existing) {
      await supabase
        .from('study_stats')
        .update({
          cards_reviewed: existing.cards_reviewed + total,
          cards_correct: existing.cards_correct + correct,
          cards_wrong: existing.cards_wrong + wrong,
        })
        .eq('id', existing.id)
    } else {
      // Calculate streak
      const { data: allStats } = await supabase
        .from('study_stats')
        .select('date, streak_days')
        .order('date', { ascending: false })
        .limit(1)

      let streakDays = 1
      if (allStats && allStats.length > 0) {
        const lastDate = allStats[0].date
        const yesterday = format(addDays(new Date(), -1), 'yyyy-MM-dd')
        if (lastDate === yesterday) {
          streakDays = (allStats[0].streak_days ?? 0) + 1
        }
      }

      await supabase.from('study_stats').insert({
        date: today,
        cards_reviewed: total,
        cards_correct: correct,
        cards_wrong: wrong,
        new_cards_added: 0,
        streak_days: streakDays,
      })
    }
  }

  const speak = (text: string) => {
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'fr-FR'
    u.rate = 0.85
    const voices = speechSynthesis.getVoices()
    const frVoice = voices.find(v => v.lang === 'fr-FR' && v.localService) || voices.find(v => v.lang.startsWith('fr'))
    if (frVoice) u.voice = frVoice
    speechSynthesis.speak(u)
  }

  function SpeakButton({ text, size = 'sm' }: { text: string; size?: 'sm' | 'lg' }) {
    return (
      <button
        onClick={(e) => {
          e.stopPropagation()
          speak(text)
        }}
        className={`inline-flex items-center justify-center active:scale-90 transition-transform opacity-60 hover:opacity-100 ${
          size === 'lg' ? 'text-4xl' : 'text-base ml-1.5'
        }`}
        aria-label="播放发音"
      >
        🔊
      </button>
    )
  }

  // Get the phonetic/IPA to display: prefer source vocab IPA, fall back to card phonetic
  function getPhonetic(): string | null {
    if (currentVocab?.ipa) return currentVocab.ipa
    if (currentCard?.phonetic) return currentCard.phonetic
    return null
  }

  // Get definition: prefer source vocab definition, fall back to card back
  function getDefinition(): string {
    if (currentVocab?.definition) return currentVocab.definition
    return currentCard?.back ?? ''
  }

  // Get notes content
  function getNotes(): string | null {
    if (currentVocab?.notes) return currentVocab.notes
    // If the definition came from source vocab, the card's back might have extra info
    if (currentVocab?.definition && currentCard?.back && currentCard.back !== currentVocab.definition) {
      return currentCard.back
    }
    return null
  }

  // Get emoji from source vocab or card
  function getEmoji(): string | null {
    if (currentVocab?.emoji) return currentVocab.emoji
    if (currentCard?.emoji) return currentCard.emoji
    return null
  }

  function renderFront() {
    if (!currentCard) return null
    const mode = currentCard.test_mode

    if (mode === 'listen') {
      return (
        <div className="text-center">
          <button
            onClick={() => speak(currentCard.front)}
            className="text-6xl mb-4 active:scale-95 transition-transform"
          >
            🔊
          </button>
          <div className="text-sm text-gray-400">点击听发音，猜词义</div>
        </div>
      )
    }

    if (mode === 'cn_to_fr') {
      const emoji = getEmoji()
      return (
        <div className="text-center">
          <div className="text-sm text-gray-400 mb-2">中 → 法</div>
          {emoji ? (
            <div className="text-4xl">{emoji}</div>
          ) : (
            <div className="text-2xl font-bold text-gray-800">{currentCard.back}</div>
          )}
        </div>
      )
    }

    // fr_to_cn (default)
    const phonetic = getPhonetic()
    return (
      <div className="text-center">
        <div className="text-sm text-gray-400 mb-2">法 → 中</div>
        {getEmoji() && <div className="text-3xl mb-2">{getEmoji()}</div>}
        <div className="flex items-center justify-center">
          <span className="text-3xl font-bold text-gray-800">{currentCard.front}</span>
          <SpeakButton text={currentCard.front} />
        </div>
        {phonetic && (
          <div className="text-sm text-gray-400 mt-1">{phonetic}</div>
        )}
      </div>
    )
  }

  function renderNotesSection(notes: string | null, definition: string) {
    // If there's no definition but there are notes, show notes expanded
    const hasDefinition = !!definition
    const hasNotes = !!notes
    if (!hasNotes) return null

    const shouldDefaultExpand = !hasDefinition
    const isExpanded = shouldDefaultExpand || notesExpanded

    return (
      <div className="mt-3 w-full">
        {!shouldDefaultExpand && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              setNotesExpanded(!notesExpanded)
            }}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            {notesExpanded ? '收起备注 ▲' : '展开备注 ▼'}
          </button>
        )}
        {isExpanded && (
          <div className="mt-1 text-sm text-gray-500 bg-gray-100 rounded-lg px-3 py-2 text-left whitespace-pre-wrap">
            {notes}
          </div>
        )}
      </div>
    )
  }

  function renderBack() {
    if (!currentCard) return null
    const mode = currentCard.test_mode
    const phonetic = getPhonetic()
    const definition = getDefinition()
    const notes = getNotes()

    if (mode === 'cn_to_fr') {
      return (
        <div className="text-center mt-4 pt-4 border-t border-gray-100 w-full">
          {getEmoji() && <div className="text-2xl mb-1">{getEmoji()}</div>}
          <div className="flex items-center justify-center">
            <span className="text-2xl font-bold text-indigo-600">{currentCard.front}</span>
            <SpeakButton text={currentCard.front} />
          </div>
          {phonetic && (
            <div className="text-sm text-gray-400 mt-1">{phonetic}</div>
          )}
          <div className="text-base text-gray-600 mt-2">{definition}</div>
          {renderNotesSection(notes, definition)}
        </div>
      )
    }

    if (mode === 'listen') {
      return (
        <div className="text-center mt-4 pt-4 border-t border-gray-100 w-full">
          {getEmoji() && <div className="text-2xl mb-1">{getEmoji()}</div>}
          <div className="flex items-center justify-center">
            <span className="text-2xl font-bold text-indigo-600">{currentCard.front}</span>
            <SpeakButton text={currentCard.front} />
          </div>
          {phonetic && (
            <div className="text-sm text-gray-400 mt-1">{phonetic}</div>
          )}
          <div className="text-base text-gray-600 mt-2">{definition}</div>
          {renderNotesSection(notes, definition)}
        </div>
      )
    }

    // fr_to_cn
    return (
      <div className="text-center mt-4 pt-4 border-t border-gray-100 w-full">
        <div className="text-xl font-bold text-indigo-600">{definition}</div>
        {renderNotesSection(notes, definition)}
      </div>
    )
  }

  // START SCREEN
  if (phase === 'start') {
    if (loading) {
      return (
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-400 text-sm">加载中...</div>
        </div>
      )
    }

    return (
      <div className="px-4 pt-12 flex flex-col items-center">
        <div className="text-6xl mb-6">📖</div>
        <div className="text-4xl font-bold text-indigo-600 mb-2">{dueCount}</div>
        <div className="text-gray-500 mb-8">张卡片待复习</div>

        {dueCount > 0 && (
          <>
            <div className="flex items-center gap-3 mb-6">
              <span className="text-sm text-gray-500">数量</span>
              <div className="flex items-center bg-gray-100 rounded-lg">
                <button
                  onClick={() => setLimit((l) => Math.max(5, l - 5))}
                  className="px-3 py-1.5 text-lg text-gray-600 active:bg-gray-200 rounded-l-lg"
                >
                  -
                </button>
                <span className="px-4 py-1.5 text-base font-bold text-gray-800 min-w-[40px] text-center">
                  {Math.min(limit, dueCount)}
                </span>
                <button
                  onClick={() => setLimit((l) => Math.min(dueCount, l + 5))}
                  className="px-3 py-1.5 text-lg text-gray-600 active:bg-gray-200 rounded-r-lg"
                >
                  +
                </button>
              </div>
            </div>
            <button
              onClick={startSession}
              className="bg-indigo-600 text-white rounded-xl px-8 py-3 text-lg font-medium active:bg-indigo-700 transition-colors"
            >
              开始复习
            </button>
          </>
        )}

        {dueCount === 0 && (
          <div className="text-center text-gray-400 text-sm mt-4">
            暂无待复习卡片，明天再来吧!
          </div>
        )}
      </div>
    )
  }

  // SUMMARY SCREEN
  if (phase === 'summary') {
    const total = correctCount + wrongCount
    const accuracy = total > 0 ? Math.round((correctCount / total) * 100) : 0

    return (
      <div className="px-4 pt-8">
        <div className="text-center mb-6">
          <div className="text-5xl mb-4">{accuracy >= 80 ? '🎉' : accuracy >= 50 ? '💪' : '📚'}</div>
          <h2 className="text-xl font-bold text-gray-800 mb-1">复习完成!</h2>
          <div className="text-sm text-gray-500">正确率 {accuracy}%</div>
        </div>

        <div className="flex gap-3 mb-6">
          <div className="flex-1 bg-green-50 rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-green-600">{correctCount}</div>
            <div className="text-xs text-gray-500 mt-1">正确</div>
          </div>
          <div className="flex-1 bg-red-50 rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-red-500">{wrongCount}</div>
            <div className="text-xs text-gray-500 mt-1">错误</div>
          </div>
          <div className="flex-1 bg-indigo-50 rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-indigo-600">{total}</div>
            <div className="text-xs text-gray-500 mt-1">总计</div>
          </div>
        </div>

        {wrongList.length > 0 && (
          <div className="mb-6">
            <h3 className="text-sm font-semibold text-gray-600 mb-2">错误列表</h3>
            <div className="space-y-2">
              {wrongList.map((card) => (
                <div key={card.id} className="bg-red-50 rounded-lg px-3 py-2">
                  <div className="text-sm font-medium text-gray-800">{card.front}</div>
                  <div className="text-xs text-gray-500">{card.back}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <button
          onClick={() => {
            setPhase('start')
            loadDueCount()
          }}
          className="w-full bg-indigo-600 text-white rounded-xl py-3 font-medium active:bg-indigo-700 transition-colors"
        >
          返回
        </button>
      </div>
    )
  }

  // REVIEW SCREEN
  return (
    <div className="px-4 pt-6">
      {/* Progress bar */}
      <div className="flex items-center gap-3 mb-6">
        <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
          <div
            className="h-full bg-indigo-500 rounded-full transition-all duration-300"
            style={{ width: `${((currentIndex + 1) / cards.length) * 100}%` }}
          />
        </div>
        <span className="text-xs text-gray-400 shrink-0">
          {currentIndex + 1}/{cards.length}
        </span>
      </div>

      {/* Card type badge */}
      {currentCard && (
        <div className="flex justify-between items-center mb-4">
          <span className="text-[10px] bg-gray-100 text-gray-500 rounded px-1.5 py-0.5">
            {currentCard.card_type === 'vocab' ? '词汇' : '语法'}
          </span>
          {currentCard.cefr_level && (
            <span className="text-[10px] bg-indigo-50 text-indigo-500 rounded px-1.5 py-0.5">
              {currentCard.cefr_level}
            </span>
          )}
        </div>
      )}

      {/* Card */}
      <div className="bg-gray-50 rounded-2xl p-6 min-h-[200px] flex flex-col items-center justify-center mb-6">
        {renderFront()}
        {revealed && renderBack()}
      </div>

      {/* Action buttons */}
      {!revealed ? (
        <button
          onClick={() => setRevealed(true)}
          className="w-full bg-gray-100 text-gray-700 rounded-xl py-3 font-medium active:bg-gray-200 transition-colors"
        >
          显示答案
        </button>
      ) : (
        <div className="flex gap-3">
          <button
            onClick={() => advanceCard(false)}
            className="flex-1 bg-red-50 text-red-600 rounded-xl py-3 font-medium active:bg-red-100 transition-colors"
          >
            错了 ✗
          </button>
          <button
            onClick={() => advanceCard(true)}
            className="flex-1 bg-green-50 text-green-600 rounded-xl py-3 font-medium active:bg-green-100 transition-colors"
          >
            对了 ✓
          </button>
        </div>
      )}
    </div>
  )
}
