import { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'

interface GrammarNote {
  id: number
  title: string
  tags: string[] | null
  content: string
  examples: string | null
  exceptions: string | null
  personal_notes: string | null
  linked_vocab_ids: number[] | null
  created_at: string
}

interface VocabItem {
  id: number
  word: string
  meaning_cn: string
  meaning_en: string | null
  example: string | null
  phonetic: string | null
  emoji: string | null
  cefr_level: string | null
  pos: string | null
  category: string | null
  hasReviewCard: boolean
  intervalDays: number
}

export default function Notes() {
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<'grammar' | 'vocab'>('grammar')
  const [grammarNotes, setGrammarNotes] = useState<GrammarNote[]>([])
  const [allTags, setAllTags] = useState<string[]>([])
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const [vocabItems, setVocabItems] = useState<VocabItem[]>([])
  const [expandedGrammar, setExpandedGrammar] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    loadGrammarNotes()
  }, [])

  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(() => {
      if (tab === 'grammar') loadGrammarNotes()
      else loadVocab()
    }, 300)
    return () => {
      if (searchTimeout.current) clearTimeout(searchTimeout.current)
    }
  }, [search, tab, selectedTag])

  async function loadGrammarNotes() {
    setLoading(true)
    let query = supabase.from('grammar_notes').select('*').order('created_at', { ascending: false })

    if (search.trim()) {
      query = query.or(`title.ilike.%${search.trim()}%,content.ilike.%${search.trim()}%`)
    }

    if (selectedTag) {
      query = query.contains('tags', [selectedTag])
    }

    const { data } = await query

    if (data) {
      setGrammarNotes(data)
      // Collect all unique tags
      const tagSet = new Set<string>()
      data.forEach((n) => n.tags?.forEach((t: string) => tagSet.add(t)))
      setAllTags(Array.from(tagSet).sort())
    }

    setLoading(false)
  }

  async function loadVocab() {
    setLoading(true)
    let query = supabase.from('french_vocab').select('*').order('lesson_number', { ascending: true }).limit(50)

    if (search.trim()) {
      query = query.or(`word.ilike.%${search.trim()}%,meaning_cn.ilike.%${search.trim()}%`)
    }

    const { data: vocabData } = await query

    if (vocabData && vocabData.length > 0) {
      // Fetch review status for these vocab ids
      const vocabIds = vocabData.map((v) => v.id)
      const { data: reviewData } = await supabase
        .from('review_cards')
        .select('source_id, interval_days')
        .eq('card_type', 'vocab')
        .in('source_id', vocabIds)

      const reviewMap = new Map<number, number>()
      if (reviewData) {
        reviewData.forEach((r) => reviewMap.set(r.source_id, r.interval_days))
      }

      setVocabItems(
        vocabData.map((v) => ({
          id: v.id,
          word: v.word,
          meaning_cn: v.meaning_cn,
          meaning_en: v.meaning_en,
          example: v.example,
          phonetic: v.phonetic,
          emoji: v.emoji,
          cefr_level: v.cefr_level,
          pos: v.pos,
          category: v.category,
          hasReviewCard: reviewMap.has(v.id),
          intervalDays: reviewMap.get(v.id) ?? 0,
        }))
      )
    } else {
      setVocabItems([])
    }

    setLoading(false)
  }

  function getStageLabel(intervalDays: number): { text: string; color: string } {
    if (intervalDays > 21) return { text: '已掌握', color: 'text-green-600 bg-green-50' }
    if (intervalDays > 7) return { text: '熟悉', color: 'text-indigo-600 bg-indigo-50' }
    if (intervalDays > 0) return { text: '学习中', color: 'text-amber-600 bg-amber-50' }
    return { text: '新词', color: 'text-gray-500 bg-gray-100' }
  }

  return (
    <div className="px-4 pt-6">
      <h1 className="text-xl font-bold text-gray-800 mb-4">笔记</h1>

      {/* Search bar */}
      <div className="relative mb-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索语法或词汇..."
          className="w-full bg-gray-100 rounded-xl px-4 py-2.5 text-sm text-gray-800 placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-indigo-200 transition-all"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm"
          >
            ✕
          </button>
        )}
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5 mb-4">
        <button
          onClick={() => setTab('grammar')}
          className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${
            tab === 'grammar' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500'
          }`}
        >
          语法
        </button>
        <button
          onClick={() => setTab('vocab')}
          className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${
            tab === 'vocab' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500'
          }`}
        >
          词汇
        </button>
      </div>

      {loading && (
        <div className="text-center text-gray-400 text-sm py-8">加载中...</div>
      )}

      {/* Grammar section */}
      {tab === 'grammar' && !loading && (
        <>
          {/* Tags filter */}
          {allTags.length > 0 && (
            <div className="flex gap-1.5 flex-wrap mb-3">
              <button
                onClick={() => setSelectedTag(null)}
                className={`text-xs px-2 py-1 rounded-full transition-colors ${
                  selectedTag === null
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-100 text-gray-500'
                }`}
              >
                全部
              </button>
              {allTags.map((tag) => (
                <button
                  key={tag}
                  onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
                  className={`text-xs px-2 py-1 rounded-full transition-colors ${
                    selectedTag === tag
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
          )}

          {grammarNotes.length === 0 && (
            <div className="text-center text-gray-400 text-sm py-8">暂无语法笔记</div>
          )}

          <div className="space-y-2">
            {grammarNotes.map((note) => {
              const isExpanded = expandedGrammar === note.id
              return (
                <div key={note.id} className="bg-gray-50 rounded-xl overflow-hidden">
                  <button
                    onClick={() => setExpandedGrammar(isExpanded ? null : note.id)}
                    className="w-full text-left px-4 py-3 flex items-center justify-between"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-800 truncate">
                        {note.title}
                      </div>
                      {note.tags && note.tags.length > 0 && (
                        <div className="flex gap-1 mt-1">
                          {note.tags.map((t) => (
                            <span key={t} className="text-[10px] bg-indigo-50 text-indigo-500 rounded px-1.5 py-0.5">
                              {t}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <span className="text-gray-400 text-xs ml-2">{isExpanded ? '▲' : '▼'}</span>
                  </button>

                  {isExpanded && (
                    <div className="px-4 pb-4 space-y-3">
                      {note.content && (
                        <div>
                          <div className="text-xs font-semibold text-gray-500 mb-1">内容</div>
                          <div className="text-sm text-gray-700 whitespace-pre-wrap">{note.content}</div>
                        </div>
                      )}
                      {note.examples && (
                        <div>
                          <div className="text-xs font-semibold text-gray-500 mb-1">例句</div>
                          <div className="text-sm text-gray-700 whitespace-pre-wrap">{note.examples}</div>
                        </div>
                      )}
                      {note.exceptions && (
                        <div>
                          <div className="text-xs font-semibold text-gray-500 mb-1">例外</div>
                          <div className="text-sm text-gray-700 whitespace-pre-wrap">{note.exceptions}</div>
                        </div>
                      )}
                      {note.personal_notes && (
                        <div>
                          <div className="text-xs font-semibold text-gray-500 mb-1">个人笔记</div>
                          <div className="text-sm text-gray-700 whitespace-pre-wrap">{note.personal_notes}</div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* Vocab section */}
      {tab === 'vocab' && !loading && (
        <>
          {vocabItems.length === 0 && (
            <div className="text-center text-gray-400 text-sm py-8">
              {search ? '未找到匹配词汇' : '输入关键词搜索词汇'}
            </div>
          )}

          <div className="space-y-2">
            {vocabItems.map((v) => {
              const stage = v.hasReviewCard
                ? getStageLabel(v.intervalDays)
                : { text: '未加入', color: 'text-gray-400 bg-gray-50' }
              return (
                <div key={v.id} className="bg-gray-50 rounded-xl px-4 py-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {v.emoji && <span className="text-base">{v.emoji}</span>}
                        <span className="text-base font-bold text-gray-800">{v.word}</span>
                        {v.pos && (
                          <span className="text-[10px] text-gray-400 bg-gray-200 rounded px-1">
                            {v.pos}
                          </span>
                        )}
                      </div>
                      {v.phonetic && (
                        <div className="text-xs text-gray-400 mt-0.5">{v.phonetic}</div>
                      )}
                      <div className="text-sm text-gray-600 mt-1">{v.meaning_cn}</div>
                      {v.meaning_en && (
                        <div className="text-xs text-gray-400">{v.meaning_en}</div>
                      )}
                      {v.example && (
                        <div className="text-xs text-indigo-500 mt-1 italic">{v.example}</div>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1 ml-2 shrink-0">
                      {v.cefr_level && (
                        <span className="text-[10px] bg-indigo-50 text-indigo-500 rounded px-1.5 py-0.5">
                          {v.cefr_level}
                        </span>
                      )}
                      <span className={`text-[10px] rounded px-1.5 py-0.5 ${stage.color}`}>
                        {stage.text}
                      </span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
