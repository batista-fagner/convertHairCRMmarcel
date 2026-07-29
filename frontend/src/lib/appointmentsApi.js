const API = import.meta.env.VITE_API_URL || 'http://localhost:3001/api'

async function request(path, options = {}) {
  const res = await fetch(`${API}/appointments${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) {
    const err = new Error(data?.message?.message || data?.message || `Request failed (${res.status})`)
    err.status = res.status
    throw err
  }
  return data
}

export const appointmentsApi = {
  listByMonth: (year, month) => request(`?year=${year}&month=${month}`),
  create: (payload) => request('', { method: 'POST', body: JSON.stringify(payload) }),
  update: (id, payload) => request(`/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  remove: (id) => request(`/${id}`, { method: 'DELETE' }),
}
