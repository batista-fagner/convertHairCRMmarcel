import { useState, useEffect, useRef } from 'react'
import { Mic, Upload, Loader2, Trash2, Save, CheckCircle2, AlertCircle, Pencil, X, Play, Square, Send } from 'lucide-react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001/api'
const MAX_RECORD_SECONDS = 120

export default function Audios() {
  const [audios, setAudios] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [mode, setMode] = useState(null) // null | 'record' | 'upload'

  const load = () => {
    setLoading(true)
    fetch(`${API}/followup/audios`)
      .then(r => r.json())
      .then(d => setAudios(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Áudios de Follow-up</h2>
          <p className="text-sm text-slate-400 mt-0.5">Grave ou suba uma nota de voz pra anexar nas regras de follow-up. Até 16MB.</p>
        </div>
        {!mode && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setMode('record')}
              className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
            >
              <Mic className="w-4 h-4" /> Gravar áudio
            </button>
            <button
              onClick={() => setMode('upload')}
              className="flex items-center gap-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 text-sm font-medium px-4 py-2 rounded-lg transition"
            >
              <Upload className="w-4 h-4" /> Subir arquivo
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}

      {mode === 'record' && (
        <AudioRecorder
          onCancel={() => setMode(null)}
          onDone={() => { setMode(null); load() }}
          onError={setError}
        />
      )}

      {mode === 'upload' && (
        <UploadForm
          onCancel={() => setMode(null)}
          onDone={() => { setMode(null); load() }}
          onError={setError}
        />
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-slate-400 text-sm py-8">
          <Loader2 className="w-4 h-4 animate-spin" /> Carregando áudios...
        </div>
      ) : audios.length === 0 && !mode ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <Mic className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 font-medium">Nenhum áudio ainda</p>
          <p className="text-slate-400 text-sm mt-1">Grave ou suba o primeiro pra usar nas regras de follow-up</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {audios.map(a => (
            <AudioCard key={a.id} audio={a} onChanged={load} onError={setError} />
          ))}
        </div>
      )}
    </div>
  )
}

