import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Send, Loader2, CheckCircle2, AlertTriangle, History, StopCircle, PlayCircle,
  Trash2, RefreshCw, X, Eye, Download, Users, Search, MessageCircle, Clock,
} from 'lucide-react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3002/api'

const FILTERS = [
  { id: 'imported', label: 'Importados' },
  { id: 'never-contacted', label: 'Nunca contatados' },
  { id: 'all', label: 'Todos' },
]

const VARIABLES = [
  { tag: '{nome}', label: 'Primeiro nome' },
  { tag: '{telefone}', label: 'Telefone' },
]

const STATUS_CONFIG = {
  scheduled: { label: 'Agendada', className: 'bg-blue-100 text-blue-700' },
  sending: { label: 'Enviando', className: 'bg-amber-100 text-amber-700' },
  paused: { label: 'Pausada', className: 'bg-slate-100 text-slate-600' },
  done: { label: 'Concluída', className: 'bg-emerald-100 text-emerald-700' },
  deleting: { label: 'Deletando', className: 'bg-red-100 text-red-600' },
}

function formatPhone(phone) {
  if (!phone) return ''
  const d = phone.replace(/\D/g, '')
  if (d.length === 11 && d.startsWith('1')) return `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  // DDI 55 só conta como Brasil com 13 dígitos (55 + DDD + 9 dígitos) — um
  // local de 11 dígitos com DDD 55 (Santa Maria/RS) não pode ser confundido
  // com DDI, senão perde 2 dígitos reais do número na formatação.
  const isBr = d.length === 13 && d.startsWith('55')
  const local = isBr ? d.slice(2) : d
  const prefix = isBr ? '+55 ' : ''
  if (local.length === 11) return `${prefix}(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`
  if (local.length === 10) return `${prefix}(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`
  return phone
}

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function firstName(name) {
  if (!name || /^Lead \d+$/i.test(name)) return ''
  return name.trim().split(/\s+/)[0]
}

function interpolatePreview(template, lead) {
  return template
    .replace(/\{nome\}/gi, firstName(lead?.name) || '(sem nome)')
    .replace(/\{telefone\}/gi, lead?.phone || '17815550123')
}

export default function BulkMessage() {
  const [tab, setTab] = useState('new') // new | history
  const [filter, setFilter] = useState('imported')
  const [recipients, setRecipients] = useState([])
  const [loadingRecipients, setLoadingRecipients] = useState(true)
  const [selected, setSelected] = useState(new Set())
  const [search, setSearch] = useState('')
  const [campaignName, setCampaignName] = useState('')
  const [message, setMessage] = useState('')
  const [delayMin, setDelayMin] = useState(20)
  const [delayMax, setDelayMax] = useState(40)
  const [confirming, setConfirming] = useState(false)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState(null)
  const [campaigns, setCampaigns] = useState([])
  const [campaignsLoading, setCampaignsLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState(null)
  const [messagesModal, setMessagesModal] = useState(null) // { campaign, messages, loading }
  const textareaRef = useRef(null)
  const pollRef = useRef(null)

  const loadRecipients = useCallback(async () => {
    setLoadingRecipients(true)
    try {
      const res = await fetch(`${API}/bulk-message/recipients?filter=${filter}`)
      const data = await res.json()
      setRecipients(Array.isArray(data) ? data : [])
    } catch {
      setRecipients([])
    } finally {
      setLoadingRecipients(false)
    }
  }, [filter])

  useEffect(() => {
    if (tab === 'new') loadRecipients()
  }, [tab, loadRecipients])

  // Trocar filtro limpa a seleção — evita disparar sem querer pra alguém que saiu da lista visível
  useEffect(() => { setSelected(new Set()); setConfirming(false) }, [filter])
  useEffect(() => { setResult(null); setConfirming(false) }, [message, selected])

  const loadCampaigns = useCallback(async (silent = false) => {
    if (!silent) setCampaignsLoading(true)
    try {
      const res = await fetch(`${API}/bulk-message/campaigns`)
      const data = await res.json()
      setCampaigns(Array.isArray(data) ? data : [])
    } catch {
      setCampaigns([])
    } finally {
      if (!silent) setCampaignsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (tab !== 'history') { clearInterval(pollRef.current); return }
    loadCampaigns()
    pollRef.current = setInterval(() => loadCampaigns(true), 5000)
    return () => clearInterval(pollRef.current)
  }, [tab, loadCampaigns])

  const filtered = recipients.filter(r => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return (r.name || '').toLowerCase().includes(q) || (r.phone || '').includes(q.replace(/\D/g, '') || q)
  })

  const allFilteredSelected = filtered.length > 0 && filtered.every(r => selected.has(r.id))

  function toggleAll() {
    if (allFilteredSelected) {
      const next = new Set(selected)
      filtered.forEach(r => next.delete(r.id))
      setSelected(next)
    } else {
      const next = new Set(selected)
      filtered.forEach(r => next.add(r.id))
      setSelected(next)
    }
  }

  function toggleLead(id) {
    const next = new Set(selected)
    next.has(id) ? next.delete(id) : next.add(id)
    setSelected(next)
  }

  function insertVariable(tag) {
    const el = textareaRef.current
    if (!el) { setMessage(m => m + tag); return }
    const start = el.selectionStart
    const end = el.selectionEnd
    const newText = message.slice(0, start) + tag + message.slice(end)
    setMessage(newText)
    setTimeout(() => {
      el.focus()
      el.setSelectionRange(start + tag.length, start + tag.length)
    }, 0)
  }

  const previewLead = recipients.find(r => selected.has(r.id)) || filtered[0]
  const previewText = message ? interpolatePreview(message, previewLead) : ''
  const canSend = selected.size > 0 && message.trim().length > 0 && !sending

  async function handleSend() {
    setSending(true)
    setResult(null)
    try {
      const res = await fetch(`${API}/bulk-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadIds: Array.from(selected),
          message: message.trim(),
          name: campaignName.trim() || undefined,
          delayMin: Number(delayMin) || undefined,
          delayMax: Number(delayMax) || undefined,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => null)
        throw new Error(err?.message || 'Erro ao enfileirar')
      }
      const data = await res.json()
      setResult({ ok: true, text: `${data.queued} mensagem(s) enfileirada(s)! Acompanhe na aba Histórico.` })
      setSelected(new Set())
      setMessage('')
      setCampaignName('')
      setConfirming(false)
    } catch (err) {
      setResult({ ok: false, text: `Erro: ${err.message}` })
      setConfirming(false)
    } finally {
      setSending(false)
    }
  }

  async function handleCampaignAction(campaign, action) {
    setActionLoading(campaign.id + action)
    try {
      await fetch(`${API}/bulk-message/campaigns/${campaign.id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      loadCampaigns(true)
    } finally {
      setActionLoading(null)
    }
  }

  async function openMessages(campaign) {
    setMessagesModal({ campaign, messages: [], loading: true })
    try {
      const res = await fetch(`${API}/bulk-message/campaigns/${campaign.id}/messages`)
      const data = await res.json()
      const messages = Array.isArray(data) ? data : (data?.messages || [])
      setMessagesModal({ campaign, messages, loading: false })
    } catch {
      setMessagesModal({ campaign, messages: [], loading: false })
    }
  }

  return (
    <div className="p-6 overflow-y-auto h-full">
      {/* Header + tabs */}
      <div className="mb-5 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-violet-50 rounded-lg flex items-center justify-center shrink-0">
            <Send className="w-5 h-5 text-violet-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-800">Disparo em Massa</h2>
            <p className="text-sm text-slate-400 mt-0.5">Envio de mensagem pra vários leads de uma vez, com fila e espaçamento automático</p>
          </div>
        </div>
        <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
          {[{ id: 'new', label: 'Novo Disparo', icon: Send }, { id: 'history', label: 'Histórico', icon: History }].map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition ${
                tab === t.id ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <t.icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'new' ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Coluna esquerda: seleção de leads */}
          <div className="bg-white rounded-xl border border-slate-200 flex flex-col overflow-hidden" style={{ maxHeight: 'calc(100vh - 190px)' }}>
            <div className="px-4 pt-4 pb-3 border-b border-slate-100 shrink-0">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                  <Users className="w-4 h-4 text-violet-500" /> Destinatários
                  <span className="text-xs font-normal text-slate-400">({selected.size} selecionado{selected.size !== 1 ? 's' : ''})</span>
                </p>
                <button
                  onClick={loadRecipients}
                  title="Recarregar"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingRecipients ? 'animate-spin' : ''}`} />
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2.5">
                {FILTERS.map(f => (
                  <button
                    key={f.id}
                    onClick={() => setFilter(f.id)}
                    className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition ${
                      filter === f.id ? 'bg-violet-600 text-white shadow' : 'bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <div className="relative mt-2.5">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Buscar por nome ou telefone..."
                  className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 text-xs outline-none focus:ring-2 focus:ring-violet-300"
                />
              </div>
              <label className="flex items-center gap-2 mt-2.5 text-xs text-slate-600 cursor-pointer select-none">
                <input type="checkbox" checked={allFilteredSelected} onChange={toggleAll} className="accent-violet-600" />
                Selecionar todos os {filtered.length} da lista
              </label>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-slate-50">
              {loadingRecipients ? (
                <div className="flex items-center justify-center gap-2 py-10 text-slate-400 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin" /> Carregando leads...
                </div>
              ) : filtered.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-10">Nenhum lead nesse filtro.</p>
              ) : (
                filtered.map(lead => (
                  <label key={lead.id} className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-slate-50 transition select-none">
                    <input
                      type="checkbox"
                      checked={selected.has(lead.id)}
                      onChange={() => toggleLead(lead.id)}
                      className="accent-violet-600 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-700 truncate">{lead.name}</p>
                      <p className="text-xs text-slate-400">{formatPhone(lead.phone)}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {lead.importedAt && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700 font-medium flex items-center gap-0.5">
                          <Download className="w-3 h-3" /> Importado
                        </span>
                      )}
                      {lead.waLastMessageAt ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500" title={`Última msg: ${fmtDate(lead.waLastMessageAt)}`}>
                          <MessageCircle className="w-3 h-3" />
                        </span>
                      ) : (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-cyan-50 text-cyan-600 font-medium">nunca contatado</span>
                      )}
                    </div>
                  </label>
                ))
              )}
            </div>
          </div>

          {/* Coluna direita: mensagem + envio */}
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Nome da campanha (opcional)</label>
              <input
                type="text"
                value={campaignName}
                onChange={e => setCampaignName(e.target.value)}
                placeholder={`Disparo ${new Date().toLocaleDateString('pt-BR')}`}
                className="w-full mt-1.5 px-3 py-2 rounded-lg border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-violet-300"
              />

              <div className="flex items-center justify-between mt-4">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Mensagem</label>
                <div className="flex gap-1.5">
                  {VARIABLES.map(v => (
                    <button
                      key={v.tag}
                      onClick={() => insertVariable(v.tag)}
                      title={v.label}
                      className="text-[11px] px-2 py-0.5 rounded bg-violet-50 text-violet-700 font-mono hover:bg-violet-100 transition"
                    >
                      {v.tag}
                    </button>
                  ))}
                </div>
              </div>
              <textarea
                ref={textareaRef}
                value={message}
                onChange={e => setMessage(e.target.value)}
                rows={6}
                placeholder={'Oi {nome}! Tudo bem? ...'}
                className="w-full mt-1.5 px-3 py-2.5 rounded-lg border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-violet-300 resize-y"
              />

              {previewText && (
                <div className="mt-3 bg-emerald-50/60 border border-emerald-100 rounded-lg p-3">
                  <p className="text-[10px] font-semibold text-emerald-600 uppercase tracking-wide mb-1">
                    Prévia {previewLead ? `(${previewLead.name})` : ''}
                  </p>
                  <p className="text-sm text-slate-700 whitespace-pre-wrap">{previewText}</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 mt-4">
                <div>
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1">
                    <Clock className="w-3 h-3" /> Delay mín. (s)
                  </label>
                  <input
                    type="number" min={10} max={3600}
                    value={delayMin}
                    onChange={e => setDelayMin(e.target.value)}
                    className="w-full mt-1.5 px-3 py-2 rounded-lg border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-violet-300"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1">
                    <Clock className="w-3 h-3" /> Delay máx. (s)
                  </label>
                  <input
                    type="number" min={10} max={3600}
                    value={delayMax}
                    onChange={e => setDelayMax(e.target.value)}
                    className="w-full mt-1.5 px-3 py-2 rounded-lg border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-violet-300"
                  />
                </div>
              </div>
              <p className="text-[11px] text-slate-400 mt-1.5">
                Espaçamento aleatório entre cada envio — protege o número contra bloqueio por disparo em rajada.
              </p>
            </div>

            {result && (
              <div className={`rounded-xl border p-3.5 flex items-center gap-2 text-sm font-medium ${
                result.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-600'
              }`}>
                {result.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
                {result.text}
              </div>
            )}

            {confirming ? (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <p className="text-sm font-semibold text-amber-800 flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4" /> Confirmar disparo?
                </p>
                <p className="text-xs text-amber-700 mt-1">
                  A mensagem será enviada pra <span className="font-bold">{selected.size} lead(s)</span>, com {delayMin}-{delayMax}s entre cada envio.
                </p>
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => setConfirming(false)}
                    disabled={sending}
                    className="flex-1 px-4 py-2 rounded-lg border border-amber-200 text-sm font-medium text-amber-700 hover:bg-amber-100 transition"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleSend}
                    disabled={sending}
                    className="flex-1 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-sm font-bold text-white transition disabled:opacity-60 flex items-center justify-center gap-2"
                  >
                    {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    {sending ? 'Enfileirando...' : 'Sim, disparar'}
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setConfirming(true)}
                disabled={!canSend}
                className="w-full py-3 rounded-xl bg-violet-600 hover:bg-violet-700 text-sm font-bold text-white transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <Send className="w-4 h-4" />
                {selected.size > 0 ? `Disparar pra ${selected.size} lead(s)` : 'Selecione os leads'}
              </button>
            )}
          </div>
        </div>
      ) : (
        /* Histórico */
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          {campaignsLoading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-slate-400 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> Carregando campanhas...
            </div>
          ) : campaigns.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-12">Nenhum disparo feito ainda.</p>
          ) : (
            <div className="divide-y divide-slate-50">
              {campaigns.map(c => {
                const st = STATUS_CONFIG[c.status] || { label: c.status, className: 'bg-slate-100 text-slate-600' }
                return (
                  <div key={c.id} className="px-5 py-4 flex items-center gap-4 hover:bg-slate-50/60 transition">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-slate-800 truncate">{c.name}</p>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${st.className}`}>{st.label}</span>
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5 truncate">"{c.message}"</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        {c.totalRecipients} destinatário(s) · delay {c.delayMin}-{c.delayMax}s · {fmtDate(c.createdAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => openMessages(c)}
                        title="Ver mensagens"
                        className="p-2 rounded-lg text-slate-400 hover:text-violet-600 hover:bg-violet-50 transition"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      {(c.status === 'sending' || c.status === 'scheduled') && (
                        <button
                          onClick={() => handleCampaignAction(c, 'stop')}
                          disabled={actionLoading === c.id + 'stop'}
                          title="Pausar"
                          className="p-2 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50 transition"
                        >
                          {actionLoading === c.id + 'stop' ? <Loader2 className="w-4 h-4 animate-spin" /> : <StopCircle className="w-4 h-4" />}
                        </button>
                      )}
                      {c.status === 'paused' && (
                        <button
                          onClick={() => handleCampaignAction(c, 'continue')}
                          disabled={actionLoading === c.id + 'continue'}
                          title="Continuar"
                          className="p-2 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 transition"
                        >
                          {actionLoading === c.id + 'continue' ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
                        </button>
                      )}
                      {c.status !== 'done' && c.status !== 'deleting' && (
                        <button
                          onClick={() => handleCampaignAction(c, 'delete')}
                          disabled={actionLoading === c.id + 'delete'}
                          title="Cancelar/deletar fila"
                          className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition"
                        >
                          {actionLoading === c.id + 'delete' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Modal de mensagens da campanha */}
      {messagesModal && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={() => setMessagesModal(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
              <div>
                <p className="font-bold text-slate-800">{messagesModal.campaign.name}</p>
                <p className="text-xs text-slate-400">Status por destinatário</p>
              </div>
              <button onClick={() => setMessagesModal(null)} className="text-slate-400 hover:text-slate-600 transition">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-3">
              {messagesModal.loading ? (
                <div className="flex items-center justify-center gap-2 py-8 text-slate-400 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin" /> Carregando...
                </div>
              ) : messagesModal.messages.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-8">Nenhuma mensagem encontrada na fila.</p>
              ) : (
                <div className="divide-y divide-slate-50">
                  {messagesModal.messages.map((m, i) => {
                    const phone = m.chatid?.replace('@s.whatsapp.net', '').replace('@g.us', '') || ''
                    const sent = m.status === 'sent' || m.status === 'delivered' || m.status === 'read'
                    return (
                      <div key={i} className="flex items-center justify-between py-2 gap-2">
                        <div className="min-w-0">
                          <p className="text-sm text-slate-700 truncate">{m.leadName || formatPhone(phone)}</p>
                          {m.leadName && <p className="text-[11px] text-slate-400">{formatPhone(phone)}</p>}
                        </div>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0 ${
                          sent ? 'bg-emerald-100 text-emerald-700' : m.status === 'failed' ? 'bg-red-100 text-red-600' : 'bg-slate-100 text-slate-500'
                        }`}>
                          {m.status || 'na fila'}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
