import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { format, subDays, parseISO, differenceInCalendarDays } from 'date-fns'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

interface WeakCard {
  id: number
  front: string
  back: string
  easiness_factor: number
  card_type: string
}

interface CefrProgress {
  level: string
  total: number
  learned: number
  mastered: number
}

export default function Home() {
  const navigate = useNavigate()
  const [streak, setStreak] = useState(0)
  const [totalDays, setTotalDays] = useState(0)
  const [dueCount, setDueCount] = useState(0)
  const [weeklyStats, setWeeklyStats] = useState<{ day: string; count: number }[]>([])
  const [weakCards, setWeakCards] = useState<WeakCard[]>([])
  const [cefrProgress, setCefrProgress] = useState<CefrProgress[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadDashboard()
  }, [])

  async function loadDashboard() {
    setLoading(true)
    await Promise.all([
      loadStreakAndDays(),
      loadDueCount(),
      loadWeeklyStats(),
      loadWeakCards(),
      loadCefrProgress(),
    ])
    setLoading(false)
  }

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

    // Calculate streak
    let currentStreak = 0
    const today = format(new Date(), 'yyyy-MM-dd')
    const dates = data.map((d) => d.date)

    // Check if today or yesterday has an entry (streak can include today)
    const todayIdx = dates.indexOf(today)
    const yesterdayStr = format(subDays(new Date(), 1), 'yyyy-MM-dd')
    const yesterdayIdx = dates.indexOf(yesterdayStr)

    if (todayIdx === -1 && yesterdayIdx === -1) {
      setStreak(0)
      return
    }

    const startDate = todayIdx !== -1 ? today : yesterdayStr
    let checkDate = parseISO(startDate)

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

  async function loadDueCount() {
    const now = new Date().toISOString()
    const { count } = await supabase
      .from('review_cards')
      .select('*', { count: 'exact', head: true })
      .or(`next_review.is.null,next_review.lte.${now}`)

    setDueCount(count ?? 0)
  }

  async function loadWeeklyStats() {
    const sevenDaysAgo = format(subDays(new Date(), 6), 'yyyy-MM-dd')
    const { data } = await supabase
      .from('study_stats')
      .select('date, cards_reviewed')
      .gte('date', sevenDaysAgo)
      .order('date', { ascending: true })

    const statsMap = new Map<string, number>()
    if (data) {
      for (const s of data) {
        statsMap.set(s.date, s.cards_reviewed)
      }
    }

    const days: { day: string; count: number }[] = []
    for (let i = 6; i >= 0; i--) {
      const d = format(subDays(new Date(), i), 'yyyy-MM-dd')
      const label = format(subDays(new Date(), i), 'MM/dd')
      days.push({ day: label, count: statsMap.get(d) ?? 0 })
    }
    setWeeklyStats(days)
  }

  async function loadWeakCards() {
    const { data } = await supabase
      .from('review_cards')
      .select('id, front, back, easiness_factor, card_type')
      .gt('repetitions', 0)
      .order('easiness_factor', { ascending: true })
      .limit(5)

    setWeakCards(data ?? [])
  }

  async function loadCefrProgress() {
    const levels = ['A1', 'A2', 'B1', 'B2']
    const results: CefrProgress[] = []

    // Get vocab counts per level
    const { data: vocabCounts } = await supabase
      .from('french_vocab')
      .select('cefr_level')

    // Get review cards with interval info
    const { data: reviewCards } = await supabase
      .from('review_cards')
      .select('source_id, interval_days, cefr_level')
      .eq('card_type', 'vocab')

    const vocabByLevel = new Map<string, number>()
    if (vocabCounts) {
      for (const v of vocabCounts) {
        const lvl = v.cefr_level ?? 'A1'
        vocabByLevel.set(lvl, (vocabByLevel.get(lvl) ?? 0) + 1)
      }
    }

    const learnedByLevel = new Map<string, number>()
    const masteredByLevel = new Map<string, number>()
    if (reviewCards) {
      for (const c of reviewCards) {
        const lvl = c.cefr_level ?? 'A1'
        learnedByLevel.set(lvl, (learnedByLevel.get(lvl) ?? 0) + 1)
        if (c.interval_days >= 14) {
          masteredByLevel.set(lvl, (masteredByLevel.get(lvl) ?? 0) + 1)
        }
      }
    }

    for (const level of levels) {
      const total = vocabByLevel.get(level) ?? 0
      results.push({
        level,
        total,
        learned: learnedByLevel.get(level) ?? 0,
        mastered: masteredByLevel.get(level) ?? 0,
      })
    }

    setCefrProgress(results)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400 text-sm">加载中...</div>
      </div>
    )
  }

  return (
    <div className="px-4 pt-6">
      <h1 className="text-xl font-bold text-gray-800 mb-4">Francais</h1>

      {/* Streak & Stats Row */}
      <div className="flex gap-3 mb-4">
        <div className="flex-1 bg-indigo-50 rounded-xl p-4 text-center">
          <div className="text-3xl font-bold text-indigo-600">{streak}</div>
          <div className="text-xs text-gray-500 mt-1">连续天数</div>
        </div>
        <div className="flex-1 bg-indigo-50 rounded-xl p-4 text-center">
          <div className="text-3xl font-bold text-indigo-600">{totalDays}</div>
          <div className="text-xs text-gray-500 mt-1">学习总天数</div>
        </div>
      </div>

      {/* Due Cards Button */}
      <button
        onClick={() => navigate('/review')}
        className="w-full bg-indigo-600 text-white rounded-xl p-4 mb-4 flex items-center justify-between active:bg-indigo-700 transition-colors"
      >
        <span className="font-medium">今日复习</span>
        <span className="bg-white/20 rounded-lg px-3 py-1 text-lg font-bold">
          {dueCount} 张卡片
        </span>
      </button>

      {/* CEFR Progress */}
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-gray-600 mb-2">CEFR 进度</h2>
        <div className="space-y-2">
          {cefrProgress.map((cp) => {
            const learnedPct = cp.total > 0 ? Math.round((cp.learned / cp.total) * 100) : 0
            const masteredPct = cp.total > 0 ? Math.round((cp.mastered / cp.total) * 100) : 0
            return (
              <div key={cp.level} className="flex items-center gap-2">
                <span className="text-xs font-mono font-bold text-gray-500 w-6">{cp.level}</span>
                <div className="flex-1 bg-gray-100 rounded-full h-4 relative overflow-hidden">
                  <div
                    className="absolute left-0 top-0 h-full bg-indigo-200 rounded-full transition-all"
                    style={{ width: `${learnedPct}%` }}
                  />
                  <div
                    className="absolute left-0 top-0 h-full bg-indigo-500 rounded-full transition-all"
                    style={{ width: `${masteredPct}%` }}
                  />
                </div>
                <span className="text-[10px] text-gray-400 w-16 text-right">
                  {cp.learned}/{cp.total}
                </span>
              </div>
            )
          })}
        </div>
        <div className="flex gap-4 mt-1.5">
          <div className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 rounded-full bg-indigo-200" />
            <span className="text-[10px] text-gray-400">已学</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 rounded-full bg-indigo-500" />
            <span className="text-[10px] text-gray-400">已掌握</span>
          </div>
        </div>
      </div>

      {/* Weekly Trend */}
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-gray-600 mb-2">近7天复习趋势</h2>
        <div className="bg-gray-50 rounded-xl p-3 h-40">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={weeklyStats}>
              <XAxis dataKey="day" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={24} allowDecimals={false} />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8, border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}
                formatter={(value) => [`${value} 张`, '复习']}
              />
              <Line
                type="monotone"
                dataKey="count"
                stroke="#4f46e5"
                strokeWidth={2}
                dot={{ r: 3, fill: '#4f46e5' }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Weak Items */}
      {weakCards.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-gray-600 mb-2">薄弱项</h2>
          <div className="space-y-2">
            {weakCards.map((card) => (
              <div key={card.id} className="flex items-center justify-between bg-red-50 rounded-lg px-3 py-2">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-800 truncate">{card.front}</div>
                  <div className="text-xs text-gray-500 truncate">{card.back}</div>
                </div>
                <div className="text-xs text-red-400 ml-2 shrink-0">
                  EF {card.easiness_factor.toFixed(1)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