function formatSeconds(s) {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${String(sec).padStart(2, '0')}`
}

// Adaptado do gravador em convertHairCRM/frontend/src/pages/KanbanLeads.jsx —
// aqui, diferente do original (que manda direto), tem etapa de prévia porque o
// áudio vai virar biblioteca reutilizável, não uma mensagem avulsa.
function AudioRecorder({ onCancel, onDone, onError }) {
  const [phase, setPhase] = useState('idle') // idle | recording | preview | saving
  const [seconds, setSeconds] = useState(0)
  const [blob, setBlob] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [mimeType, setMimeType] = useState('')
  const [name, setName] = useState('')
  const [unsupported, setUnsupported] = useState(false)

  const mediaRecorderRef = useRef(null)
  const chunksRef = useRef([])
  const streamRef = useRef(null)
  const timerRef = useRef(null)

  useEffect(() => {
    if (typeof MediaRecorder === 'undefined') setUnsupported(true)
    return () => {
      // Cleanup se sair da tela no meio de uma gravação — sem isso, o
      // indicador de microfone do navegador fica aceso pra sempre.
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop()
      }
      streamRef.current?.getTracks().forEach(t => t.stop())
      clearInterval(timerRef.current)
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const start = async () => {
    onError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      streamRef.current = stream
      const mime = MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')
        ? 'audio/ogg;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : '' // '' deixa o navegador escolher (Safari/iOS cai pra mp4)
      const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
      const actualMime = recorder.mimeType || mime || 'audio/webm'
      chunksRef.current = []
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      recorder.onstop = () => {
        streamRef.current?.getTracks().forEach(t => t.stop())
        clearInterval(timerRef.current)
        const recordedBlob = new Blob(chunksRef.current, { type: actualMime })
        if (recordedBlob.size === 0) { setPhase('idle'); setSeconds(0); return }
        setBlob(recordedBlob)
        setMimeType(actualMime)
        setPreviewUrl(URL.createObjectURL(recordedBlob))
        setPhase('preview')
      }
      mediaRecorderRef.current = recorder
      recorder.start()
      setPhase('recording')
      setSeconds(0)
      timerRef.current = setInterval(() => {
        setSeconds(s => {
          if (s + 1 >= MAX_RECORD_SECONDS) { recorder.stop(); return s + 1 }
          return s + 1
        })
      }, 1000)
    } catch (err) {
      if (err?.name === 'NotAllowedError') onError('Permita o acesso ao microfone nas configurações do navegador')
      else if (err?.name === 'NotFoundError') onError('Nenhum microfone encontrado')
      else onError('Não foi possível acessar o microfone')
    }
  }

  const stop = () => mediaRecorderRef.current?.stop()

  const reRecord = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setBlob(null)
    setPreviewUrl(null)
    setPhase('idle')
    setSeconds(0)
  }

  const save = async () => {
    onError('')
    if (!blob) return
    if (!name.trim()) { onError('Dê um nome pro áudio'); return }
    setPhase('saving')
    try {
      const ext = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('webm') ? 'webm' : mimeType.includes('mp4') ? 'm4a' : 'audio'
      const file = new File([blob], `audio.${ext}`, { type: mimeType })
      const fd = new FormData()
      fd.append('file', file)
      fd.append('name', name.trim())
      fd.append('durationSeconds', String(seconds))
      const res = await fetch(`${API}/followup/audios`, { method: 'POST', body: fd })
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.message || 'Erro no upload') }
      onDone()
    } catch (e) {
      onError(e.message)
      setPhase('preview')
    }
  }

  if (unsupported) {
    return (
      <div className="bg-white rounded-xl border border-amber-200 p-5 mb-6">
        <p className="text-sm text-amber-700">Seu navegador não suporta gravação direta. Use "Subir arquivo" em vez disso.</p>
        <button onClick={onCancel} className="mt-3 text-xs font-medium text-slate-500 hover:text-slate-700">Voltar</button>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-violet-200 p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <p className="font-semibold text-slate-800 text-sm">Gravar áudio</p>
        <button onClick={onCancel} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
      </div>

      {phase === 'idle' && (
        <div className="flex flex-col items-center py-6 gap-3">
          <button
            onClick={start}
            className="flex items-center justify-center w-16 h-16 rounded-full bg-violet-600 hover:bg-violet-700 text-white transition"
          >
            <Mic className="w-6 h-6" />
          </button>
          <p className="text-xs text-slate-400">Toque pra começar a gravar (máx. {formatSeconds(MAX_RECORD_SECONDS)})</p>
        </div>
      )}

      {phase === 'recording' && (
        <div className="flex flex-col items-center py-6 gap-3">
          <button
            onClick={stop}
            className="flex items-center justify-center w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 text-white transition animate-pulse"
          >
            <Square className="w-5 h-5" />
          </button>
          <p className="text-sm font-medium text-slate-700 tabular-nums">{formatSeconds(seconds)}</p>
          <p className="text-xs text-slate-400">Gravando... toque pra parar</p>
        </div>
      )}

      {(phase === 'preview' || phase === 'saving') && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 bg-slate-50 rounded-lg p-3">
            <Play className="w-4 h-4 text-violet-500 flex-shrink-0" />
            <audio src={previewUrl} controls className="w-full h-9" />
            <span className="text-xs text-slate-400 tabular-nums flex-shrink-0">{formatSeconds(seconds)}</span>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">Nome</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Ex: Convite pro workshop"
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300"
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <button onClick={reRecord} disabled={phase === 'saving'} className="text-xs font-medium text-slate-500 hover:text-slate-700 disabled:opacity-50">Regravar</button>
            <button
              onClick={save}
              disabled={phase === 'saving'}
              className="flex items-center gap-1.5 text-sm font-medium text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 px-4 py-2 rounded-lg transition"
            >
              {phase === 'saving' ? <><Loader2 className="w-4 h-4 animate-spin" /> Salvando...</> : <><Save className="w-4 h-4" /> Salvar</>}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function UploadForm({ onCancel, onDone, onError }) {
  const [file, setFile] = useState(null)
  const [name, setName] = useState('')
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef(null)

  const submit = async () => {
    onError('')
    if (!file) { onError('Selecione um arquivo de áudio'); return }
    if (!name.trim()) { onError('Dê um nome pro áudio'); return }
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('name', name.trim())
      const res = await fetch(`${API}/followup/audios`, { method: 'POST', body: fd })
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.message || 'Erro no upload') }
      onDone()
    } catch (e) {
      onError(e.message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-violet-200 p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <p className="font-semibold text-slate-800 text-sm">Subir áudio</p>
        <button onClick={onCancel} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1.5">Arquivo (ogg, mp3, m4a, webm — máx 16MB)</label>
          <input
            ref={fileRef}
            type="file"
            accept="audio/*"
            onChange={e => setFile(e.target.files?.[0] || null)}
            className="block w-full text-sm text-slate-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-violet-50 file:text-violet-700 hover:file:bg-violet-100"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1.5">Nome</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Ex: Convite pro workshop"
            className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300"
          />
        </div>
        <div className="flex items-center justify-end gap-3">
          <button onClick={onCancel} className="text-xs font-medium text-slate-500 hover:text-slate-700 px-3 py-2">Cancelar</button>
          <button
            onClick={submit}
            disabled={uploading}
            className="flex items-center gap-1.5 text-sm font-medium text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 px-4 py-2 rounded-lg transition"
          >
            {uploading ? <><Loader2 className="w-4 h-4 animate-spin" /> Subindo...</> : <><Upload className="w-4 h-4" /> Subir</>}
          </button>
        </div>
      </div>
    </div>
  )
}

function AudioCard({ audio, onChanged, onError }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(audio.name)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testPhone, setTestPhone] = useState('')
  const [testOpen, setTestOpen] = useState(false)

  const save = async () => {
    onError('')
    setSaving(true)
    try {
      const res = await fetch(`${API}/followup/audios/${audio.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.message || 'Erro ao salvar') }
      setSaved(true); setEditing(false)
      setTimeout(() => setSaved(false), 2500)
      onChanged()
    } catch (e) {
      onError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!confirm(`Excluir o áudio "${audio.name}"?`)) return
    onError('')
    try {
      const res = await fetch(`${API}/followup/audios/${audio.id}`, { method: 'DELETE' })
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.message || 'Erro ao excluir') }
      onChanged()
    } catch (e) {
      onError(e.message)
    }
  }

  const sendTest = async () => {
    if (!testPhone.trim()) { onError('Informe o telefone (com DDI)'); return }
    onError('')
    setTesting(true)
    try {
      const res = await fetch(`${API}/followup/audios/${audio.id}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: testPhone.trim() }),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.message || 'Erro ao enviar teste') }
      setTestOpen(false)
      setTestPhone('')
    } catch (e) {
      onError(e.message)
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="p-4">
        {editing ? (
          <div className="space-y-2">
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-violet-300"
            />
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => { setEditing(false); setName(audio.name) }} className="text-xs text-slate-500 px-2 py-1">Cancelar</button>
              <button onClick={save} disabled={saving} className="flex items-center gap-1 text-xs font-medium text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 px-3 py-1.5 rounded-lg">
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Salvar
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-2 mb-2">
              <p className="text-sm font-medium text-slate-800 truncate">{audio.name}</p>
              <div className="flex items-center gap-1 flex-shrink-0">
                {saved && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                <button onClick={() => setEditing(true)} className="p-1 text-slate-400 hover:text-violet-600" title="Editar"><Pencil className="w-3.5 h-3.5" /></button>
                <button onClick={remove} className="p-1 text-slate-400 hover:text-red-600" title="Excluir"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </div>
            <audio src={audio.publicUrl} controls className="w-full h-9 mb-2" />
            {audio.durationSeconds != null && (
              <p className="text-[10px] text-slate-400 mb-2 tabular-nums">{formatSeconds(audio.durationSeconds)}</p>
            )}

            {testOpen ? (
              <div className="flex items-center gap-1.5">
                <input
                  value={testPhone}
                  onChange={e => setTestPhone(e.target.value)}
                  placeholder="5511999998888"
                  className="flex-1 text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-violet-300"
                />
                <button onClick={sendTest} disabled={testing} className="flex items-center gap-1 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 px-2.5 py-1.5 rounded-lg flex-shrink-0">
                  {testing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                </button>
                <button onClick={() => setTestOpen(false)} className="text-slate-400 hover:text-slate-600 flex-shrink-0"><X className="w-3.5 h-3.5" /></button>
              </div>
            ) : (
              <button
                onClick={() => setTestOpen(true)}
                className="text-[11px] font-medium text-violet-600 hover:text-violet-800"
              >
                Testar no meu WhatsApp
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
