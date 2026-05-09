import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { format, subDays, parseISO, differenceInCalendarDays } from 'date-fns'
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'

// ── Types ──────────────────────────────────────────────

interface CefrProgress {
  level: string
  total: number
  learned: number
  mastered: number
}

interface WeakVocab {
  id: number
  easiness_factor: number
  card_type: string
  source_id: number | null
  front: string
  back: string
  vocab?: {
    word: string
    definition: string
    ipa: string | null
    notes: string | null
    example_sentences: string | null
  } | null
}

interface WeakRule {
  id: number
  front: string
  easiness_factor: number
}

interface Achievement {
  achievement_type: string
  achieved_at: string | null
}

interface TrendPoint {
  date: string
  label: string
  cards_reviewed: number
  accuracy: number | null
}

// ── Achievement definitions ────────────────────────────

const ALL_ACHIEVEMENTS: { type: string; icon: string; name: string }[] = [
  { type: 'first_review', icon: '🎯', name: '首次复习' },
  { type: 'words_50', icon: '📗', name: '50词' },
  { type: 'words_100', icon: '📘', name: '100词' },
  { type: 'words_500', icon: '📕', name: '500词' },
  { type: 'words_1000', icon: '📚', name: '1000词' },
  { type: 'streak_3', icon: '🔥', name: '3天' },
  { type: 'streak_7', icon: '🔥', name: '7天' },
  { type: 'streak_30', icon: '🔥', name: '30天' },
  { type: 'streak_100', icon: '🔥', name: '100天' },
  { type: 'a1_mastered', icon: '🏅', name: 'A1' },
  { type: 'a2_mastered', icon: '🏅', name: 'A2' },
  { type: 'b1_mastered', icon: '🏅', name: 'B1' },
  { type: 'b2_mastered', icon: '🏅', name: 'B2' },
  { type: 'perfect_session', icon: '💯', name: '满分' },
  { type: 'night_owl', icon: '🦉', name: '夜猫子' },
]

// ── Component ──────────────────────────────────────────

