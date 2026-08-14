import { useState, useEffect, useRef } from 'react'
import {
  X, MessageCircle, PauseCircle, Bot, Paperclip, Send, FileText, Video,
  StickyNote, ChevronDown, ChevronUp, CheckCircle2, Loader2,
} from 'lucide-react'
import { formatPhone, timeAgo, TEMP_BADGE } from '../lib/leadFormat'
import Avatar from './Avatar'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3002/api'
const MAX_MEDIA_BYTES = 5 * 1024 * 1024 // 5 MB

function mediaIcon(type) {
  if (type === 'image') return null // rendered as <img>
  if (type === 'video') return <Video className="w-4 h-4" />
  return <FileText className="w-4 h-4" />
}

// A bolha mostra só hora:minuto, então mensagens de dias diferentes pareciam
// consecutivas (ex.: follow-up de 21:37 e o do dia seguinte às 21:38 lidos como
// "dois disparos seguidos"). Estas duas funções agrupam por dia em BRT pra
// renderizar um separador entre os dias.
function dayKeyBRT(ts) {
  if (!ts) return null
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return null
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d)
}

function dayLabel(key) {
  const today = dayKeyBRT(new Date())
  const yesterday = dayKeyBRT(new Date(Date.now() - 86400000))
  if (key === today) return 'Hoje'
  if (key === yesterday) return 'Ontem'
  // key vem como 'YYYY-MM-DD' (en-CA); monta meio-dia UTC pra não escorregar de dia.
  const [y, m, d] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('pt-BR', {
    day: '2-digit', month: 'short', year: y === new Date().getFullYear() ? undefined : 'numeric',
  })
}

/**
 * Painel de conversa de um lead — header (avatar/telefone/badges), notas
 * internas, thread com histórico (aiContext) e composer com mídia. Extraído
 * de KanbanLeads.jsx (ConversationModal) pra ser reusado tanto no modal do
 * Kanban quanto no Inbox WhatsApp (lista + conversa lado a lado, sem modal).
 *
 * `showCloseButton`/`onClose` só fazem sentido no uso em modal — no Inbox,
 * trocar de lead só troca o conteúdo do painel, não fecha nada.
 */
