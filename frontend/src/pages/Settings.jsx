import { useState, useEffect, useRef } from 'react'
import { Settings as SettingsIcon, Key, Webhook, MessageCircle, Share2, Bot, Save, RotateCcw, Loader2, CheckCircle2, Send, Trash2, Clock, Sparkles, ToggleLeft, ToggleRight, Wifi, WifiOff, Timer, RefreshCw, XCircle, Activity, Plus, Pencil, Tag, Layers, Video, Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3002/api'

const integrations = [
  { icon: Key, label: 'Meta Ads API', description: 'Conecte sua conta do Meta para puxar métricas de campanhas', color: 'bg-blue-50 text-blue-600', status: 'Não conectado' },
  { icon: MessageCircle, label: 'uazapi (WhatsApp)', description: 'Envio automático de WhatsApp para follow-up de leads', color: 'bg-emerald-50 text-emerald-600', status: 'Não conectado' },
  { icon: Webhook, label: 'Resend (Email)', description: 'API de email para disparo de sequências automáticas', color: 'bg-violet-50 text-violet-600', status: 'Não conectado' },
  { icon: Share2, label: 'RapidAPI (Instagram)', description: 'Enriquecimento de leads via análise de perfil Instagram', color: 'bg-orange-50 text-orange-600', status: 'Não conectado' },
]

const STAGE_LABEL = {
  abertura: 'Abertura',
  qualificacao: 'Qualificação',
  quente: 'Qualificado',
  frio: 'Não qualificado',
  perdido: 'Perdido',
  encerrado: 'Encerrado',
}

// Raias do Kanban (kanban_stage) — mesmos rótulos do KanbanLeads.jsx
const KANBAN_STAGE_LABEL = {
  novo: 'Novo Lead',
  atendimento: 'Atendimento',
  'nao-qualificado': 'Não qualificado',
  qualificado: 'Qualificado',
  contactado: 'Contactado',
  'ja-fez-prompt': 'Já fez prompt',
  'ja-apresentado': 'Já apresentado',
  'em-negociacao': 'Em negociação',
  vendeu: 'Vendeu',
  perdido: 'Lead perdido',
}
const KANBAN_STAGE_OPTIONS = Object.entries(KANBAN_STAGE_LABEL).map(([id, label]) => ({ id, label }))

const STAGE_COLOR = {
  abertura: 'bg-slate-100 text-slate-600',
  qualificacao: 'bg-blue-100 text-blue-700',
  quente: 'bg-emerald-100 text-emerald-700',
  frio: 'bg-cyan-100 text-cyan-700',
  perdido: 'bg-red-100 text-red-700',
  encerrado: 'bg-gray-100 text-gray-500',
}

function ChatSimulator() {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [lastStage, setLastStage] = useState('abertura')
  const [lastTemp, setLastTemp] = useState('morno')
  const messagesRef = useRef(null)

  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight
    }
  }, [messages])

  const clear = () => {
    setMessages([])
    setLastStage('abertura')
    setLastTemp('morno')
  }

  const send = async () => {
    const text = input.trim()
    if (!text || loading) return
    setInput('')

    const userMsg = { role: 'user', content: text }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setLoading(true)

    try {
      const history = newMessages.slice(0, -1).map(m => ({ role: m.role, content: m.content }))
      const res = await fetch(`${API}/settings/sdr-simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history }),
      })
      const data = await res.json()
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data.reply,
        stage: data.stage,
        temperature: data.temperature,
        donaDeSchedule: data.donaDeSchedule,
        action: data.action,
        appointmentDateTime: data.appointmentDateTime,
        shouldIgnore: data.shouldIgnore,
      }])
      setLastStage(data.stage)
      setLastTemp(data.temperature)
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: '⚠️ Erro ao chamar a IA.', stage: lastStage }])
    } finally {
      setLoading(false)
    }
  }

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-indigo-50/60 rounded-xl border border-indigo-100 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-slate-200">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-violet-500 flex items-center justify-center">
            <Bot className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-800">Clara</p>
            <p className="text-[10px] text-slate-400">Simulador de conversa</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${STAGE_COLOR[lastStage] || 'bg-slate-100 text-slate-500'}`}>
            {STAGE_LABEL[lastStage] || lastStage}
          </span>
          <button onClick={clear} title="Limpar conversa" className="p-1.5 text-slate-400 hover:text-red-400 transition">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={messagesRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center text-slate-400 gap-2">
            <MessageCircle className="w-8 h-8 opacity-30" />
            <p className="text-sm">Mande uma mensagem para testar a Clara</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm whitespace-pre-wrap ${
              msg.role === 'user'
                ? 'bg-violet-600 text-white rounded-br-sm'
                : 'bg-white border border-slate-200 text-slate-800 rounded-bl-sm'
            }`}>
              {msg.content}
              {(msg.donaDeSchedule !== undefined && msg.donaDeSchedule !== null) && (
                <p className={`text-[10px] mt-1 font-medium ${msg.donaDeSchedule ? 'text-emerald-600' : 'text-slate-500'}`}>
                  {msg.donaDeSchedule ? '✓ Dona do próprio schedule' : '— Ainda helper'}
                </p>
              )}
              {msg.action === 'schedule' && msg.appointmentDateTime && (
                <p className="text-[10px] mt-0.5 font-medium text-violet-600">📅 Agendado: {msg.appointmentDateTime}</p>
              )}
              {msg.shouldIgnore && (
                <p className="text-[10px] mt-0.5 font-medium text-red-500">⚠️ Encaminhado pra humano</p>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-white border border-slate-200 px-3 py-2 rounded-2xl rounded-bl-sm">
              <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="p-3 bg-white border-t border-slate-200 flex items-end gap-2">
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Digite como se fosse o lead... (Enter para enviar)"
          rows={1}
          className="flex-1 resize-none text-sm border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300 max-h-24"
        />
        <button
          onClick={send}
          disabled={!input.trim() || loading}
          className="p-2.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white rounded-xl transition shrink-0"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

const MODELS = [
  { value: 'gpt-5.4-mini', label: 'GPT-5.4 Mini', description: 'Mais rápido e barato' },
  { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini', description: 'Mais preciso e contextual' },
]

function ModelSelector() {
  const [model, setModel] = useState('gpt-5.4-mini')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch(`${API}/settings/sdr-model`)
      .then(r => r.json())
      .then(d => setModel(d.value || 'gpt-5.4-mini'))
      .catch(() => {})
  }, [])

  const select = async (val) => {
    setModel(val)
    setSaving(true)
    setSaved(false)
    try {
      await fetch(`${API}/settings/sdr-model`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: val }),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {}
    finally { setSaving(false) }
  }

  return (
    <div className="flex items-center gap-3 mb-4">
      <span className="text-xs text-slate-500 font-medium shrink-0">Modelo de IA:</span>
      <div className="flex gap-2">
        {MODELS.map(m => (
          <button
            key={m.value}
            onClick={() => select(m.value)}
            disabled={saving}
            title={m.description}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
              model === m.value
                ? 'bg-violet-600 text-white border-violet-600'
                : 'bg-white text-slate-600 border-slate-200 hover:border-violet-400 hover:text-violet-600'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>
      {saved && <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium"><CheckCircle2 className="w-3.5 h-3.5" /> Salvo</span>}
    </div>
  )
}

function SdrPromptEditor() {
  const [value, setValue] = useState('')
  const [defaultPrompt, setDefaultPrompt] = useState('')
  const [isCustom, setIsCustom] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch(`${API}/settings/sdr-prompt`)
      .then((r) => r.json())
      .then((d) => {
        setValue(d.value || '')
        setDefaultPrompt(d.default || '')
        setIsCustom(!!d.isCustom)
      })
      .catch((e) => console.error('Erro ao carregar prompt', e))
      .finally(() => setLoading(false))
  }, [])

  const save = async () => {
    setSaving(true)
    setSaved(false)
    try {
      const res = await fetch(`${API}/settings/sdr-prompt`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      })
      const d = await res.json()
      setValue(d.value || '')
      setIsCustom(true)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      console.error('Erro ao salvar prompt', e)
    } finally {
      setSaving(false)
    }
  }

  const restoreDefault = () => setValue(defaultPrompt)

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3 shrink-0">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-violet-600" />
          <p className="font-semibold text-slate-800 text-sm">Prompt da IA SDR (Clara)</p>
          {isCustom ? (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 font-medium">Personalizado</span>
          ) : (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 font-medium">Padrão</span>
          )}
        </div>
        <ModelSelector />
      </div>

      {/* Split layout — responsivo */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" style={{ height: '680px' }}>

        {/* Editor */}
        <div className="bg-white rounded-xl border border-slate-200 flex flex-col overflow-hidden h-full">
          {loading ? (
            <div className="flex items-center justify-center flex-1 text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : (
            <>
              <div className="px-3 pt-3 flex-1 flex flex-col min-h-0">
                <p className="text-[10px] text-slate-400 mb-1.5">Edite a personalidade e as regras da Clara</p>
                <textarea
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  spellCheck={false}
                  className="flex-1 text-sm text-slate-700 border border-slate-200 rounded-lg p-3 font-mono leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-violet-300"
                  placeholder="Escreva aqui o prompt da Clara..."
                />
              </div>
              <div className="flex items-center justify-between px-3 py-2.5 border-t border-slate-100 shrink-0">
                <button
                  onClick={restoreDefault}
                  className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 transition"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Restaurar padrão
                </button>
                <div className="flex items-center gap-3">
                  {saved && (
                    <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium">
                      <CheckCircle2 className="w-4 h-4" /> Salvo
                    </span>
                  )}
                  <button
                    onClick={save}
                    disabled={saving || !value.trim()}
                    className="flex items-center gap-1.5 text-xs font-medium text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 px-4 py-2 rounded-lg transition"
                  >
                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    Salvar
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Chat */}
        <div className="overflow-hidden rounded-xl" style={{ height: '680px' }}>
          <ChatSimulator />
        </div>
      </div>
    </div>
  )
}

// Feature desativada pra esse cliente — card fica visível mas cinza/travado.
const IG_CATCHALL_DISABLED = true

function IgCatchallEditor() {
  const [enabled, setEnabled] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [defaultPrompt, setDefaultPrompt] = useState('')
  const [isCustom, setIsCustom] = useState(false)
  const [link, setLink] = useState('')
  const [buttonLabel, setButtonLabel] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch(`${API}/ig-auto/catchall`)
      .then((r) => r.json())
      .then((d) => {
        setEnabled(!!d.enabled)
        setPrompt(d.prompt || '')
        setDefaultPrompt(d.defaultPrompt || '')
        setIsCustom(!!d.isCustomPrompt)
        setLink(d.link || '')
        setButtonLabel(d.buttonLabel || '')
      })
      .catch((e) => console.error('Erro ao carregar config catch-all', e))
      .finally(() => setLoading(false))
  }, [])

  const save = async () => {
    setSaving(true)
    setSaved(false)
    try {
      const res = await fetch(`${API}/ig-auto/catchall`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, prompt, link, buttonLabel }),
      })
      const d = await res.json()
      setEnabled(!!d.enabled)
      setPrompt(d.prompt || '')
      setIsCustom(!!d.isCustomPrompt)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      console.error('Erro ao salvar config catch-all', e)
    } finally {
      setSaving(false)
    }
  }

  const restoreDefault = () => setPrompt(defaultPrompt)

  return (
    <div className={`mb-6 bg-white rounded-xl border border-slate-200 p-5 ${IG_CATCHALL_DISABLED ? 'opacity-50 grayscale pointer-events-none select-none' : ''}`}>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-violet-600" />
          <p className="font-semibold text-slate-800 text-sm">IA de DM direta no Instagram (sem automação específica)</p>
          {IG_CATCHALL_DISABLED ? (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-500 font-medium">Em breve</span>
          ) : isCustom ? (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 font-medium">Personalizado</span>
          ) : (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 font-medium">Padrão</span>
          )}
        </div>
        <button
          onClick={() => setEnabled((v) => !v)}
          disabled={IG_CATCHALL_DISABLED}
          className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition ${enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}
        >
          {enabled ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
          {enabled ? 'Ativado' : 'Desativado'}
        </button>
      </div>
      <p className="text-xs text-slate-400 mb-4">
        Responde qualquer DM que chegar sem vir de um comentário/automação rastreada — ex.: alguém viu o anúncio, mas em vez de ir pro WhatsApp mandou mensagem direto aqui no Instagram.
      </p>

      {loading ? (
        <div className="flex items-center justify-center py-10 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-slate-600">Prompt da IA</label>
              <button onClick={restoreDefault} className="flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-slate-700 transition">
                <RotateCcw className="w-3 h-3" /> Restaurar padrão
              </button>
            </div>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              spellCheck={false}
              rows={10}
              className="w-full text-sm text-slate-700 border border-slate-200 rounded-lg p-3 font-mono leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-violet-300"
              placeholder="Escreva o prompt da IA que atende quem manda DM direto..."
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">Link (ex: wa.me do SDR)</label>
              <input
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="https://wa.me/55..."
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">Label do botão no DM (opcional)</label>
              <input
                value={buttonLabel}
                onChange={(e) => setButtonLabel(e.target.value)}
                placeholder="Ex: Falar com a Clara"
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300"
              />
            </div>
          </div>
          <div className="flex items-center justify-end gap-3">
            {saved && (
              <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium">
                <CheckCircle2 className="w-4 h-4" /> Salvo
              </span>
            )}
            <button
              onClick={save}
              disabled={saving || !prompt.trim()}
              className="flex items-center gap-1.5 text-xs font-medium text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 px-4 py-2 rounded-lg transition"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Salvar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

const EMPTY_RULE = { name: '', enabled: true, kanbanStage: '', utmCampaign: '', adTitle: '', createdAfter: '', delayMinutes: 60, sendAtHour: '', sendAtMinute: 0, mode: 'manual', text: '', videoId: '', videoCaptionOverride: '' }

// 'YYYY-MM-DDTHH:mm' no fuso local, pro valor inicial do <input type="datetime-local">.
function todayStartLocal() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T00:00`
}

function FollowupRuleForm({ initial, campaignOptions, adTitleOptions, videos, onCancel, onSaved }) {
  const [rule, setRule] = useState(initial)
  const [resetCycle, setResetCycle] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const isEditing = Boolean(initial.id)

  const hoursDisplay = rule.delayMinutes >= 60
    ? `${(rule.delayMinutes / 60).toFixed(rule.delayMinutes % 60 === 0 ? 0 : 1)}h`
    : `${rule.delayMinutes}min`

  const hasVideo = Boolean(rule.videoId)
  const selectedVideo = videos.find(v => v.id === rule.videoId)

  const save = async () => {
    setError('')
    if (!rule.name.trim()) { setError('Dê um nome pra regra'); return }
    if (!hasVideo && rule.mode === 'manual' && !rule.text.trim()) { setError('Texto é obrigatório no modo manual'); return }
    setSaving(true)
    try {
      const payload = {
        name: rule.name.trim(),
        enabled: rule.enabled,
        kanbanStage: rule.kanbanStage || null,
        utmCampaign: rule.utmCampaign || null,
        adTitle: rule.adTitle || null,
        createdAfter: rule.createdAfter ? new Date(rule.createdAfter).toISOString() : null,
        delayMinutes: rule.delayMinutes,
        sendAtHour: rule.sendAtHour === '' ? null : parseInt(rule.sendAtHour, 10),
        sendAtMinute: rule.sendAtMinute === '' ? 0 : parseInt(rule.sendAtMinute, 10),
        mode: rule.mode,
        text: rule.text || null,
        videoId: rule.videoId || null,
        videoCaptionOverride: rule.videoCaptionOverride || null,
        resetCycle,
      }
      const res = await fetch(`${API}/followup/rules${isEditing ? `/${rule.id}` : ''}`, {
        method: isEditing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.message || 'Erro ao salvar') }
      const d = await res.json()
      onSaved(d.resetCount > 0 ? `${d.resetCount} lead(s) liberados para novo follow-up` : null)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-violet-50/40 rounded-xl border border-violet-200 p-5 mb-4">
      <div className="mb-4">
        <label className="block text-xs font-medium text-slate-600 mb-1.5">Nome da regra</label>
        <input
          type="text"
          value={rule.name}
          onChange={e => setRule(r => ({ ...r, name: e.target.value }))}
          placeholder="Ex: DIRETO PRO ZAP — qualificados"
          className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300"
        />
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1.5">Raia (kanban)</label>
          <select
            value={rule.kanbanStage}
            onChange={e => setRule(r => ({ ...r, kanbanStage: e.target.value }))}
            className="w-full text-sm border border-slate-200 rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300 bg-white"
          >
            <option value="">Todas as raias</option>
            {KANBAN_STAGE_OPTIONS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1.5">Campanha (utm_campaign)</label>
          <select
            value={rule.utmCampaign}
            onChange={e => setRule(r => ({ ...r, utmCampaign: e.target.value }))}
            className="w-full text-sm border border-slate-200 rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300 bg-white"
          >
            <option value="">Todas as campanhas</option>
            {campaignOptions.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1.5">Criativo (anúncio)</label>
          <select
            value={rule.adTitle}
            onChange={e => setRule(r => ({ ...r, adTitle: e.target.value }))}
            className="w-full text-sm border border-slate-200 rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300 bg-white"
          >
            <option value="">Todos os criativos</option>
            {adTitleOptions.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1.5">Leads a partir de</label>
          <div className="flex gap-1.5">
            <input
              type="datetime-local"
              value={rule.createdAfter}
              onChange={e => setRule(r => ({ ...r, createdAfter: e.target.value }))}
              className="flex-1 text-sm border border-slate-200 rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300 bg-white"
            />
            <button
              type="button"
              onClick={() => setRule(r => ({ ...r, createdAfter: todayStartLocal() }))}
              className="text-[10px] px-2 py-1 rounded-md border bg-white text-slate-500 border-slate-200 hover:border-violet-300 whitespace-nowrap"
            >
              Hoje
            </button>
            {rule.createdAfter && (
              <button
                type="button"
                onClick={() => setRule(r => ({ ...r, createdAfter: '' }))}
                className="text-[10px] px-2 py-1 rounded-md border bg-white text-slate-400 border-slate-200 hover:border-red-300"
              >
                Limpar
              </button>
            )}
          </div>
          <p className="text-[10px] text-slate-400 mt-1">Vazio = sem filtro de data (pega leads antigos também)</p>
        </div>
      </div>

      {/* Delay */}
      <div className="mb-4">
        <label className="block text-xs font-medium text-slate-600 mb-1.5">Tempo de inatividade</label>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={9999}
              value={rule.delayMinutes}
              onChange={e => setRule(r => ({ ...r, delayMinutes: Math.max(1, parseInt(e.target.value) || 1) }))}
              className="w-20 text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-violet-300 text-center"
            />
            <span className="text-xs text-slate-500">minutos</span>
          </div>
          <span className="text-xs text-slate-400">= {hoursDisplay}</span>
          <div className="flex gap-1 ml-auto">
            {[30, 60, 120, 360, 720].map(m => (
              <button
                key={m}
                onClick={() => setRule(r => ({ ...r, delayMinutes: m }))}
                className={`text-[10px] px-2 py-1 rounded-md border transition ${rule.delayMinutes === m ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-slate-500 border-slate-200 hover:border-violet-300'}`}
              >
                {m >= 60 ? `${m / 60}h` : `${m}min`}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Horário preferido de envio — opcional */}
      <div className="mb-4">
        <label className="block text-xs font-medium text-slate-600 mb-1.5">Horário preferido de envio (opcional)</label>
        <div className="flex items-center gap-2">
          <select
            value={rule.sendAtHour}
            onChange={e => setRule(r => ({ ...r, sendAtHour: e.target.value }))}
            className="text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-violet-300 bg-white"
          >
            <option value="">Sem restrição</option>
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>{String(h).padStart(2, '0')}h</option>
            ))}
          </select>
          {rule.sendAtHour !== '' && (
            <select
              value={rule.sendAtMinute}
              onChange={e => setRule(r => ({ ...r, sendAtMinute: parseInt(e.target.value, 10) }))}
              className="text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-violet-300 bg-white"
            >
              {[0, 15, 30, 45].map(m => <option key={m} value={m}>{String(m).padStart(2, '0')}min</option>)}
            </select>
          )}
        </div>
        <p className="text-[10px] text-slate-400 mt-1">
          {rule.sendAtHour === ''
            ? 'Dispara assim que o tempo de inatividade vencer, a qualquer hora.'
            : `Mesmo com o prazo vencido, só dispara às ${String(rule.sendAtHour).padStart(2, '0')}:${String(rule.sendAtMinute).padStart(2, '0')} (hoje se ainda não passou, amanhã se já passou).`}
        </p>
      </div>

      {/* Vídeo (opcional) — se escolhido, manda só o vídeo com legenda */}
      <div className="mb-4">
        <label className="block text-xs font-medium text-slate-600 mb-1.5">Anexar vídeo (opcional)</label>
        <select
          value={rule.videoId}
          onChange={e => setRule(r => ({ ...r, videoId: e.target.value }))}
          className="w-full text-sm border border-slate-200 rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300 bg-white"
        >
          <option value="">Nenhum (mandar texto)</option>
          {videos.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        {hasVideo && (
          <p className="text-[10px] text-slate-400 mt-1">
            Com vídeo, a regra manda só o vídeo com legenda — a mensagem de texto (IA/fixa) é ignorada. Respeita o teto diário de vídeos.
          </p>
        )}
      </div>

      {hasVideo ? (
        <div className="mb-4">
          <label className="block text-xs font-medium text-slate-600 mb-1.5">Legenda do vídeo (opcional)</label>
          <textarea
            value={rule.videoCaptionOverride}
            onChange={e => setRule(r => ({ ...r, videoCaptionOverride: e.target.value }))}
            rows={3}
            placeholder={selectedVideo?.caption ? `Legenda padrão: ${selectedVideo.caption}` : 'Deixe vazio pra usar a legenda padrão do vídeo'}
            className="w-full text-sm border border-slate-200 rounded-lg p-3 resize-none focus:outline-none focus:ring-2 focus:ring-violet-300"
          />
        </div>
      ) : (
        <>
          {/* Mode */}
          <div className="mb-4">
            <label className="block text-xs font-medium text-slate-600 mb-1.5">Tipo de mensagem</label>
            <div className="flex gap-2">
              <button
                onClick={() => setRule(r => ({ ...r, mode: 'manual' }))}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition ${rule.mode === 'manual' ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-slate-600 border-slate-200 hover:border-violet-300'}`}
              >
                Texto fixo
              </button>
              <button
                onClick={() => setRule(r => ({ ...r, mode: 'ai' }))}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition ${rule.mode === 'ai' ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-slate-600 border-slate-200 hover:border-violet-300'}`}
              >
                <Sparkles className="w-3 h-3" /> IA gera automaticamente
              </button>
            </div>
          </div>

          {rule.mode === 'manual' && (
            <div className="mb-4">
              <label className="block text-xs font-medium text-slate-600 mb-1.5">Mensagem de follow-up</label>
              <textarea
                value={rule.text}
                onChange={e => setRule(r => ({ ...r, text: e.target.value }))}
                rows={4}
                placeholder="Ex: Oi! Vi que você não respondeu ainda. Ainda tem interesse em conhecer a Convert Hair AI? 😊"
                className="w-full text-sm border border-slate-200 rounded-lg p-3 resize-none focus:outline-none focus:ring-2 focus:ring-violet-300"
              />
            </div>
          )}

          {rule.mode === 'ai' && (
            <div className="mb-4 bg-violet-50 rounded-lg p-3 border border-violet-100">
              <div className="flex items-center gap-1.5 mb-1">
                <Sparkles className="w-3.5 h-3.5 text-violet-500" />
                <p className="text-xs font-medium text-violet-700">A Clara vai gerar</p>
              </div>
              <p className="text-xs text-violet-600">
                A IA analisa toda a conversa até aquele ponto e cria uma mensagem personalizada para reativar o interesse do lead, sem pressão e de forma natural.
              </p>
            </div>
          )}
        </>
      )}

      {isEditing && (
        <label className="flex items-start gap-2 mb-3 cursor-pointer bg-amber-50/60 border border-amber-100 rounded-lg p-3">
          <input
            type="checkbox"
            checked={resetCycle}
            onChange={e => setResetCycle(e.target.checked)}
            className="mt-0.5 accent-violet-600"
          />
          <span className="text-[11px] text-slate-600">
            <span className="font-medium text-slate-700">Disparar novo ciclo</span> — reenvia pros leads desta raia/campanha que já receberam follow-up e ainda não responderam. Marque ao reconfigurar.
          </span>
        </label>
      )}

      <div className="flex items-center justify-end gap-3">
        {error && <span className="text-xs text-red-600 font-medium">{error}</span>}
        <button onClick={onCancel} className="text-xs font-medium text-slate-500 hover:text-slate-700 px-3 py-2 transition">
          Cancelar
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-1.5 text-xs font-medium text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 px-4 py-2 rounded-lg transition"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          Salvar regra
        </button>
      </div>
    </div>
  )
}

function FollowupRules() {
  const [rules, setRules] = useState([])
  const [campaignOptions, setCampaignOptions] = useState([])
  const [adTitleOptions, setAdTitleOptions] = useState([])
  const [videos, setVideos] = useState([])
  const [videoLimit, setVideoLimit] = useState(15)
  const [savingLimit, setSavingLimit] = useState(false)
  const [limitSaved, setLimitSaved] = useState(false)
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState(null) // null = fechado, 'new' = criando, id = editando
  const [toast, setToast] = useState('')

  const load = () => {
    setLoading(true)
    Promise.all([
      fetch(`${API}/followup/rules`).then(r => r.json()),
      fetch(`${API}/followup/campaign-options`).then(r => r.json()),
      fetch(`${API}/followup/ad-title-options`).then(r => r.json()),
      fetch(`${API}/followup/videos`).then(r => r.json()),
      fetch(`${API}/followup/video-limit`).then(r => r.json()),
    ])
      .then(([rulesData, campaignsData, adTitlesData, videosData, limitData]) => {
        setRules(Array.isArray(rulesData) ? rulesData : [])
        setCampaignOptions(Array.isArray(campaignsData) ? campaignsData : [])
        setAdTitleOptions(Array.isArray(adTitlesData) ? adTitlesData : [])
        setVideos(Array.isArray(videosData) ? videosData : [])
        if (limitData?.limit) setVideoLimit(limitData.limit)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const saveVideoLimit = async () => {
    setSavingLimit(true); setLimitSaved(false)
    try {
      await fetch(`${API}/followup/video-limit`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: videoLimit }),
      })
      setLimitSaved(true)
      setTimeout(() => setLimitSaved(false), 2500)
    } finally { setSavingLimit(false) }
  }

  const toggleEnabled = async (rule) => {
    await fetch(`${API}/followup/rules/${rule.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !rule.enabled }),
    })
    load()
  }

  const remove = async (rule) => {
    if (!confirm(`Excluir a regra "${rule.name}"?`)) return
    await fetch(`${API}/followup/rules/${rule.id}`, { method: 'DELETE' })
    load()
  }

  const onSaved = (msg) => {
    setEditingId(null)
    if (msg) { setToast(msg); setTimeout(() => setToast(''), 4000) }
    load()
  }

  if (loading) return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 mb-6 flex items-center gap-2 text-slate-400">
      <Loader2 className="w-4 h-4 animate-spin" /> Carregando regras de follow-up...
    </div>
  )

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-violet-600" />
          <p className="font-semibold text-slate-800 text-sm">Follow-up Automático</p>
        </div>
        {editingId !== 'new' && (
          <button
            onClick={() => setEditingId('new')}
            className="flex items-center gap-1.5 text-xs font-medium text-violet-600 hover:text-violet-700 transition"
          >
            <Plus className="w-3.5 h-3.5" /> Nova regra
          </button>
        )}
      </div>
      <p className="text-xs text-slate-400 mb-4">
        Se a IA enviou a última mensagem e o lead não responder no prazo, um follow-up dispara automaticamente. Cada regra pode valer só pra uma raia e/ou campanha específica — a regra mais específica que casar com o lead é a usada.
      </p>

      {toast && (
        <div className="mb-4 flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
          <CheckCircle2 className="w-3.5 h-3.5" /> {toast}
        </div>
      )}

      {editingId === 'new' && (
        <FollowupRuleForm
          initial={EMPTY_RULE}
          campaignOptions={campaignOptions}
          adTitleOptions={adTitleOptions}
          videos={videos}
          onCancel={() => setEditingId(null)}
          onSaved={onSaved}
        />
      )}

      {rules.length === 0 && editingId !== 'new' && (
        <p className="text-[11px] text-slate-400 bg-slate-50 rounded-lg p-4 text-center">
          Nenhuma regra configurada ainda. Clique em "Nova regra" pra criar a primeira.
        </p>
      )}

      <div className="space-y-2">
        {rules.map(rule => (
          editingId === rule.id ? (
            <FollowupRuleForm
              key={rule.id}
              initial={{
                ...rule,
                kanbanStage: rule.kanbanStage || '',
                utmCampaign: rule.utmCampaign || '',
                adTitle: rule.adTitle || '',
                createdAfter: rule.createdAfter ? rule.createdAfter.slice(0, 16) : '',
                sendAtHour: rule.sendAtHour != null ? rule.sendAtHour : '',
                sendAtMinute: rule.sendAtMinute ?? 0,
                text: rule.text || '',
                videoId: rule.videoId || '',
                videoCaptionOverride: rule.videoCaptionOverride || '',
              }}
              campaignOptions={campaignOptions}
              adTitleOptions={adTitleOptions}
              videos={videos}
              onCancel={() => setEditingId(null)}
              onSaved={onSaved}
            />
          ) : (
            <div key={rule.id} className="flex items-center justify-between gap-3 border border-slate-200 rounded-lg px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-sm font-medium text-slate-800 truncate">{rule.name}</p>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${rule.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                    {rule.enabled ? 'Ativa' : 'Inativa'}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap text-[10px]">
                  <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-600">
                    <Layers className="w-2.5 h-2.5" /> {rule.kanbanStage ? KANBAN_STAGE_LABEL[rule.kanbanStage] || rule.kanbanStage : 'Todas as raias'}
                  </span>
                  <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-orange-50 text-orange-600">
                    <Tag className="w-2.5 h-2.5" /> {rule.utmCampaign || 'Todas as campanhas'}
                  </span>
                  {rule.adTitle && (
                    <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-cyan-50 text-cyan-700">
                      <Tag className="w-2.5 h-2.5" /> {rule.adTitle}
                    </span>
                  )}
                  {rule.createdAfter && (
                    <span className="px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700">
                      desde {new Date(rule.createdAfter).toLocaleDateString('pt-BR')}
                    </span>
                  )}
                  <span className="px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-500">
                    {rule.delayMinutes >= 60 ? `${(rule.delayMinutes / 60).toFixed(rule.delayMinutes % 60 === 0 ? 0 : 1)}h` : `${rule.delayMinutes}min`}
                  </span>
                  {rule.sendAtHour != null && (
                    <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-indigo-50 text-indigo-600">
                      <Clock className="w-2.5 h-2.5" /> {String(rule.sendAtHour).padStart(2, '0')}:{String(rule.sendAtMinute ?? 0).padStart(2, '0')}
                    </span>
                  )}
                  {rule.videoId ? (
                    <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-pink-50 text-pink-600">
                      <Video className="w-2.5 h-2.5" /> {videos.find(v => v.id === rule.videoId)?.name || 'Vídeo'}
                    </span>
                  ) : (
                    <span className="px-1.5 py-0.5 rounded-md bg-violet-50 text-violet-600">
                      {rule.mode === 'ai' ? 'IA gera' : 'Texto fixo'}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button onClick={() => toggleEnabled(rule)} title={rule.enabled ? 'Desativar' : 'Ativar'} className="transition">
                  {rule.enabled ? <ToggleRight className="w-7 h-7 text-violet-600" /> : <ToggleLeft className="w-7 h-7 text-slate-300" />}
                </button>
                <button onClick={() => setEditingId(rule.id)} title="Editar" className="p-1.5 text-slate-400 hover:text-violet-600 transition">
                  <Pencil className="w-4 h-4" />
                </button>
                <button onClick={() => remove(rule)} title="Excluir" className="p-1.5 text-slate-400 hover:text-red-600 transition">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          )
        ))}
      </div>

      {/* Teto diário de envio de vídeo */}
      <div className="mt-5 pt-4 border-t border-slate-100">
        <label className="flex items-center gap-1.5 text-xs font-medium text-slate-600 mb-2">
          <Video className="w-3.5 h-3.5 text-pink-500" /> Limite diário de vídeos no follow-up
        </label>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min={1}
            max={999}
            value={videoLimit}
            onChange={e => setVideoLimit(Math.max(1, parseInt(e.target.value) || 1))}
            className="w-24 text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 text-center focus:outline-none focus:ring-2 focus:ring-violet-300"
          />
          <span className="text-xs text-slate-400">vídeos/dia (protege o número de bloqueio; reseta à meia-noite)</span>
          <button
            onClick={saveVideoLimit}
            disabled={savingLimit}
            className="ml-auto flex items-center gap-1.5 text-xs font-medium text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 px-3 py-1.5 rounded-lg transition"
          >
            {savingLimit ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Salvar
          </button>
          {limitSaved && <span className="flex items-center gap-1 text-xs text-emerald-600"><CheckCircle2 className="w-3.5 h-3.5" /> Salvo</span>}
        </div>
      </div>
    </div>
  )
}

// Helpers de tempo (timestamps vêm em UTC, JS converte pro fuso local)
function timeAgo(date, now) {
  if (!date) return '—'
  const diff = Math.floor((now - new Date(date).getTime()) / 1000)
  if (diff < 0) return 'agora'
  if (diff < 60) return `há ${diff}s`
  if (diff < 3600) return `há ${Math.floor(diff / 60)}min`
  if (diff < 86400) return `há ${Math.floor(diff / 3600)}h`
  return `há ${Math.floor(diff / 86400)}d`
}

function countdown(dueAt, now) {
  const ms = new Date(dueAt).getTime() - now
  if (ms <= 0) return { text: 'no próximo ciclo', overdue: true }
  const s = Math.floor(ms / 1000)
  if (s < 3600) {
    const mm = String(Math.floor(s / 60)).padStart(2, '0')
    const ss = String(s % 60).padStart(2, '0')
    return { text: `${mm}:${ss}`, overdue: false }
  }
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return { text: `${h}h ${m}min`, overdue: false }
}

function fmtDateTime(date) {
  if (!date) return '—'
  return new Date(date).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function firstName(name) {
  return (name || 'Lead').split(' ')[0]
}

function FollowupStatus() {
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(Date.now())

  const fetchStatus = () => {
    fetch(`${API}/followup/status`)
      .then(r => r.json())
      .then(d => setStatus(d))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchStatus()
    const refetch = setInterval(fetchStatus, 15000) // recarrega dados do servidor
    const tick = setInterval(() => setNow(Date.now()), 1000) // contador ao vivo
    return () => { clearInterval(refetch); clearInterval(tick) }
  }, [])

  if (loading) return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 mb-6 flex items-center gap-2 text-slate-400">
      <Loader2 className="w-4 h-4 animate-spin" /> Carregando status...
    </div>
  )

  if (!status) return null

  const wa = status.whatsappConnected

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-violet-600" />
          <p className="font-semibold text-slate-800 text-sm">Status do Follow-up</p>
        </div>
        <button onClick={fetchStatus} className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-violet-600 transition" title="Atualizar agora">
          <RefreshCw className="w-3.5 h-3.5" /> Atualizar
        </button>
      </div>

      {/* Cards de resumo */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        {/* WhatsApp */}
        <div className={`rounded-lg p-3 border ${wa === false ? 'bg-red-50 border-red-200' : wa ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-200'}`}>
          <div className="flex items-center gap-1.5 mb-1">
            {wa ? <Wifi className="w-3.5 h-3.5 text-emerald-600" /> : <WifiOff className="w-3.5 h-3.5 text-red-500" />}
            <span className="text-[10px] font-medium text-slate-500 uppercase">WhatsApp</span>
          </div>
          <p className={`text-sm font-semibold ${wa === false ? 'text-red-600' : wa ? 'text-emerald-700' : 'text-slate-500'}`}>
            {wa === null ? 'Sem token' : wa ? 'Conectado' : 'Desconectado'}
          </p>
          {status.whatsappName && <p className="text-[10px] text-slate-400 truncate">{status.whatsappName}</p>}
        </div>

        {/* Estado */}
        {(() => {
          const activeCount = (status.rules || []).filter(r => r.enabled).length
          return (
            <div className={`rounded-lg p-3 border ${activeCount > 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-200'}`}>
              <div className="flex items-center gap-1.5 mb-1">
                <Clock className="w-3.5 h-3.5 text-slate-500" />
                <span className="text-[10px] font-medium text-slate-500 uppercase">Follow-up</span>
              </div>
              <p className={`text-sm font-semibold ${activeCount > 0 ? 'text-emerald-700' : 'text-slate-500'}`}>
                {activeCount > 0 ? `${activeCount} regra(s) ativa(s)` : 'Nenhuma regra ativa'}
              </p>
              <p className="text-[10px] text-slate-400">{(status.rules || []).length} regra(s) no total</p>
            </div>
          )
        })()}

        {/* Última verificação */}
        <div className="rounded-lg p-3 border bg-slate-50 border-slate-200">
          <div className="flex items-center gap-1.5 mb-1">
            <RefreshCw className="w-3.5 h-3.5 text-slate-500" />
            <span className="text-[10px] font-medium text-slate-500 uppercase">Última checagem</span>
          </div>
          <p className="text-sm font-semibold text-slate-700">{timeAgo(status.lastRunAt, now)}</p>
          <p className="text-[10px] text-slate-400">verifica a cada 5 min</p>
        </div>

        {/* Enviados */}
        <div className="rounded-lg p-3 border bg-violet-50 border-violet-200">
          <div className="flex items-center gap-1.5 mb-1">
            <Send className="w-3.5 h-3.5 text-violet-600" />
            <span className="text-[10px] font-medium text-slate-500 uppercase">Enviados</span>
          </div>
          <p className="text-sm font-semibold text-violet-700">{status.totalSent ?? status.sent.length}</p>
          <p className="text-[10px] text-slate-400">total de follow-ups</p>
        </div>
      </div>

      {/* Aguardando — contador ao vivo (só lead que casa com alguma regra ativa) */}
      <div className="mb-4">
        <p className="text-xs font-semibold text-slate-600 mb-1 flex items-center gap-1.5">
          <Timer className="w-3.5 h-3.5 text-amber-500" /> Aguardando follow-up ({status.waiting.length})
        </p>
        {status.noRuleCount > 0 && (
          <p className="text-[10px] text-slate-400 mb-2">
            + {status.noRuleCount} lead(s) sem nenhuma regra correspondente (não aparecem aqui — não vão receber follow-up)
          </p>
        )}
        {status.waiting.length === 0 ? (
          <p className="text-[11px] text-slate-400 bg-slate-50 rounded-lg p-3 text-center">
            Nenhum lead na fila casando com uma regra ativa no momento.
          </p>
        ) : (
          <div className="space-y-1.5">
            {status.waiting.map(l => {
              const cd = l.dueAt ? countdown(l.dueAt, now) : null
              return (
                <div key={l.id} className="flex items-center justify-between bg-amber-50/60 border border-amber-100 rounded-lg px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-slate-700 truncate">{firstName(l.name)}</p>
                    <p className="text-[10px] text-slate-400">última msg {timeAgo(l.waLastMessageAt, now)}</p>
                    {l.ruleName && <p className="text-[10px] text-violet-500 truncate">regra: {l.ruleName}</p>}
                  </div>
                  {cd ? (
                    <span className={`text-xs font-mono font-semibold tabular-nums px-2 py-1 rounded-md flex-shrink-0 ${cd.overdue ? 'bg-violet-100 text-violet-700' : 'bg-white text-amber-700 border border-amber-200'}`}>
                      {cd.overdue ? cd.text : `⏱ ${cd.text}`}
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-400 flex-shrink-0">sem regra</span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Enviados — lista */}
      {status.sent.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-600 mb-2 flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> Follow-ups enviados ({status.totalSent ?? status.sent.length})
            {(status.totalSent ?? 0) > status.sent.length && (
              <span className="text-[10px] font-normal text-slate-400">— exibindo os 20 mais recentes</span>
            )}
          </p>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {status.sent.map(l => (
              <div key={l.id} className="flex items-center justify-between bg-emerald-50/50 border border-emerald-100 rounded-lg px-3 py-2">
                <p className="text-xs font-medium text-slate-700 truncate">{firstName(l.name)}</p>
                <span className="text-[10px] text-emerald-700 font-medium">{fmtDateTime(l.followupSentAt)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function NotifyPhonesConfig() {
  const [phone1, setPhone1] = useState('')
  const [phone2, setPhone2] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch(`${API}/settings/sdr-notify`)
      .then(r => r.json())
      .then(d => { setPhone1(d.phone1 || ''); setPhone2(d.phone2 || '') })
      .finally(() => setLoading(false))
  }, [])

  const save = async () => {
    setSaving(true)
    setSaved(false)
    try {
      await fetch(`${API}/settings/sdr-notify`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone1, phone2 }),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-4">
      <div className="flex items-center gap-2 mb-4">
        <MessageCircle className="w-5 h-5 text-emerald-500" />
        <div>
          <p className="font-semibold text-slate-800 text-sm">Notificação de Lead Qualificado</p>
          <p className="text-xs text-slate-400 mt-0.5">Números que recebem aviso no WhatsApp quando um lead vira qualificado (MQL)</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-slate-400 text-sm py-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Carregando...
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Número 1 (com DDI, ex: 5571999999999)</label>
            <input
              type="tel"
              value={phone1}
              onChange={e => setPhone1(e.target.value.replace(/\D/g, ''))}
              placeholder="5571999999999"
              className="w-full text-sm border border-slate-200 rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-300"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Número 2 (opcional)</label>
            <input
              type="tel"
              value={phone2}
              onChange={e => setPhone2(e.target.value.replace(/\D/g, ''))}
              placeholder="5511999999999"
              className="w-full text-sm border border-slate-200 rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-300"
            />
          </div>
          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={save}
              disabled={saving}
              className="flex items-center gap-2 text-sm font-medium bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-200 text-white px-4 py-2 rounded-xl transition"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {saving ? 'Salvando...' : 'Salvar'}
            </button>
            {saved && (
              <span className="flex items-center gap-1.5 text-emerald-600 text-sm font-medium">
                <CheckCircle2 className="w-4 h-4" /> Salvo!
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const AVAILABILITY_WEEKDAYS_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const AVAILABILITY_MONTHS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

function pad2(n) { return String(n).padStart(2, '0') }

// "14:00" → "2:00 PM" — agenda do Marcel é em padrão EUA (AM/PM).
function formatAmPm(hhmm) {
  if (!hhmm) return hhmm
  const [h, m] = hhmm.split(':').map(Number)
  const period = h < 12 ? 'AM' : 'PM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${period}`
}

function AvailabilityDayModal({ dateStr, dayLabel, rulesForDay, onClose, onChanged }) {
  const [startTime, setStartTime] = useState('08:00')
  const [endTime, setEndTime] = useState('18:00')
  const [slotMinutes, setSlotMinutes] = useState(60)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const addRange = async () => {
    if (!startTime || !endTime) { setError('Preencha início e fim'); return }
    setSaving(true); setError('')
    try {
      const res = await fetch(`${API}/availability/rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ specificDate: dateStr, startTime, endTime, slotMinutes: Number(slotMinutes) || 60 }),
      })
      if (!res.ok) throw new Error('Falha ao salvar')
      onChanged()
    } catch (err) {
      setError(err.message || 'Erro ao salvar')
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (rule) => {
    await fetch(`${API}/availability/rules/${rule.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !rule.active }),
    })
    onChanged()
  }

  const removeRange = async (rule) => {
    if (!confirm(`Remover o horário ${formatAmPm(rule.startTime)}-${formatAmPm(rule.endTime)}?`)) return
    await fetch(`${API}/availability/rules/${rule.id}`, { method: 'DELETE' })
    onChanged()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-bold text-gray-800 capitalize">{dayLabel}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {rulesForDay.length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Horários cadastrados</p>
              {rulesForDay.map(r => (
                <div key={r.id} className="flex items-center justify-between border border-gray-200 rounded-lg px-3 py-2">
                  <div className="text-sm">
                    <span className={r.active ? 'text-gray-800 font-medium' : 'text-gray-400 line-through'}>{formatAmPm(r.startTime)} – {formatAmPm(r.endTime)}</span>
                    <span className="text-gray-400 text-xs ml-2">({r.slotMinutes}min/slot)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => toggleActive(r)} title={r.active ? 'Desativar' : 'Ativar'}>
                      {r.active ? <ToggleRight className="w-5 h-5 text-violet-600" /> : <ToggleLeft className="w-5 h-5 text-gray-300" />}
                    </button>
                    <button onClick={() => removeRange(r)} className="text-gray-400 hover:text-red-600 transition">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div>
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Adicionar horário</p>
            <div className="grid grid-cols-3 gap-2">
              <input
                type="time"
                lang="en-US"
                value={startTime}
                onChange={e => setStartTime(e.target.value)}
                className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
              <input
                type="time"
                lang="en-US"
                value={endTime}
                onChange={e => setEndTime(e.target.value)}
                className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min="15"
                  step="15"
                  value={slotMinutes}
                  onChange={e => setSlotMinutes(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
                <span className="text-[10px] text-gray-400 shrink-0">min</span>
              </div>
            </div>
            {error && <p className="text-[11px] text-red-600 mt-1">{error}</p>}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-100 bg-gray-50">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-200 rounded-lg transition">
            Fechar
          </button>
          <button
            onClick={addRange}
            disabled={saving}
            className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition"
          >
            {saving ? 'Salvando...' : 'Adicionar horário'}
          </button>
        </div>
      </div>
    </div>
  )
}

function AvailabilityCalendar() {
  const [cursor, setCursor] = useState(() => {
    const d = new Date()
    return { year: d.getFullYear(), month: d.getMonth() + 1 }
  })
  const [rules, setRules] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedDate, setSelectedDate] = useState(null)

  const load = () => {
    setLoading(true)
    fetch(`${API}/availability/rules`)
      .then(r => r.json())
      .then(data => setRules(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const prevMonth = () => setCursor(c => c.month === 1 ? { year: c.year - 1, month: 12 } : { year: c.year, month: c.month - 1 })
  const nextMonth = () => setCursor(c => c.month === 12 ? { year: c.year + 1, month: 1 } : { year: c.year, month: c.month + 1 })

  const firstOfMonth = new Date(cursor.year, cursor.month - 1, 1)
  const daysInMonth = new Date(cursor.year, cursor.month, 0).getDate()
  const startWeekday = firstOfMonth.getDay()
  const cells = []
  for (let i = 0; i < startWeekday; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)

  const rulesByDate = {}
  for (const r of rules) {
    if (!r.specificDate) continue
    const key = r.specificDate.slice(0, 10)
    if (!rulesByDate[key]) rulesByDate[key] = []
    rulesByDate[key].push(r)
  }

  const today = new Date()
  const isToday = (day) => day === today.getDate() && cursor.month === today.getMonth() + 1 && cursor.year === today.getFullYear()
  const dateStrFor = (day) => `${cursor.year}-${pad2(cursor.month)}-${pad2(day)}`

  const selectedRules = selectedDate ? (rulesByDate[selectedDate] || []) : []
  const selectedLabel = selectedDate
    ? new Date(`${selectedDate}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })
    : ''

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
      <div className="flex items-center gap-2 mb-2">
        <Calendar className="w-4 h-4 text-violet-600" />
        <p className="font-semibold text-slate-800 text-sm">Disponibilidade do Marcel (agenda da Clara)</p>
      </div>
      <p className="text-xs text-slate-400 mb-4">
        Clique num dia do calendário pra marcar os horários disponíveis pra Sessão de Mentoria naquela data — a Clara só oferece e confirma agendamento dentro do que estiver aqui, nunca inventa horário.
      </p>

      {loading ? (
        <div className="flex items-center justify-center gap-2 text-slate-400 text-sm py-8">
          <Loader2 className="w-4 h-4 animate-spin" /> Carregando disponibilidade...
        </div>
      ) : (
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50">
            <button onClick={prevMonth} className="p-1.5 hover:bg-slate-200 rounded-lg transition">
              <ChevronLeft className="w-4 h-4 text-slate-500" />
            </button>
            <p className="text-sm font-bold text-slate-800">
              {AVAILABILITY_MONTHS[cursor.month - 1]} <span className="font-normal text-slate-400">{cursor.year}</span>
            </p>
            <button onClick={nextMonth} className="p-1.5 hover:bg-slate-200 rounded-lg transition">
              <ChevronRight className="w-4 h-4 text-slate-500" />
            </button>
          </div>
          <div className="grid grid-cols-7 border-b border-slate-100">
            {AVAILABILITY_WEEKDAYS_SHORT.map(w => (
              <div key={w} className="text-center py-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">{w}</div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((day, i) => {
              const dateStr = day ? dateStrFor(day) : null
              const dayRules = dateStr ? (rulesByDate[dateStr] || []) : []
              const activeCount = dayRules.filter(r => r.active).length
              return (
                <div
                  key={i}
                  onClick={() => day && setSelectedDate(dateStr)}
                  className={`min-h-[68px] border-r border-b border-slate-100 p-1.5 ${!day ? 'bg-slate-50/50' : 'hover:bg-violet-50/40 cursor-pointer transition'}`}
                >
                  {day && (
                    <>
                      <div className={`text-xs font-semibold mb-1 w-5 h-5 flex items-center justify-center rounded-full ${isToday(day) ? 'bg-violet-600 text-white' : 'text-slate-600'}`}>
                        {day}
                      </div>
                      {activeCount > 0 && (
                        <span className="text-[9px] bg-violet-100 text-violet-700 rounded px-1 py-0.5 inline-block">
                          {activeCount} horário{activeCount > 1 ? 's' : ''}
                        </span>
                      )}
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {selectedDate && (
        <AvailabilityDayModal
          dateStr={selectedDate}
          dayLabel={selectedLabel}
          rulesForDay={selectedRules}
          onClose={() => setSelectedDate(null)}
          onChanged={load}
        />
      )}
    </div>
  )
}

export default function Settings() {
  return (
    <div className="p-6 overflow-y-auto">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-slate-800">Configurações</h2>
        <p className="text-sm text-slate-400 mt-0.5">Integrações e configurações da plataforma</p>
      </div>

      <SdrPromptEditor />

      <IgCatchallEditor />

      <NotifyPhonesConfig />

      <AvailabilityCalendar />

      <FollowupRules />

      <FollowupStatus />

      <div>
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Integrações</p>
        <div className="space-y-3">
          {integrations.map(({ icon: Icon, label, description, color, status }) => (
            <div key={label} className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-4">
              <div className={`w-10 h-10 rounded-lg ${color} flex items-center justify-center shrink-0`}>
                <Icon className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-slate-800 text-sm">{label}</p>
                <p className="text-xs text-slate-400 mt-0.5 truncate">{description}</p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-xs text-slate-400">{status}</span>
                <button className="text-xs font-medium text-violet-600 hover:text-violet-700 border border-violet-200 hover:border-violet-400 px-3 py-1.5 rounded-lg transition">
                  Conectar
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