export default function Home() {
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [streak, setStreak] = useState(0)
  const [totalDays, setTotalDays] = useState(0)
  const [dueCount, setDueCount] = useState(0)
  const [achievements, setAchievements] = useState<Achievement[]>([])
  const [cefrProgress, setCefrProgress] = useState<CefrProgress[]>([])
  const [grammarCount, setGrammarCount] = useState(0)
  const [weakVocab, setWeakVocab] = useState<WeakVocab[]>([])
  const [weakRules, setWeakRules] = useState<WeakRule[]>([])
  const [expandedCard, setExpandedCard] = useState<number | null>(null)
  const [trendData, setTrendData] = useState<TrendPoint[]>([])
  const [trendDays, setTrendDays] = useState<7 | 30>(7)

  useEffect(() => {
    loadDashboard()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    loadTrendData(trendDays)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trendDays])

  async function loadDashboard() {
    setLoading(true)
    await Promise.all([
      loadStreakAndDays(),
      loadDueCount(),
      loadAchievements(),
      loadCefrProgress(),
      loadGrammarCount(),
      loadWeakVocab(),
      loadWeakRules(),
      loadTrendData(7),
    ])
    setLoading(false)
  }

  // ── Streak & total days ──────────────────────────────

  async function loadStreakAndDays() {
    const { data } = await supabase
      .from('study_stats')
      .select('date')
      .order('date', { ascending: false })

    if (!data || data.length === 0) {
      setStreak(0)
      setTotalDays(0)
      return
    }

    setTotalDays(data.length)

    const today = format(new Date(), 'yyyy-MM-dd')
    const dates = data.map((d) => d.date)
    const yesterdayStr = format(subDays(new Date(), 1), 'yyyy-MM-dd')

    const todayIdx = dates.indexOf(today)
    const yesterdayIdx = dates.indexOf(yesterdayStr)

    if (todayIdx === -1 && yesterdayIdx === -1) {
      setStreak(0)
      return
    }

    const startDate = todayIdx !== -1 ? today : yesterdayStr
    let checkDate = parseISO(startDate)
    let currentStreak = 0

    for (const dateStr of dates) {
      const d = parseISO(dateStr)
      const diff = differenceInCalendarDays(checkDate, d)
      if (diff === 0) {
        currentStreak++
        checkDate = subDays(checkDate, 1)
      } else if (diff > 0) {
        break
      }
    }

    setStreak(currentStreak)
  }

  // ── Due count ────────────────────────────────────────

  async function loadDueCount() {
    const now = new Date().toISOString()
    const { count } = await supabase
      .from('review_cards')
      .select('*', { count: 'exact', head: true })
      .or(`next_review.is.null,next_review.lte.${now}`)

    setDueCount(count ?? 0)
  }

  // ── Achievements ─────────────────────────────────────

  async function loadAchievements() {
    const { data } = await supabase
      .from('achievements')
      .select('achievement_type, achieved_at')

    setAchievements(data ?? [])
  }

  // ── CEFR progress ────────────────────────────────────

  async function loadCefrProgress() {
    const levels = ['A1', 'A2', 'B1', 'B2', 'C1']

    // Use individual count queries to avoid Supabase 1000-row default limit
    const results: CefrProgress[] = []

    for (const level of levels) {
      // Total words at this level
      const { count: total } = await supabase
        .from('french_vocab')
        .select('*', { count: 'exact', head: true })
        .eq('cefr_level', level)

      // Learned words at this level
      const { count: learned } = await supabase
        .from('french_vocab')
        .select('*', { count: 'exact', head: true })
        .eq('cefr_level', level)
        .eq('is_learned', true)

      // Mastered: learned words that have a review card with interval >= 14
      // First get learned vocab ids at this level
      const { data: learnedVocab } = await supabase
        .from('review_cards')
        .select('source_id')
        .eq('card_type', 'vocab')
        .gte('interval_days', 14)

      let mastered = 0
      if (learnedVocab && learnedVocab.length > 0) {
        const masteredIds = learnedVocab.map(c => c.source_id).filter(Boolean)
        if (masteredIds.length > 0) {
          const { count: masteredCount } = await supabase
            .from('french_vocab')
            .select('*', { count: 'exact', head: true })
            .eq('cefr_level', level)
            .eq('is_learned', true)
            .in('id', masteredIds)
          mastered = masteredCount ?? 0
        }
      }

      results.push({
        level,
        total: total ?? 0,
        learned: learned ?? 0,
        mastered,
      })
    }

    setCefrProgress(results)
  }

  // ── Grammar count ────────────────────────────────────

  async function loadGrammarCount() {
    const { count } = await supabase
      .from('grammar_notes')
      .select('*', { count: 'exact', head: true })

    setGrammarCount(count ?? 0)
  }

  // ── Weak vocab ───────────────────────────────────────

  async function loadWeakVocab() {
    const { data } = await supabase
      .from('review_cards')
      .select('id, front, back, easiness_factor, card_type, source_id')
      .eq('card_type', 'vocab')
      .gt('repetitions', 0)
      .order('easiness_factor', { ascending: true })
      .limit(10)

    if (!data || data.length === 0) {
      setWeakVocab([])
      return
    }

    // Fetch vocab details for expandable info
    const sourceIds = data.filter((d) => d.source_id != null).map((d) => d.source_id!)
    let vocabMap = new Map<number, WeakVocab['vocab']>()

    if (sourceIds.length > 0) {
      const { data: vocabRows } = await supabase
        .from('french_vocab')
        .select('id, word, definition, ipa, notes, example_sentences')
        .in('id', sourceIds)

      if (vocabRows) {
        for (const v of vocabRows) {
          vocabMap.set(v.id, {
            word: v.word,
            definition: v.definition,
            ipa: v.ipa,
            notes: v.notes,
            example_sentences: v.example_sentences,
          })
        }
      }
    }

    const items: WeakVocab[] = data.map((d) => ({
      ...d,
      vocab: d.source_id != null ? vocabMap.get(d.source_id) ?? null : null,
    }))

    setWeakVocab(items)
  }

  // ── Weak rules ───────────────────────────────────────

  async function loadWeakRules() {
    const { data } = await supabase
      .from('review_cards')
      .select('id, front, easiness_factor')
      .eq('card_type', 'rule')
      .gt('repetitions', 0)
      .order('easiness_factor', { ascending: true })
      .limit(5)

    setWeakRules(data ?? [])
  }

  // ── Trend data ───────────────────────────────────────

  async function loadTrendData(days: number) {
    const startDate = format(subDays(new Date(), days - 1), 'yyyy-MM-dd')
    const { data } = await supabase
      .from('study_stats')
      .select('date, cards_reviewed, accuracy')
      .gte('date', startDate)
      .order('date', { ascending: true })

    const statsMap = new Map<string, { cards_reviewed: number; accuracy: number | null }>()
    if (data) {
      for (const s of data) {
        statsMap.set(s.date, {
          cards_reviewed: s.cards_reviewed ?? 0,
          accuracy: s.accuracy ?? null,
        })
      }
    }

    const points: TrendPoint[] = []
    for (let i = days - 1; i >= 0; i--) {
      const d = format(subDays(new Date(), i), 'yyyy-MM-dd')
      const label = format(subDays(new Date(), i), 'MM/dd')
      const stat = statsMap.get(d)
      points.push({
        date: d,
        label,
        cards_reviewed: stat?.cards_reviewed ?? 0,
        accuracy: stat?.accuracy ?? null,
      })
    }

    setTrendData(points)
  }

  // ── Helpers ──────────────────────────────────────────

  function efColor(ef: number): string {
    if (ef < 1.5) return '#ef4444'
    if (ef < 2.0) return '#f97316'
    return '#9ca3af'
  }

  const achievedMap = new Map<string, string>()
  for (const a of achievements) {
    if (a.achieved_at) {
      achievedMap.set(a.achievement_type, a.achieved_at)
    }
  }

  const dataDaysCount = trendData.filter((d) => d.cards_reviewed > 0).length

  // ── Render ───────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 256 }}>
        <span style={{ color: '#9ca3af', fontSize: 14 }}>加载中...</span>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 430, margin: '0 auto', padding: '24px 16px', background: '#fff', minHeight: '100vh' }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: '#1f2937', marginBottom: 16 }}>Français</h1>

      {/* ── Streak & Total Days ── */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
        <div style={{ flex: 1, background: '#eef2ff', borderRadius: 12, padding: 16, textAlign: 'center' }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: '#4f46e5' }}>🔥 {streak}</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>连续 {streak} 天</div>
        </div>
        <div style={{ flex: 1, background: '#eef2ff', borderRadius: 12, padding: 16, textAlign: 'center' }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: '#4f46e5' }}>📅 {totalDays}</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>累计 {totalDays} 天</div>
        </div>
      </div>

      {/* ── Achievements ── */}
      <div style={{ marginBottom: 16, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <div style={{ display: 'flex', gap: 8, paddingBottom: 4 }}>
          {ALL_ACHIEVEMENTS.map((a) => {
            const achieved = achievedMap.get(a.type)
            return (
              <div
                key={a.type}
                style={{
                  flexShrink: 0,
                  width: 64,
                  textAlign: 'center',
                  opacity: achieved ? 1 : 0.35,
                  filter: achieved ? 'none' : 'grayscale(100%)',
                }}
              >
                <div style={{ fontSize: 22 }}>{a.icon}</div>
                <div style={{ fontSize: 10, color: achieved ? '#374151' : '#9ca3af', marginTop: 2, whiteSpace: 'nowrap' }}>
                  {a.name}
                </div>
                {achieved && (
                  <div style={{ fontSize: 9, color: '#9ca3af', marginTop: 1 }}>
                    {format(parseISO(achieved), 'MM/dd')}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Due Cards Button ── */}
      <button
        onClick={() => navigate('/review')}
        style={{
          width: '100%',
          background: '#4f46e5',
          color: '#fff',
          borderRadius: 12,
          padding: '14px 16px',
          marginBottom: 16,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          border: 'none',
          cursor: 'pointer',
          fontSize: 15,
          fontWeight: 500,
        }}
      >
        <span>今日复习</span>
        <span
          style={{
            background: 'rgba(255,255,255,0.2)',
            borderRadius: 8,
            padding: '4px 12px',
            fontSize: 17,
            fontWeight: 700,
          }}
        >
          {dueCount} 张卡片
        </span>
      </button>

      {/* ── CEFR Progress ── */}
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 13, fontWeight: 600, color: '#4b5563', marginBottom: 8 }}>CEFR 进度</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {cefrProgress.map((cp) => {
            const masteredPct = cp.total > 0 ? (cp.mastered / cp.total) * 100 : 0
            const learnedPct = cp.total > 0 ? (cp.learned / cp.total) * 100 : 0
            return (
              <div key={cp.level} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, fontFamily: 'monospace', color: '#6b7280', width: 24 }}>
                  {cp.level}
                </span>
                <div
                  style={{
                    flex: 1,
                    height: 14,
                    background: '#e5e7eb',
                    borderRadius: 7,
                    position: 'relative',
                    overflow: 'hidden',
                  }}
                >
                  {/* learned (light indigo) – behind mastered */}
                  <div
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      height: '100%',
                      width: `${learnedPct}%`,
                      background: '#a5b4fc',
                      borderRadius: 7,
                      transition: 'width 0.4s',
                    }}
                  />
                  {/* mastered (deep indigo) */}
                  <div
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      height: '100%',
                      width: `${masteredPct}%`,
                      background: '#4f46e5',
                      borderRadius: 7,
                      transition: 'width 0.4s',
                    }}
                  />
                </div>
                <span style={{ fontSize: 11, color: '#9ca3af', width: 56, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {cp.learned}/{cp.total}
                </span>
              </div>
            )
          })}
        </div>
        {/* Legend */}
        <div style={{ display: 'flex', gap: 16, marginTop: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 10, height: 10, borderRadius: 5, background: '#4f46e5' }} />
            <span style={{ fontSize: 10, color: '#9ca3af' }}>已掌握</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 10, height: 10, borderRadius: 5, background: '#a5b4fc' }} />
            <span style={{ fontSize: 10, color: '#9ca3af' }}>已学</span>
          </div>
        </div>
        {/* Grammar count */}
        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 8 }}>
          已记录 {grammarCount} 条语法规则
        </div>
      </div>

      {/* ── Weak Vocab Top 10 ── */}
      {weakVocab.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: 13, fontWeight: 600, color: '#4b5563', marginBottom: 8 }}>最弱词汇 Top 10</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {weakVocab.map((card) => {
              const isExpanded = expandedCard === card.id
              return (
                <div key={card.id}>
                  <div
                    onClick={() => setExpandedCard(isExpanded ? null : card.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      background: '#fef2f2',
                      borderRadius: 8,
                      padding: '8px 12px',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 500, color: '#1f2937', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {card.vocab?.word ?? card.front}
                      </div>
                      <div style={{ fontSize: 12, color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {card.vocab?.definition ?? card.back}
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: efColor(card.easiness_factor), marginLeft: 8, flexShrink: 0, fontWeight: 600 }}>
                      EF {card.easiness_factor.toFixed(1)}
                    </div>
                  </div>
                  {isExpanded && card.vocab && (
                    <div style={{ background: '#fff7ed', borderRadius: '0 0 8px 8px', padding: '8px 12px', fontSize: 12, color: '#4b5563' }}>
                      {card.vocab.ipa && <div style={{ marginBottom: 4 }}>IPA: {card.vocab.ipa}</div>}
                      {card.vocab.notes && <div style={{ marginBottom: 4 }}>笔记: {card.vocab.notes}</div>}
                      {card.vocab.example_sentences && (() => {
                        try {
                          const sentences: { fr: string; translation: string }[] =
                            typeof card.vocab.example_sentences === 'string'
                              ? JSON.parse(card.vocab.example_sentences)
                              : card.vocab.example_sentences
                          if (!Array.isArray(sentences) || sentences.length === 0) return null
                          return (
                            <div>
                              <div style={{ marginBottom: 4, fontWeight: 600 }}>例句</div>
                              {sentences.map((s, i) => (
                                <div key={i} style={{ marginBottom: i < sentences.length - 1 ? 8 : 0 }}>
                                  <div style={{ fontStyle: 'italic' }}>{s.fr}</div>
                                  <div style={{ color: '#9ca3af' }}>— {s.translation}</div>
                                </div>
                              ))}
                            </div>
                          )
                        } catch { return null }
                      })()}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Weak Rules Top 5 ── */}
      {weakRules.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: 13, fontWeight: 600, color: '#4b5563', marginBottom: 8 }}>最弱语法 Top 5</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {weakRules.map((rule) => (
              <div
                key={rule.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  background: '#fef2f2',
                  borderRadius: 8,
                  padding: '8px 12px',
                }}
              >
                <div style={{ fontSize: 13, color: '#1f2937', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
                  {rule.front.length > 30 ? rule.front.slice(0, 30) + '...' : rule.front}
                </div>
                <div style={{ fontSize: 12, color: efColor(rule.easiness_factor), marginLeft: 8, flexShrink: 0, fontWeight: 600 }}>
                  EF {rule.easiness_factor.toFixed(1)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Review Weak Items Button ── */}
      {(weakVocab.length > 0 || weakRules.length > 0) && (
        <button
          onClick={() => navigate('/review?weak=1')}
          style={{
            width: '100%',
            background: '#fff',
            color: '#4f46e5',
            border: '2px solid #4f46e5',
            borderRadius: 12,
            padding: '12px 16px',
            marginBottom: 20,
            cursor: 'pointer',
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          立刻复习弱项
        </button>
      )}

      {/* ── Review Trend Chart ── */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <h2 style={{ fontSize: 13, fontWeight: 600, color: '#4b5563' }}>复习趋势</h2>
          <div style={{ display: 'flex', gap: 4 }}>
            {([7, 30] as const).map((d) => (
              <button
                key={d}
                onClick={() => setTrendDays(d)}
                style={{
                  padding: '3px 10px',
                  fontSize: 11,
                  borderRadius: 6,
                  border: 'none',
                  cursor: 'pointer',
                  background: trendDays === d ? '#4f46e5' : '#e5e7eb',
                  color: trendDays === d ? '#fff' : '#6b7280',
                  fontWeight: 600,
                }}
              >
                {d}天
              </button>
            ))}
          </div>
        </div>

        {dataDaysCount < 3 ? (
          <div
            style={{
              background: '#f9fafb',
              borderRadius: 12,
              padding: 32,
              textAlign: 'center',
              color: '#9ca3af',
              fontSize: 13,
            }}
          >
            再坚持几天就能看到趋势了
          </div>
        ) : (
          <div style={{ background: '#f9fafb', borderRadius: 12, padding: 12, height: 180 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={trendData}>
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  yAxisId="left"
                  tick={{ fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  width={28}
                  allowDecimals={false}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  width={32}
                  domain={[0, 100]}
                  tickFormatter={(v: number) => `${v}%`}
                />
                <Tooltip
                  contentStyle={{
                    fontSize: 12,
                    borderRadius: 8,
                    border: 'none',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                  }}
                  formatter={(value, name) => {
                    if (name === 'cards_reviewed') return [`${value} 张`, '复习']
                    if (name === 'accuracy') return [value != null ? `${value}%` : '-', '正确率']
                    return [String(value), String(name)]
                  }}
                />
                <Bar
                  yAxisId="left"
                  dataKey="cards_reviewed"
                  fill="#a5b4fc"
                  radius={[3, 3, 0, 0]}
                  barSize={trendDays === 7 ? 20 : 8}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="accuracy"
                  stroke="#22c55e"
                  strokeWidth={2}
                  dot={{ r: 2, fill: '#22c55e' }}
                  connectNulls
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  )
}