export default function LeadConversationPanel({
  lead,
  onClose,
  onTogglePause,
  onAssign,
  onSaveNotes,
  showCloseButton = true,
}) {
  // Hooks sempre chamados, mesmo com lead=null — o guard de "não renderiza
  // nada" vem DEPOIS de todos os hooks (ver `if (!lead) return null` abaixo),
  // senão viola a regra de hooks assim que um caller passar lead null/undefined
  // (ex.: troca de conversa no Inbox antes do primeiro select).
  const ctx = Array.isArray(lead?.aiContext) ? lead.aiContext : []
  const paused = !!lead?.aiPaused
  const [assignedTo, setAssignedTo] = useState(lead?.assignedTo || '')
  const [notes, setNotes] = useState(lead?.notes || '')
  const [notesOpen, setNotesOpen] = useState(!!lead?.notes)
  const [notesSaved, setNotesSaved] = useState(false)
  const [draft, setDraft] = useState('')
  const [pendingMedia, setPendingMedia] = useState(null) // { type, base64, dataUrl, filename, mimeType }
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const chatBottomRef = useRef(null)
  const textareaRef = useRef(null)
  const fileInputRef = useRef(null)

  // Reseta os campos locais (assunto/notas) sempre que troca de lead — sem
  // isso, no Inbox (onde o componente não é remontado por key), o draft de
  // "notas"/"vendedor" do lead anterior vazaria pro próximo selecionado.
  useEffect(() => {
    setAssignedTo(lead?.assignedTo || '')
    setNotes(lead?.notes || '')
    setNotesOpen(!!lead?.notes)
    setDraft('')
    setPendingMedia(null)
    setSendError('')
  }, [lead?.id])

  // Scroll para o final sempre que chegar nova mensagem
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [ctx.length])

  // Lead ainda sem foto de perfil ou com nome placeholder ("Lead 3333") —
  // busca uma vez ao abrir a conversa; o resultado chega via socket (lead:updated).
  useEffect(() => {
    if (!lead) return
    if (!lead.avatarUrl || /^Lead \d+$/.test(lead.name || '')) {
      fetch(`${API}/leads/${lead.id}/fetch-avatar`, { method: 'POST' }).catch(() => {})
    }
  }, [lead?.id])

  if (!lead) return null

  const saveAssign = () => {
    const val = assignedTo.trim() || null
    if (val !== (lead.assignedTo || null)) onAssign(lead.id, val)
  }

  const saveNotes = () => {
    const val = notes.trim() || null
    if (val === (lead.notes || null)) return
    onSaveNotes(lead.id, val)
    setNotesSaved(true)
    setTimeout(() => setNotesSaved(false), 2000)
  }

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    if (file.size > MAX_MEDIA_BYTES) {
      setSendError('Arquivo muito grande (máx. 5 MB)')
      return
    }

    const reader = new FileReader()
    reader.onload = (ev) => {
      const dataUrl = ev.target.result // "data:image/jpeg;base64,..."
      const base64 = dataUrl.split(',')[1]
      const type = file.type.startsWith('image/') ? 'image'
        : file.type.startsWith('video/') ? 'video'
        : file.type.startsWith('audio/') ? 'audio'
        : 'document'
      setPendingMedia({ type, base64, dataUrl, filename: file.name, mimeType: file.type })
      setSendError('')
    }
    reader.readAsDataURL(file)
  }

  const handleSend = async () => {
    if (sending) return
    const hasText = draft.trim().length > 0
    const hasMedia = !!pendingMedia
    if (!hasText && !hasMedia) return

    setSending(true)
    setSendError('')

    try {
      let body
      if (hasMedia) {
        body = {
          type: pendingMedia.type,
          base64: pendingMedia.base64,
          mimeType: pendingMedia.mimeType,
          filename: pendingMedia.filename,
          caption: draft.trim(),
        }
      } else {
        body = { type: 'text', text: draft.trim() }
      }

      const res = await fetch(`${API}/leads/${lead.id}/send-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.message || `Erro ${res.status}`)
      }

      setDraft('')
      setPendingMedia(null)
    } catch (err) {
      setSendError(err.message || 'Falha ao enviar')
    } finally {
      setSending(false)
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // Auto-height do textarea
  const handleDraftChange = (e) => {
    setDraft(e.target.value)
    const ta = textareaRef.current
    if (ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 96) + 'px' }
  }

  return (
    <div className="h-full flex flex-col bg-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-200">
        <Avatar lead={lead} size="w-11 h-11 text-sm" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-slate-800 truncate text-[15px]">{lead.name}</p>
          <p className="text-xs text-slate-500">{formatPhone(lead.phone)}</p>
        </div>
        <div className="flex items-center gap-1.5">
          {lead.isMql && <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">🎯 MQL</span>}
          {TEMP_BADGE[lead.temperature] && (
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${TEMP_BADGE[lead.temperature].className}`}>
              {TEMP_BADGE[lead.temperature].label}
            </span>
          )}
        </div>
        {showCloseButton && onClose && (
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition ml-1">
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Controles */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 bg-slate-50 gap-4">
        <div className="flex items-center gap-2 text-sm flex-1">
          {paused ? (
            <span className="flex items-center gap-1.5 text-amber-600 font-medium">
              <PauseCircle className="w-4 h-4" /> IA pausada — você assume a conversa
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-emerald-600 font-medium">
              <Bot className="w-4 h-4" /> IA respondendo automaticamente
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <input
            type="text"
            value={assignedTo}
            onChange={e => setAssignedTo(e.target.value)}
            onBlur={saveAssign}
            onKeyDown={e => e.key === 'Enter' && saveAssign()}
            placeholder="Vendedor responsável..."
            className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 w-44 focus:outline-none focus:ring-2 focus:ring-violet-300 bg-white"
          />
          <button
            onClick={() => setNotesOpen(o => !o)}
            className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border transition ${
              notesOpen || lead.notes
                ? 'bg-amber-50 border-amber-200 text-amber-700'
                : 'border-slate-200 text-slate-500 hover:bg-slate-100'
            }`}
            title="Anotações internas sobre o lead"
          >
            <StickyNote className="w-3.5 h-3.5" />
            Notas
            {notesOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          <button
            onClick={() => onTogglePause(lead)}
            className="flex items-center gap-2 text-xs font-medium text-slate-600 shrink-0"
            title={paused ? 'Reativar IA' : 'Pausar IA'}
          >
            <span>{paused ? 'Pausada' : 'Ativa'}</span>
            <span className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${paused ? 'bg-slate-300' : 'bg-emerald-500'}`}>
              <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${paused ? 'translate-x-0.5' : 'translate-x-[22px]'}`} />
            </span>
          </button>
        </div>
      </div>

      {/* Painel de notas internas */}
      {notesOpen && (
        <div className="px-5 py-3 border-b border-slate-200 bg-amber-50/50">
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            onBlur={saveNotes}
            placeholder="Anotações internas sobre esse lead (visível só para a equipe)..."
            rows={3}
            className="w-full resize-none text-sm border border-amber-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-300 bg-white placeholder:text-slate-400"
          />
          {notesSaved && (
            <span className="flex items-center gap-1 text-[11px] text-emerald-600 mt-1">
              <CheckCircle2 className="w-3 h-3" /> Nota salva
            </span>
          )}
        </div>
      )}

      {/* Conversa */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 bg-slate-50">
        {ctx.length === 0 && (
          <div className="flex flex-col items-center justify-center text-slate-400 py-16 gap-2">
            <MessageCircle className="w-9 h-9" />
            <p className="text-sm">Nenhuma mensagem ainda</p>
          </div>
        )}
        {ctx.map((m, i) => {
          const isLead = m.role === 'user'
          const isOperator = m.role === 'assistant' && m.source === 'operator'
          // Separador quando vira o dia (ou na 1ª mensagem que tem timestamp).
          const key = dayKeyBRT(m.timestamp)
          const prevKey = i > 0 ? dayKeyBRT(ctx[i - 1].timestamp) : null
          const showDaySeparator = key && key !== prevKey
          return (
            <div key={i}>
            {showDaySeparator && (
              <div className="flex items-center gap-2 py-2">
                <div className="flex-1 h-px bg-slate-200" />
                <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wide">{dayLabel(key)}</span>
                <div className="flex-1 h-px bg-slate-200" />
              </div>
            )}
            <div className={`flex ${isLead ? 'justify-start' : 'justify-end'}`}>
              <div
                className={`max-w-[72%] px-3.5 py-2 rounded-2xl text-sm break-words ${
                  isLead
                    ? 'bg-white border border-slate-200 text-slate-700 rounded-tl-sm'
                    : isOperator
                    ? 'bg-violet-500 text-white rounded-tr-sm'
                    : 'bg-emerald-500 text-white rounded-tr-sm'
                }`}
              >
                {/* Mídia inline */}
                {m.mediaType === 'image' && m.base64 && (
                  <img
                    src={m.base64.startsWith('data:') ? m.base64 : `data:image/jpeg;base64,${m.base64}`}
                    alt="imagem"
                    className="rounded-lg mb-1.5 max-w-full max-h-48 object-cover"
                  />
                )}
                {m.mediaType === 'video' && m.mediaUrl && (
                  <video
                    src={m.mediaUrl}
                    controls
                    preload="metadata"
                    className="rounded-lg mb-1.5 max-w-full max-h-56"
                  />
                )}
                {m.mediaType && !(m.mediaType === 'image' && m.base64) && !(m.mediaType === 'video' && m.mediaUrl) && (
                  <div className="flex items-center gap-1.5 mb-1 opacity-90">
                    {mediaIcon(m.mediaType)}
                    <span className="text-xs font-medium truncate max-w-[180px]">{m.filename || m.mediaType}</span>
                  </div>
                )}
                {m.mediaType === 'video' && m.mediaUrl ? (
                  m.caption && <p className="whitespace-pre-wrap">{m.caption}</p>
                ) : (
                  m.content && <p className="whitespace-pre-wrap">{m.content}</p>
                )}
                <div className={`text-[9px] mt-0.5 ${isLead ? 'text-slate-400' : isOperator ? 'text-violet-200' : 'text-emerald-100'}`}>
                  {isLead ? lead.name.split(' ')[0] : isOperator ? 'Você' : 'SDR IA'}
                  {m.timestamp && (
                    <span className="ml-1.5 opacity-80">
                      {new Date(m.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })}
                    </span>
                  )}
                </div>
              </div>
            </div>
            </div>
          )
        })}
        <div ref={chatBottomRef} />
      </div>

      {/* Chat Input */}
      <div className="px-4 pt-3 pb-3 border-t border-slate-200 bg-white">
        {/* Preview de mídia pendente */}
        {pendingMedia && (
          <div className="mb-2 flex items-center gap-2 p-2 bg-slate-50 border border-slate-200 rounded-xl">
            {pendingMedia.type === 'image' ? (
              <img src={pendingMedia.dataUrl} alt="" className="h-14 w-14 object-cover rounded-lg shrink-0" />
            ) : (
              <div className="flex items-center gap-1.5 text-slate-600">
                {mediaIcon(pendingMedia.type)}
                <span className="text-xs font-medium truncate max-w-[200px]">{pendingMedia.filename}</span>
              </div>
            )}
            <button
              onClick={() => setPendingMedia(null)}
              className="ml-auto p-1 text-slate-400 hover:text-red-500 transition shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {sendError && (
          <p className="text-xs text-red-500 mb-1.5">{sendError}</p>
        )}

        <div className="flex items-end gap-2">
          {/* Botão de mídia */}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="p-2 text-slate-400 hover:text-violet-500 transition shrink-0"
            title="Enviar imagem, vídeo ou documento (máx. 5 MB)"
          >
            <Paperclip className="w-5 h-5" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt"
            onChange={handleFileSelect}
          />

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={handleDraftChange}
            onKeyDown={handleKeyDown}
            placeholder={pendingMedia ? 'Legenda (opcional)...' : 'Digite uma mensagem... (Enter envia, Shift+Enter quebra linha)'}
            rows={1}
            className="flex-1 resize-none bg-slate-100 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300 placeholder:text-slate-400"
            style={{ minHeight: '40px', maxHeight: '96px' }}
          />

          {/* Botão enviar */}
          <button
            onClick={handleSend}
            disabled={sending || (!draft.trim() && !pendingMedia)}
            className="p-2.5 bg-violet-500 hover:bg-violet-600 disabled:bg-slate-200 disabled:cursor-not-allowed text-white rounded-xl transition shrink-0"
            title="Enviar"
          >
            {sending
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Send className="w-4 h-4" />
            }
          </button>
        </div>

        <p className="text-[10px] text-slate-400 mt-1.5 text-center">
          Estágio: <span className="font-medium text-slate-500">{lead.waStage || '—'}</span>
          {' · '}Última msg {timeAgo(lead.waLastMessageAt || lead.createdAt)}
        </p>
      </div>
    </div>
  )
}
