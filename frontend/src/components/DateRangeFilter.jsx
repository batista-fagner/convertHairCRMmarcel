import { useState, useEffect, useRef } from 'react'
import { DayPicker } from 'react-day-picker'
import { ptBR } from 'react-day-picker/locale'
import 'react-day-picker/style.css'
import { CalendarRange } from 'lucide-react'

// Filtro de período compartilhado (Dashboard, Analytics): atalhos rápidos +
// calendário pra intervalo customizado. Gera from/to como datas locais
// "YYYY-MM-DD" (from inclusivo, to exclusivo) — o backend interpreta em
// horário de São Paulo (appendDateFilter em leads.service.ts).

export const PERIOD_OPTIONS = [
  { key: 'today', label: 'Hoje' },
  { key: 'yesterday', label: 'Ontem' },
  { key: '7d', label: '7 dias' },
  { key: '30d', label: '30 dias' },
  { key: 'all', label: 'Tudo' },
]

// Data local (não UTC): toISOString() virava o dia seguinte à noite no Brasil.
function toDateInputValue(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function addDays(d, n) {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

// Converte o período selecionado em from/to (from inclusivo / to exclusivo)
export function periodToRange(period) {
  if (period === 'all') return { from: null, to: null }
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = addDays(today, 1)
  if (period === 'yesterday') return { from: toDateInputValue(addDays(today, -1)), to: toDateInputValue(today) }
  const days = { today: 0, '7d': 6, '30d': 29 }[period] ?? 0
  return { from: toDateInputValue(addDays(today, -days)), to: toDateInputValue(tomorrow) }
}

// Converte um range { from, to } (Date, do calendário) em from/to (to exclusivo, dia seguinte)
export function customRangeToRange(customFrom, customTo) {
  if (!customFrom) return { from: null, to: null }
  const end = customTo || customFrom
  return { from: toDateInputValue(customFrom), to: toDateInputValue(addDays(end, 1)) }
}

function fmtShortDate(d) {
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

// Botão + popover de calendário pra escolher um intervalo de datas customizado
// (ontem, anteontem, ou qualquer range) além dos atalhos rápidos.
function DateRangePicker({ active, appliedRange, onApply }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(appliedRange || undefined)
  const containerRef = useRef(null)

  useEffect(() => {
    if (open) setDraft(appliedRange || undefined)
  }, [open, appliedRange])

  useEffect(() => {
    if (!open) return
    const onClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  const apply = () => {
    if (!draft?.from) return
    onApply({ from: draft.from, to: draft.to || draft.from })
    setOpen(false)
  }

  const label = active && appliedRange
    ? appliedRange.from.getTime() === appliedRange.to.getTime()
      ? fmtShortDate(appliedRange.from)
      : `${fmtShortDate(appliedRange.from)} - ${fmtShortDate(appliedRange.to)}`
    : 'Escolher datas'

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition ${
          active ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
        }`}
      >
        <CalendarRange className="w-3.5 h-3.5" />
        {label}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 z-20 bg-white rounded-xl border border-slate-200 shadow-xl p-3">
          <DayPicker
            mode="range"
            locale={ptBR}
            selected={draft}
            onSelect={setDraft}
            disabled={{ after: new Date() }}
            defaultMonth={draft?.to || draft?.from || new Date()}
            classNames={{
              today: 'font-bold text-violet-600',
              selected: '!bg-violet-600 !text-white',
              range_middle: '!bg-violet-100 !text-violet-800',
              range_start: '!bg-violet-600 !text-white',
              range_end: '!bg-violet-600 !text-white',
              chevron: 'fill-violet-600',
            }}
          />
          <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 mt-1">
            <button
              onClick={() => setOpen(false)}
              className="px-3 py-1.5 rounded-md text-xs font-medium text-slate-500 hover:bg-slate-100 transition"
            >
              Cancelar
            </button>
            <button
              onClick={apply}
              disabled={!draft?.from}
              className="px-3 py-1.5 rounded-md text-xs font-bold bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white transition"
            >
              Aplicar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Barra de atalhos + calendário. `period`/`customRange` ficam no componente pai. */
export default function DateRangeFilter({ period, customRange, onPeriodChange, onCustomRange }) {
  return (
    <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1 flex-wrap">
      {PERIOD_OPTIONS.map((opt) => (
        <button
          key={opt.key}
          onClick={() => onPeriodChange(opt.key)}
          className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${
            period === opt.key ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          {opt.label}
        </button>
      ))}
      <DateRangePicker
        active={period === 'custom'}
        appliedRange={customRange}
        onApply={(r) => { onCustomRange(r); onPeriodChange('custom') }}
      />
    </div>
  )
}
