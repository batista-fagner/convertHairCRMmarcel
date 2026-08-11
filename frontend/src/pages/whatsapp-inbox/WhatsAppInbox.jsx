import { useCallback, useEffect, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import { MessageSquare } from 'lucide-react'
import LeadConversationList from './components/LeadConversationList'
import LeadConversationPanel from '../../components/LeadConversationPanel'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3002/api'
const SOCKET_URL = API.replace(/\/api\/?$/, '') || 'http://localhost:3002'
const PAGE_SIZE = 30

/**
 * Inbox WhatsApp — tela separada do Kanban pra o operador escrever
 * manualmente pra um lead (ex: ativar um lead importado que nunca trocou
 * mensagem). Uma vez que o lead responde, o webhook normal do SDR assume:
 * a IA só fica de fora enquanto aiPaused=true, e nada aqui mexe nesse campo
 * além do próprio switch "Pausar IA" dentro da conversa.
 */
export default function WhatsAppInbox() {
  const [leads, setLeads] = useState([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loadingList, setLoadingList] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)

  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [filter, setFilter] = useState('all')

  const [selectedLead, setSelectedLead] = useState(null)
  const [loadingThread, setLoadingThread] = useState(false)

  const selectedRef = useRef(null)
  selectedRef.current = selectedLead

  // --- Busca com debounce ---
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  const loadLeads = useCallback(
    async (targetPage = 1) => {
      targetPage === 1 ? setLoadingList(true) : setLoadingMore(true)
      try {
        const params = new URLSearchParams({
          filter,
          page: String(targetPage),
          limit: String(PAGE_SIZE),
        })
        if (debouncedSearch) params.set('search', debouncedSearch)
        const res = await fetch(`${API}/leads/inbox?${params}`)
        const data = await res.json()
        setLeads((prev) => (targetPage === 1 ? data.data : [...prev, ...data.data]))
        setPage(data.page)
        setTotalPages(data.totalPages)
      } catch (e) {
        console.error('Erro ao carregar leads', e)
      } finally {
        setLoadingList(false)
        setLoadingMore(false)
      }
    },
    [filter, debouncedSearch],
  )

  useEffect(() => {
    loadLeads(1)
  }, [loadLeads])

  const selectLead = useCallback(async (row) => {
    setLoadingThread(true)
    try {
      const res = await fetch(`${API}/leads/${row.id}`)
      const fresh = await res.json()
      setSelectedLead(fresh)
    } catch (e) {
      console.error('Erro ao abrir conversa', e)
    } finally {
      setLoadingThread(false)
    }
  }, [])

  // --- Realtime: mesmo canal usado pelo Kanban (lead:created/updated/deleted) ---
  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ['websocket', 'polling'] })

    const upsertInList = (lead) => {
      setLeads((prev) => {
        const exists = prev.some((l) => l.id === lead.id)
        const preview = {
          ...lead,
          lastMessagePreview: Array.isArray(lead.aiContext) && lead.aiContext.length
            ? (lead.aiContext[lead.aiContext.length - 1]?.content ?? null)
            : (exists ? prev.find((l) => l.id === lead.id).lastMessagePreview : null),
          lastMessageRole: Array.isArray(lead.aiContext) && lead.aiContext.length
            ? (lead.aiContext[lead.aiContext.length - 1]?.role ?? null)
            : (exists ? prev.find((l) => l.id === lead.id).lastMessageRole : null),
        }
        if (exists) return prev.map((l) => (l.id === lead.id ? { ...l, ...preview } : l))
        return [preview, ...prev]
      })
    }

    socket.on('lead:created', upsertInList)
    socket.on('lead:updated', (lead) => {
      upsertInList(lead)
      if (selectedRef.current?.id === lead.id) setSelectedLead((prev) => ({ ...prev, ...lead }))
    })
    socket.on('lead:deleted', ({ id }) => {
      setLeads((prev) => prev.filter((l) => l.id !== id))
      if (selectedRef.current?.id === id) setSelectedLead(null)
    })

    return () => socket.disconnect()
  }, [])

  const updateSelectedAndList = useCallback((patch) => {
    setSelectedLead((prev) => (prev ? { ...prev, ...patch } : prev))
    setLeads((prev) => prev.map((l) => (l.id === patch.id ? { ...l, ...patch } : l)))
  }, [])

  const togglePause = useCallback(async (lead) => {
    const paused = !lead.aiPaused
    updateSelectedAndList({ id: lead.id, aiPaused: paused })
    try {
      const res = await fetch(`${API}/leads/${lead.id}/ai-pause`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paused }),
      })
      const fresh = await res.json()
      updateSelectedAndList(fresh)
    } catch (e) {
      console.error('Erro ao alternar pausa da IA', e)
      updateSelectedAndList({ id: lead.id, aiPaused: !paused })
    }
  }, [updateSelectedAndList])

  const assignVendedor = useCallback(async (leadId, assignedTo) => {
    updateSelectedAndList({ id: leadId, assignedTo })
    try {
      const res = await fetch(`${API}/leads/${leadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignedTo }),
      })
      const fresh = await res.json()
      updateSelectedAndList(fresh)
    } catch (e) {
      console.error('Erro ao salvar vendedor', e)
    }
  }, [updateSelectedAndList])

  const saveNotes = useCallback(async (leadId, notes) => {
    updateSelectedAndList({ id: leadId, notes })
    try {
      const res = await fetch(`${API}/leads/${leadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes }),
      })
      const fresh = await res.json()
      updateSelectedAndList(fresh)
    } catch (e) {
      console.error('Erro ao salvar notas', e)
    }
  }, [updateSelectedAndList])

  return (
    <div className="h-[calc(100vh-64px)] flex bg-white">
      <LeadConversationList
        leads={leads}
        selectedId={selectedLead?.id}
        onSelect={selectLead}
        search={search}
        onSearchChange={setSearch}
        filter={filter}
        onFilterChange={setFilter}
        loading={loadingList}
        hasMore={page < totalPages}
        onLoadMore={() => loadLeads(page + 1)}
        loadingMore={loadingMore}
      />

      <section className="flex-1 min-w-0">
        {selectedLead && !loadingThread ? (
          <LeadConversationPanel
            key={selectedLead.id}
            lead={selectedLead}
            onTogglePause={togglePause}
            onAssign={assignVendedor}
            onSaveNotes={saveNotes}
            showCloseButton={false}
          />
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-2 bg-slate-50">
            <MessageSquare className="w-10 h-10" />
            <p className="text-sm font-medium">
              {loadingThread ? 'Carregando conversa...' : 'Selecione um lead pra conversar'}
            </p>
          </div>
        )}
      </section>
    </div>
  )
}
