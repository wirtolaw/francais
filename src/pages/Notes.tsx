import { useEffect, useState, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'

// --- Types ---

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
  updated_at: string | null
}

interface VocabItem {
  id: number
  word: string
  ipa: string | null
  definition: string
  notes: string | null
  example_sentences: string | null
  cefr_level: string | null
  is_learned: boolean
}

interface VocabDetail extends VocabItem {
  relatedGrammar: { id: number; title: string }[]
  reviewStatus: { interval_days: number; next_review: string | null; times_reviewed: number } | null
}

interface LinkedVocab {
  id: number
  word: string
  ipa: string | null
  definition: string
}

// --- TTS ---

const speak = (text: string) => {
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'fr-FR'
  u.rate = 0.85
  const voices = speechSynthesis.getVoices()
  const frVoice = voices.find(v => v.lang === 'fr-FR' && v.localService) || voices.find(v => v.lang.startsWith('fr'))
  if (frVoice) u.voice = frVoice
  speechSynthesis.speak(u)
}

// --- CEFR badge ---

const cefrColor: Record<string, string> = {
  A1: '#22c55e',
  A2: '#3b82f6',
  B1: '#f59e0b',
  B2: '#ef4444',
}

function CefrBadge({ level }: { level: string | null }) {
  if (!level) return null
  const bg = cefrColor[level] || '#6b7280'
  return (
    <span
      className="text-[10px] font-medium text-white rounded px-1.5 py-0.5"
      style={{ backgroundColor: bg }}
    >
      {level}
    </span>
  )
}

// --- Main Component ---

