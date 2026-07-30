import { useState } from 'react'
import { X, Trash2, Calendar, User, Phone, Tag, DollarSign, FileText } from 'lucide-react'
import { appointmentsApi } from '../lib/appointmentsApi'
import { toNyDateTimeLocalValue, parseNyDateTimeLocalValue } from '../lib/nyTime'

const STATUS_OPTIONS = [
  { value: 'agendado',       label: 'Agendado' },
  { value: 'confirmado',     label: 'Confirmado' },
  { value: 'realizado',      label: 'Realizado' },
  { value: 'cancelado',      label: 'Cancelado' },
  { value: 'nao_compareceu', label: 'Não compareceu' },
]

export default function AppointmentModal({ appointment, defaultDate, onClose, onSaved }) {
  const isEdit = !!appointment

  const [form, setForm] = useState({
    clientName:    appointment?.clientName ?? '',
    clientPhone:   appointment?.clientPhone ?? '',
    service:       appointment?.service ?? '',
    value:         appointment?.value ?? '',
    status:        appointment?.status ?? 'agendado',
    startDateTime: toNyDateTimeLocalValue(new Date(appointment?.startDateTime ?? defaultDate ?? new Date())),
    notes:         appointment?.notes ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  function update(field, value) {
    setForm(f => ({ ...f, [field]: value }))
  }

  async function handleSave() {
    if (!form.clientName.trim() || !form.startDateTime) return
    setSaving(true)
    try {
      const payload = {
        clientName: form.clientName.trim(),
        clientPhone: form.clientPhone.trim() || null,
        service: form.service.trim(),
        value: form.value === '' || form.value == null ? null : Number(form.value),
        status: form.status,
        startDateTime: parseNyDateTimeLocalValue(form.startDateTime).toISOString(),
        notes: form.notes.trim() || null,
      }
      if (isEdit) {
        await appointmentsApi.update(appointment.id, payload)
      } else {
        await appointmentsApi.create(payload)
      }
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    setSaving(true)
    try {
      await appointmentsApi.remove(appointment.id)
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-bold text-gray-800">{isEdit ? 'Editar agendamento' : 'Novo agendamento'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <Field icon={<User className="w-3.5 h-3.5" />} label="Nome do contato">
            <input
              type="text"
              value={form.clientName}
              onChange={e => update('clientName', e.target.value)}
              placeholder="Ex: João Silva"
              className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </Field>

          <Field icon={<Phone className="w-3.5 h-3.5" />} label="WhatsApp (opcional)">
            <input
              type="text"
              value={form.clientPhone}
              onChange={e => update('clientPhone', e.target.value)}
              placeholder="11999999999"
              className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </Field>

          <Field icon={<Calendar className="w-3.5 h-3.5" />} label="Data e hora (horário de Nova York)">
            <input
              type="datetime-local"
              value={form.startDateTime}
              onChange={e => update('startDateTime', e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field icon={<Tag className="w-3.5 h-3.5" />} label="Assunto/Serviço">
              <input
                type="text"
                value={form.service}
                onChange={e => update('service', e.target.value)}
                placeholder="Ex: Call com Lucas"
                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </Field>

            <Field icon={<DollarSign className="w-3.5 h-3.5" />} label="Valor (opcional)">
              <input
                type="number"
                step="0.01"
                value={form.value}
                onChange={e => update('value', e.target.value)}
                placeholder="0"
                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </Field>
          </div>

          <Field icon={<Tag className="w-3.5 h-3.5" />} label="Status">
            <select
              value={form.status}
              onChange={e => update('status', e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            >
              {STATUS_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>

          <Field icon={<FileText className="w-3.5 h-3.5" />} label="Observações">
            <textarea
              value={form.notes}
              onChange={e => update('notes', e.target.value)}
              rows={3}
              placeholder="Ex: preferiu ligação no fim da tarde..."
              className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none"
            />
          </Field>
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 bg-gray-50">
          {isEdit ? (
            confirmDelete ? (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-red-600 font-medium">Confirmar?</span>
                <button onClick={handleDelete} disabled={saving} className="text-red-600 font-semibold hover:underline">Sim</button>
                <span className="text-gray-300">|</span>
                <button onClick={() => setConfirmDelete(false)} className="text-gray-500 hover:underline">Não</button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="text-red-600 hover:bg-red-50 px-2 py-1 rounded transition flex items-center gap-1 text-sm"
              >
                <Trash2 className="w-4 h-4" /> Remover
              </button>
            )
          ) : <div />}

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-200 rounded-lg transition"
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !form.clientName.trim() || !form.startDateTime}
              className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 text-white rounded-lg text-sm font-medium transition"
            >
              {saving ? 'Salvando...' : isEdit ? 'Salvar' : 'Agendar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ icon, label, children }) {
  return (
    <div>
      <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1 mb-1">
        <span className="text-gray-400">{icon}</span> {label}
      </label>
      {children}
    </div>
  )
}
