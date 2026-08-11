// Helpers de exibição de lead compartilhados entre o Kanban e o Inbox
// WhatsApp — extraídos de KanbanLeads.jsx pra não duplicar avatar/telefone/
// badge de temperatura em duas telas que mostram os mesmos leads.

const AVATAR_COLORS = [
  'bg-violet-500', 'bg-emerald-500', 'bg-amber-500', 'bg-cyan-500',
  'bg-blue-500', 'bg-rose-500', 'bg-indigo-500', 'bg-teal-500',
]

export function getInitials(name) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

export function getAvatarColor(name) {
  if (!name) return AVATAR_COLORS[0]
  let hash = 0
  for (const c of name) hash = c.charCodeAt(0) + ((hash << 5) - hash)
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

export function timeAgo(date) {
  if (!date) return ''
  const diff = Date.now() - new Date(date).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'agora'
  if (mins < 60) return `há ${mins} min`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `há ${hours}h`
  const days = Math.floor(hours / 24)
  return `há ${days}d`
}

export function formatPhone(phone) {
  if (!phone) return null
  const d = phone.replace(/\D/g, '')
  // Número dos EUA com DDI (padrão da base do Marcel): 1 + área(3) + 7 dígitos.
  // Sem esse caso, "18042003936" caía no formato BR e virava "(18) 04200-3936".
  if (d.length === 11 && d.startsWith('1')) return `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  // DDI 55 só conta com 13 dígitos (55 + DDD + 9) — um local de 11 dígitos com
  // DDD 55 (Santa Maria/RS) não pode ser confundido com DDI.
  const isBr = d.length === 13 && d.startsWith('55')
  const local = isBr ? d.slice(2) : d
  const prefix = isBr ? '+55 ' : ''
  if (local.length === 11) return `${prefix}(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`
  if (local.length === 10) return `${prefix}(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`
  return phone
}

export const TEMP_BADGE = {
  quente: { label: '🔥 Quente', className: 'bg-rose-100 text-rose-700' },
  morno:  { label: '🌤 Morno',  className: 'bg-amber-100 text-amber-700' },
  frio:   { label: '❄️ Frio',   className: 'bg-cyan-100 text-cyan-700' },
}
