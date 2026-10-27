import { useState, useEffect, useMemo, useCallback } from 'react'
import { TrendingUp, Users, Target, ArrowUpRight, Activity, Loader2, RefreshCw, CalendarCheck, Globe } from 'lucide-react'
import DateRangeFilter, { periodToRange, customRangeToRange } from '../components/DateRangeFilter'
import { getInitials, getAvatarColor, timeAgo } from '../lib/leadFormat'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001/api'

// Mesmas raias do Kanban (KanbanLeads.jsx), na mesma ordem.
const KANBAN_LANES = [
  { id: 'novo', label: 'Novo Lead', color: 'text-slate-600' },
  { id: 'atendimento', label: 'Atendimento', color: 'text-indigo-600' },
  { id: 'nao-qualificado', label: 'Não qualificado', color: 'text-cyan-600' },
  { id: 'qualificado', label: 'Qualificado', color: 'text-rose-600' },
  { id: 'agendado', label: 'Agendado', color: 'text-violet-600' },
  { id: 'vendeu', label: 'Vendeu', color: 'text-emerald-600' },
]

const NO_PAGE_LABEL = 'WhatsApp direto (sem página)'

function pct(n, d) {
  if (!d) return '0%'
  const v = Math.round((n / d) * 1000) / 10
  return `${v.toLocaleString('pt-BR')}%`
}

