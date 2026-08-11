import { Search, PauseCircle, MessageSquare, Loader2 } from 'lucide-react'
import { formatPhone, timeAgo } from '../../../lib/leadFormat'
import Avatar from '../../../components/Avatar'

const FILTERS = [
  { key: 'all', label: 'Todos' },
  { key: 'imported', label: 'Importados' },
  { key: 'never-contacted', label: 'Nunca contatado' },
]

function ConversationRow({ lead, active, onSelect }) {
  const name = lead.name || formatPhone(lead.phone) || lead.phone
  const isFromLead = lead.lastMessageRole === 'user'

  return (
    <button
      onClick={() => onSelect(lead)}
      className={`w-full text-left px-4 py-3 border-l-4 transition ${
        active
          ? 'border-emerald-500 bg-gradient-to-r from-emerald-50 to-transparent'
          : 'border-transparent hover:bg-slate-50'
      }`}
    >
      <div className="flex items-start gap-3">
        <Avatar lead={lead} size="w-9 h-9 text-xs" />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-slate-700 truncate">{name}</p>
            <span className="ml-auto text-[10px] text-slate-400 shrink-0">
              {timeAgo(lead.waLastMessageAt || lead.createdAt)}
            </span>
          </div>

          <p className="text-[11px] text-slate-400 truncate">{formatPhone(lead.phone)}</p>

          <div className="flex items-center gap-1.5 mt-0.5">
            <p className="text-xs truncate flex-1 text-slate-400">
              {!isFromLead && lead.lastMessagePreview && <span className="text-slate-300 mr-1">→</span>}
              {lead.lastMessagePreview || 'Nenhuma mensagem ainda'}
            </p>

            {lead.aiPaused && (
              <PauseCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" title="IA pausada" />
            )}
            {lead.importedAt && (
              <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 font-medium">
                Importado
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  )
}

export default function LeadConversationList({
  leads,
  selectedId,
  onSelect,
  search,
  onSearchChange,
  filter,
  onFilterChange,
  loading,
  hasMore,
  onLoadMore,
  loadingMore,
}) {
  return (
    <aside className="w-80 shrink-0 bg-white border-r border-slate-200 flex flex-col">
      <div className="p-3 border-b border-slate-100 space-y-2.5">
        <div className="flex items-center gap-2 bg-slate-100 rounded-lg px-3 py-2">
          <Search className="w-4 h-4 text-slate-400 shrink-0" />
          <input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Buscar nome ou número"
            className="bg-transparent text-sm text-slate-600 placeholder-slate-400 outline-none w-full"
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => onFilterChange(f.key)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition ${
                filter === f.key
                  ? 'bg-emerald-500 text-white'
                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
        {loading && (
          <div className="p-4 space-y-3">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-start gap-3 animate-pulse">
                <div className="w-9 h-9 rounded-full bg-slate-200 shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-slate-200 rounded w-2/3" />
                  <div className="h-2.5 bg-slate-100 rounded w-full" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && leads.length === 0 && (
          <div className="flex flex-col items-center justify-center text-slate-400 py-16 gap-2 px-6 text-center">
            <MessageSquare className="w-9 h-9" />
            <p className="text-sm font-medium">Nenhum lead encontrado</p>
            <p className="text-xs">
              {search || filter !== 'all'
                ? 'Tente outra busca ou filtro.'
                : 'Os leads do SDR aparecem aqui.'}
            </p>
          </div>
        )}

        {!loading &&
          leads.map((lead) => (
            <ConversationRow key={lead.id} lead={lead} active={lead.id === selectedId} onSelect={onSelect} />
          ))}

        {hasMore && !loading && (
          <button
            onClick={onLoadMore}
            disabled={loadingMore}
            className="w-full py-3 text-xs font-semibold text-emerald-600 hover:bg-emerald-50 transition flex items-center justify-center gap-1.5"
          >
            {loadingMore && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Carregar mais
          </button>
        )}
      </div>
    </aside>
  )
}