export default function Notes() {
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<'grammar' | 'vocab'>('grammar')

  // Grammar state
  const [grammarNotes, setGrammarNotes] = useState<GrammarNote[]>([])
  const [collapsedTags, setCollapsedTags] = useState<Set<string>>(new Set())
  const [expandedGrammarId, setExpandedGrammarId] = useState<number | null>(null)
  const [linkedVocabCache, setLinkedVocabCache] = useState<Record<number, LinkedVocab[]>>({})

  // Vocab state
  const [vocabItems, setVocabItems] = useState<VocabItem[]>([])
  const [vocabOffset, setVocabOffset] = useState(0)
  const [hasMoreVocab, setHasMoreVocab] = useState(true)
  const [expandedVocabId, setExpandedVocabId] = useState<number | null>(null)
  const [vocabDetailCache, setVocabDetailCache] = useState<Record<number, VocabDetail>>({})
  const [notesExpanded, setNotesExpanded] = useState(false)

  const [loading, setLoading] = useState(false)
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  const PAGE_SIZE = 20

  // --- Data Loading ---

  const loadGrammarNotes = useCallback(async (searchTerm: string) => {
    setLoading(true)
    let query = supabase
      .from('grammar_notes')
      .select('*')
      .order('created_at', { ascending: false })

    if (searchTerm.trim()) {
      const s = searchTerm.trim()
      query = query.or(
        `title.ilike.%${s}%,content.ilike.%${s}%,examples.ilike.%${s}%,exceptions.ilike.%${s}%,personal_notes.ilike.%${s}%`
      )
    }

    const { data } = await query
    setGrammarNotes(data || [])
    setLoading(false)
  }, [])

  const loadVocab = useCallback(async (searchTerm: string, offset: number, append: boolean) => {
    setLoading(true)
    let query = supabase
      .from('french_vocab')
      .select('id, word, ipa, definition, notes, example_sentences, cefr_level, is_learned')
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)

    if (searchTerm.trim()) {
      const s = searchTerm.trim()
      query = query.or(`word.ilike.%${s}%,definition.ilike.%${s}%,notes.ilike.%${s}%`)
    }

    const { data } = await query
    const items = (data || []) as VocabItem[]

    if (append) {
      setVocabItems(prev => [...prev, ...items])
    } else {
      setVocabItems(items)
    }
    setHasMoreVocab(items.length === PAGE_SIZE)
    setLoading(false)
  }, [])

  // Initial load
  useEffect(() => {
    loadGrammarNotes('')
  }, [loadGrammarNotes])

  // Search debounce
  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(() => {
      if (tab === 'grammar') {
        loadGrammarNotes(search)
      } else {
        setVocabOffset(0)
        loadVocab(search, 0, false)
      }
    }, 300)
    return () => {
      if (searchTimeout.current) clearTimeout(searchTimeout.current)
    }
  }, [search, tab, loadGrammarNotes, loadVocab])

  // When switching to vocab tab for the first time
  useEffect(() => {
    if (tab === 'vocab' && vocabItems.length === 0) {
      setVocabOffset(0)
      loadVocab(search, 0, false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  // --- Grammar helpers ---

  // Group notes by tag
  const notesByTag = (() => {
    const map = new Map<string, GrammarNote[]>()
    grammarNotes.forEach(note => {
      const tags = note.tags && note.tags.length > 0 ? note.tags : ['未分类']
      tags.forEach(tag => {
        if (!map.has(tag)) map.set(tag, [])
        map.get(tag)!.push(note)
      })
    })
    // Sort tags alphabetically, but put 未分类 last
    const sorted = Array.from(map.entries()).sort((a, b) => {
      if (a[0] === '未分类') return 1
      if (b[0] === '未分类') return -1
      return a[0].localeCompare(b[0])
    })
    return sorted
  })()

  const toggleTag = (tag: string) => {
    setCollapsedTags(prev => {
      const next = new Set(prev)
      if (next.has(tag)) next.delete(tag)
      else next.add(tag)
      return next
    })
  }

  const expandGrammar = async (noteId: number) => {
    if (expandedGrammarId === noteId) {
      setExpandedGrammarId(null)
      return
    }
    setExpandedGrammarId(noteId)

    // Load linked vocab if needed
    const note = grammarNotes.find(n => n.id === noteId)
    if (note?.linked_vocab_ids && note.linked_vocab_ids.length > 0 && !linkedVocabCache[noteId]) {
      const { data } = await supabase
        .from('french_vocab')
        .select('id, word, ipa, definition')
        .in('id', note.linked_vocab_ids)
      if (data) {
        setLinkedVocabCache(prev => ({ ...prev, [noteId]: data as LinkedVocab[] }))
      }
    }
  }

  // Click linked vocab → switch to vocab tab and search for that word
  const goToVocab = (word: string) => {
    setTab('vocab')
    setSearch(word)
  }

  // Click related grammar → switch to grammar tab and expand that note
  const goToGrammar = (noteId: number) => {
    setTab('grammar')
    setSearch('')
    setExpandedGrammarId(noteId)
  }

  // --- Vocab helpers ---

  const expandVocab = async (vocabId: number) => {
    if (expandedVocabId === vocabId) {
      setExpandedVocabId(null)
      setNotesExpanded(false)
      return
    }
    setExpandedVocabId(vocabId)
    setNotesExpanded(false)

    if (!vocabDetailCache[vocabId]) {
      const vocab = vocabItems.find(v => v.id === vocabId)!

      // Fetch related grammar and review status in parallel
      const [grammarRes, reviewRes] = await Promise.all([
        supabase
          .from('grammar_notes')
          .select('id, title, linked_vocab_ids')
          .contains('linked_vocab_ids', [vocabId]),
        supabase
          .from('review_cards')
          .select('interval_days, next_review, times_reviewed')
          .eq('source_id', vocabId)
          .limit(1),
      ])

      const relatedGrammar = (grammarRes.data || []).map(g => ({ id: g.id, title: g.title }))
      const review = reviewRes.data && reviewRes.data.length > 0 ? reviewRes.data[0] : null

      setVocabDetailCache(prev => ({
        ...prev,
        [vocabId]: {
          ...vocab,
          relatedGrammar,
          reviewStatus: review
            ? {
                interval_days: review.interval_days,
                next_review: review.next_review,
                times_reviewed: review.times_reviewed,
              }
            : null,
        },
      }))
    }
  }

  const loadMoreVocab = () => {
    const newOffset = vocabOffset + PAGE_SIZE
    setVocabOffset(newOffset)
    loadVocab(search, newOffset, true)
  }

  // --- Render ---

  return (
    <div className="px-4 pt-6 pb-24">
      <h1 className="text-xl font-bold text-gray-800 mb-4">笔记</h1>

      {/* Search bar */}
      <div className="relative mb-4">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={tab === 'grammar' ? '搜索语法笔记...' : '搜索词汇...'}
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

      {/* Segmented control */}
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

      {loading && vocabItems.length === 0 && grammarNotes.length === 0 && (
        <div className="text-center text-gray-400 text-sm py-8">加载中...</div>
      )}

      {/* ===== Grammar Tab ===== */}
      {tab === 'grammar' && (
        <>
          {!loading && grammarNotes.length === 0 && (
            <div className="text-center text-gray-400 text-sm py-8">还没有语法笔记</div>
          )}

          <div className="space-y-3">
            {notesByTag.map(([tag, notes]) => {
              const isCollapsed = collapsedTags.has(tag)
              return (
                <div key={tag}>
                  {/* Tag section header */}
                  <button
                    onClick={() => toggleTag(tag)}
                    className="w-full flex items-center gap-2 py-2 px-1"
                  >
                    <span className="text-xs text-gray-400">{isCollapsed ? '▶' : '▼'}</span>
                    <span className="text-sm font-semibold text-indigo-600">{tag}</span>
                    <span className="text-xs text-gray-400">({notes.length})</span>
                  </button>

                  {/* Notes in this tag group */}
                  {!isCollapsed && (
                    <div className="space-y-2 ml-1">
                      {notes.map(note => {
                        const isExpanded = expandedGrammarId === note.id
                        return (
                          <div key={note.id} className="bg-gray-50 rounded-xl overflow-hidden">
                            <button
                              onClick={() => expandGrammar(note.id)}
                              className="w-full text-left px-4 py-3 flex items-center justify-between"
                            >
                              <span className="text-sm font-medium text-gray-800 truncate flex-1 min-w-0">
                                {note.title}
                              </span>
                              <span className="text-gray-400 text-xs ml-2">{isExpanded ? '▲' : '▼'}</span>
                            </button>

                            {isExpanded && (
                              <div className="px-4 pb-4 space-y-3">
                                {/* Title large */}
                                <h2 className="text-lg font-bold text-gray-800">{note.title}</h2>

                                {/* Tags badges */}
                                {note.tags && note.tags.length > 0 && (
                                  <div className="flex gap-1.5 flex-wrap">
                                    {note.tags.map(t => (
                                      <span
                                        key={t}
                                        className="text-[10px] bg-indigo-50 text-indigo-500 rounded-full px-2 py-0.5"
                                      >
                                        {t}
                                      </span>
                                    ))}
                                  </div>
                                )}

                                {/* Content */}
                                {note.content && (
                                  <div>
                                    <div className="text-xs font-semibold text-gray-500 mb-1">内容</div>
                                    <div className="text-sm text-gray-700 whitespace-pre-wrap">{note.content}</div>
                                  </div>
                                )}

                                {/* Examples */}
                                {note.examples && (
                                  <div>
                                    <div className="text-xs font-semibold text-gray-500 mb-1">例句</div>
                                    <div className="text-sm text-gray-700 whitespace-pre-wrap">{note.examples}</div>
                                  </div>
                                )}

                                {/* Exceptions */}
                                {note.exceptions && (
                                  <div>
                                    <div className="text-xs font-semibold text-gray-500 mb-1">例外</div>
                                    <div className="text-sm text-gray-700 whitespace-pre-wrap">{note.exceptions}</div>
                                  </div>
                                )}

                                {/* Personal notes */}
                                {note.personal_notes && (
                                  <div>
                                    <div className="text-xs font-semibold text-gray-500 mb-1">个人笔记</div>
                                    <div className="text-sm text-gray-700 whitespace-pre-wrap">
                                      {note.personal_notes}
                                    </div>
                                  </div>
                                )}

                                {/* Linked vocab */}
                                {note.linked_vocab_ids && note.linked_vocab_ids.length > 0 && (
                                  <div>
                                    <div className="text-xs font-semibold text-gray-500 mb-1">关联词汇</div>
                                    {linkedVocabCache[note.id] ? (
                                      <div className="space-y-1">
                                        {linkedVocabCache[note.id].map(v => (
                                          <button
                                            key={v.id}
                                            onClick={() => goToVocab(v.word)}
                                            className="w-full text-left bg-white rounded-lg px-3 py-2 flex items-center gap-2 active:bg-gray-50"
                                          >
                                            <span className="text-sm font-medium text-indigo-600">{v.word}</span>
                                            {v.ipa && (
                                              <span className="text-xs text-gray-400">{v.ipa}</span>
                                            )}
                                            <span className="text-xs text-gray-500 truncate flex-1">
                                              {v.definition}
                                            </span>
                                          </button>
                                        ))}
                                      </div>
                                    ) : (
                                      <div className="text-xs text-gray-400">加载中...</div>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* ===== Vocab Tab ===== */}
      {tab === 'vocab' && (
        <>
          {!loading && vocabItems.length === 0 && (
            <div className="text-center text-gray-400 text-sm py-8">
              {search ? '未找到匹配词汇' : '暂无词汇'}
            </div>
          )}

          <div className="space-y-2">
            {vocabItems.map(v => {
              const isExpanded = expandedVocabId === v.id
              const detail = vocabDetailCache[v.id]
              return (
                <div key={v.id} className="bg-gray-50 rounded-xl overflow-hidden">
                  {/* Summary row */}
                  <button
                    onClick={() => expandVocab(v.id)}
                    className="w-full text-left px-4 py-3"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <span className="text-base font-bold text-gray-800">{v.word}</span>
                        {v.ipa && <span className="text-xs text-gray-400">{v.ipa}</span>}
                      </div>
                      <div className="flex items-center gap-1.5 ml-2 shrink-0">
                        {v.is_learned && (
                          <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
                        )}
                        <CefrBadge level={v.cefr_level} />
                      </div>
                    </div>
                    <div className="text-sm text-gray-600 truncate mt-0.5">{v.definition}</div>
                  </button>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="px-4 pb-4 space-y-3 border-t border-gray-100 pt-3">
                      {/* Word + TTS */}
                      <div className="flex items-center gap-3">
                        <span className="text-lg font-bold text-gray-800">{v.word}</span>
                        <button
                          onClick={() => speak(v.word)}
                          className="text-indigo-500 active:text-indigo-700 text-lg"
                          title="播放发音"
                        >
                          🔊
                        </button>
                      </div>

                      {/* IPA */}
                      {v.ipa && <div className="text-sm text-gray-500">{v.ipa}</div>}

                      {/* Definition */}
                      <div className="text-sm text-gray-700">{v.definition}</div>

                      {/* Notes (collapsible) */}
                      {v.notes && (
                        <div>
                          <button
                            onClick={() => setNotesExpanded(!notesExpanded)}
                            className="text-xs font-semibold text-gray-500 flex items-center gap-1"
                          >
                            <span>{notesExpanded ? '▼' : '▶'}</span>
                            <span>笔记</span>
                          </button>
                          {notesExpanded && (
                            <div className="text-sm text-gray-600 mt-1 whitespace-pre-wrap">{v.notes}</div>
                          )}
                        </div>
                      )}

                      {/* Example sentences */}
                      {v.example_sentences && (() => {
                        try {
                          const sentences: { fr: string; translation: string; lang?: string }[] =
                            typeof v.example_sentences === 'string'
                              ? JSON.parse(v.example_sentences)
                              : v.example_sentences
                          if (!Array.isArray(sentences) || sentences.length === 0) return null
                          return (
                            <div>
                              <div className="text-xs font-semibold text-gray-500 mb-1">例句</div>
                              <div className="space-y-2">
                                {sentences.map((s, i) => (
                                  <div key={i} className="bg-white rounded-lg px-3 py-2">
                                    <div className="flex items-center gap-2">
                                      <div className="text-sm text-gray-800 italic">{s.fr}</div>
                                      <button
                                        onClick={() => speak(s.fr)}
                                        className="text-indigo-400 text-sm shrink-0"
                                      >
                                        🔊
                                      </button>
                                    </div>
                                    <div className="text-xs text-gray-500 mt-0.5">{s.translation}</div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )
                        } catch {
                          return null
                        }
                      })()}

                      {/* Related grammar */}
                      {detail && detail.relatedGrammar.length > 0 && (
                        <div>
                          <div className="text-xs font-semibold text-gray-500 mb-1">相关语法</div>
                          <div className="space-y-1">
                            {detail.relatedGrammar.map(g => (
                              <button
                                key={g.id}
                                onClick={() => goToGrammar(g.id)}
                                className="block text-sm text-indigo-600 hover:underline active:text-indigo-800"
                              >
                                {g.title}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Review status */}
                      {detail?.reviewStatus && (
                        <div>
                          <div className="text-xs font-semibold text-gray-500 mb-1">复习状态</div>
                          <div className="bg-white rounded-lg px-3 py-2 text-sm text-gray-600 space-y-0.5">
                            <div>间隔天数: {detail.reviewStatus.interval_days} 天</div>
                            <div>
                              下次复习:{' '}
                              {detail.reviewStatus.next_review
                                ? new Date(detail.reviewStatus.next_review).toLocaleDateString('zh-CN')
                                : '未安排'}
                            </div>
                            <div>已复习次数: {detail.reviewStatus.times_reviewed}</div>
                          </div>
                        </div>
                      )}

                      {!detail && (
                        <div className="text-xs text-gray-400">加载详情中...</div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Load more */}
          {hasMoreVocab && vocabItems.length > 0 && (
            <div className="mt-4 text-center">
              <button
                onClick={loadMoreVocab}
                disabled={loading}
                className="text-sm text-indigo-600 bg-indigo-50 rounded-lg px-4 py-2 active:bg-indigo-100 disabled:opacity-50"
              >
                {loading ? '加载中...' : '加载更多'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