export default function Dashboard() {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState('7d')
  const [customRange, setCustomRange] = useState(null) // { from: Date, to: Date }

  const range = useMemo(
    () => (period === 'custom' && customRange ? customRangeToRange(customRange.from, customRange.to) : periodToRange(period)),
    [period, customRange],
  )

  const fetchStats = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (range.from) params.set('from', range.from)
      if (range.to) params.set('to', range.to)
      const res = await fetch(`${API}/leads/dashboard?${params.toString()}`)
      setStats(await res.json())
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [range.from, range.to])

  useEffect(() => { fetchStats() }, [fetchStats])

  const header = (
    <div className="flex items-center justify-between flex-wrap gap-3">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="text-sm text-slate-400 mt-0.5">Leads que entraram no período selecionado</p>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <DateRangeFilter
          period={period}
          customRange={customRange}
          onPeriodChange={setPeriod}
          onCustomRange={setCustomRange}
        />
        <button
          onClick={fetchStats}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium bg-white text-slate-600 border border-slate-200 hover:bg-slate-100 transition"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Atualizar
        </button>
      </div>
    </div>
  )

  if (!stats) return (
    <div className="p-6 space-y-6">
      {header}
      <div className="h-64 flex items-center justify-center text-slate-400">
        {loading ? <><Loader2 className="w-6 h-6 animate-spin mr-2" /> Carregando...</> : 'Erro ao carregar o dashboard'}
      </div>
    </div>
  )

  const { total, responded, mql, scheduled, sold, mqlRate, conversionRate, byKanban, byLanding, recent } = stats

  const metrics = [
    {
      label: 'Leads Totais',
      value: total.toLocaleString('pt-BR'),
      sub: `${responded} responderam (${pct(responded, total)})`,
      icon: Users,
      color: 'text-violet-600',
      bg: 'bg-violet-50',
    },
    {
      label: 'MQLs',
      value: mql.toLocaleString('pt-BR'),
      sub: `${mqlRate.toLocaleString('pt-BR')}% dos leads · dona do próprio schedule`,
      icon: Target,
      color: 'text-emerald-600',
      bg: 'bg-emerald-50',
    },
    {
      label: 'Sessões Agendadas',
      value: scheduled.toLocaleString('pt-BR'),
      sub: `${pct(scheduled, total)} dos leads`,
      icon: CalendarCheck,
      color: 'text-blue-600',
      bg: 'bg-blue-50',
    },
    {
      label: 'Taxa de Conversão',
      value: `${conversionRate.toLocaleString('pt-BR')}%`,
      sub: `${sold} ${sold === 1 ? 'venda' : 'vendas'} (raia Vendeu)`,
      icon: TrendingUp,
      color: 'text-orange-600',
      bg: 'bg-orange-50',
    },
  ]

  // Funil acumulado: cada etapa é um subconjunto (ou quase) da anterior.
  const funnelSteps = [
    { label: 'Leads', count: total, color: 'bg-slate-400' },
    { label: 'Responderam', count: responded, color: 'bg-indigo-400' },
    { label: 'MQL', count: mql, color: 'bg-rose-500' },
    { label: 'Agendados', count: scheduled, color: 'bg-violet-500' },
    { label: 'Vendeu', count: sold, color: 'bg-emerald-500' },
  ]

  return (
    <div className={`p-6 space-y-6 ${loading ? 'opacity-60 pointer-events-none' : ''} transition-opacity`}>
      {header}

      {/* Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {metrics.map((m) => {
          const Icon = m.icon
          return (
            <div key={m.label} className="bg-white rounded-xl border border-slate-200 p-5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-medium text-slate-500">{m.label}</p>
                <div className={`w-8 h-8 rounded-lg ${m.bg} flex items-center justify-center`}>
                  <Icon className={`w-4 h-4 ${m.color}`} />
                </div>
              </div>
              <p className="text-2xl font-bold text-slate-800">{m.value}</p>
              <p className="text-xs mt-1 text-slate-400">{m.sub}</p>
            </div>
          )
        })}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">

        {/* Funil de conversão */}
        <div className="xl:col-span-3 bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="font-semibold text-slate-800">Funil de Conversão</h2>
              <p className="text-xs text-slate-400 mt-0.5">Do cadastro até a venda · % sobre a etapa anterior</p>
            </div>
            <Activity className="w-4 h-4 text-slate-400" />
          </div>

          {total === 0 ? (
            <div className="flex items-center justify-center h-32 text-slate-400 text-sm">
              Nenhum lead no período
            </div>
          ) : (
            <div className="space-y-3">
              {funnelSteps.map((step, i) => (
                <div key={step.label} className="flex items-center gap-3">
                  <p className="text-xs text-slate-500 w-24 shrink-0">{step.label}</p>
                  <div className="flex-1 bg-slate-100 rounded-full h-2.5">
                    <div
                      className={`${step.color} h-2.5 rounded-full transition-all`}
                      style={{ width: `${Math.max((step.count / total) * 100, step.count > 0 ? 2 : 0)}%` }}
                    />
                  </div>
                  <span className="text-sm font-semibold text-slate-700 w-10 text-right">{step.count}</span>
                  <span className="text-[11px] text-slate-400 w-14 text-right">
                    {i === 0 ? '100%' : pct(step.count, funnelSteps[i - 1].count)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Onde os leads do período estão agora no Kanban */}
          <div className="mt-6 pt-5 border-t border-slate-100">
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-3">Raia atual no Kanban</p>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
              {KANBAN_LANES.map((lane) => (
                <div key={lane.id} className="text-center">
                  <p className={`text-xl font-bold ${lane.color}`}>{byKanban[lane.id] || 0}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">{lane.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Leads Recentes */}
        <div className="xl:col-span-2 bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="font-semibold text-slate-800">Leads Recentes</h2>
              <p className="text-xs text-slate-400 mt-0.5">Últimos do período</p>
            </div>
            <a href="/kanban" className="text-xs text-violet-600 hover:underline flex items-center gap-0.5">
              Ver Kanban <ArrowUpRight className="w-3 h-3" />
            </a>
          </div>

          {recent.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-slate-400 text-sm">
              Nenhum lead no período
            </div>
          ) : (
            <div className="space-y-3">
              {recent.map((lead) => (
                <div key={lead.id} className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className={`w-8 h-8 rounded-full ${getAvatarColor(lead.name)} flex items-center justify-center text-white text-xs font-bold shrink-0`}>
                      {getInitials(lead.name)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-700 truncate">{lead.name}</p>
                      <p className="text-[11px] text-slate-400 truncate">
                        {lead.isMql ? '🎯 MQL · ' : ''}{lead.page || 'WhatsApp direto'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-slate-100 text-slate-500">
                      {KANBAN_LANES.find((l) => l.id === lead.kanbanStage)?.label || lead.kanbanStage}
                    </span>
                    <span className="text-[10px] text-slate-400">{timeAgo(lead.createdAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Por landing page */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-semibold text-slate-800">Por Landing Page</h2>
            <p className="text-xs text-slate-400 mt-0.5">Página de onde o lead se cadastrou (rastreamento do webhook de captura)</p>
          </div>
          <Globe className="w-4 h-4 text-slate-400" />
        </div>

        {byLanding.length === 0 ? (
          <div className="flex items-center justify-center h-20 text-slate-400 text-sm">Nenhum lead no período</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wide border-b border-slate-100">
                  <th className="py-2 pr-3">Página</th>
                  <th className="py-2 px-3 text-right">Leads</th>
                  <th className="py-2 px-3 text-right">MQL</th>
                  <th className="py-2 px-3 text-right">Agendados</th>
                  <th className="py-2 px-3 text-right">Vendas</th>
                  <th className="py-2 pl-3 text-right">Conversão</th>
                </tr>
              </thead>
              <tbody>
                {byLanding.map((row) => (
                  <tr key={row.page ?? '__none__'} className="border-b border-slate-50 last:border-0">
                    <td className={`py-2.5 pr-3 font-medium ${row.page ? 'text-slate-700' : 'text-slate-400 italic'}`}>
                      {row.page || NO_PAGE_LABEL}
                    </td>
                    <td className="py-2.5 px-3 text-right font-semibold text-slate-700">{row.total}</td>
                    <td className="py-2.5 px-3 text-right text-slate-600">
                      {row.mql} <span className="text-[11px] text-slate-400">({pct(row.mql, row.total)})</span>
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-600">
                      {row.scheduled} <span className="text-[11px] text-slate-400">({pct(row.scheduled, row.total)})</span>
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-600">{row.sold}</td>
                    <td className="py-2.5 pl-3 text-right font-semibold text-emerald-600">{pct(row.sold, row.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
