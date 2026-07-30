// Utilitários pra trabalhar com horário de Nova York no front — a agenda do
// Marcel é sempre em NY (ET), independente do fuso do navegador de quem olha
// a tela. NY tem horário de verão (EDT/EST), então nunca usar offset fixo:
// sempre resolver via Intl.DateTimeFormat de verdade (mesma técnica do backend,
// ver availability.service.ts).
const TIMEZONE = 'America/New_York'

function offsetMinutesAt(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date)
  const get = (type) => parseInt(parts.find(p => p.type === type).value, 10)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return Math.round((asUtc - date.getTime()) / 60000)
}

/** Converte um horário de parede (ano/mês/dia/hora/minuto, NY) pro Date (UTC) correto, com DST. */
export function nyWallTimeToUtc(year, month, day, hour, minute) {
  let utcGuess = Date.UTC(year, month - 1, day, hour, minute)
  for (let i = 0; i < 2; i++) {
    const offset = offsetMinutesAt(new Date(utcGuess), TIMEZONE)
    utcGuess = Date.UTC(year, month - 1, day, hour, minute) - offset * 60000
  }
  return new Date(utcGuess)
}

/** Partes (ano/mês/dia/hora24/minuto) de um Date, como aparece em Nova York. */
export function nyParts(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date)
  const get = (type) => parseInt(parts.find(p => p.type === type).value, 10)
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute') }
}

/** "2:00 PM" a partir de um Date, sempre em horário de Nova York. */
export function formatNyAmPm(date) {
  return new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, hour: 'numeric', minute: '2-digit', hour12: true }).format(date)
}

/** "YYYY-MM-DDTHH:MM" (24h) pra preencher um <input type="datetime-local">, em horário de Nova York. */
export function toNyDateTimeLocalValue(date) {
  const { year, month, day, hour, minute } = nyParts(date)
  const pad = (n) => String(n).padStart(2, '0')
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}`
}

/** Lê o valor de um <input type="datetime-local"> (string "YYYY-MM-DDTHH:MM") como horário de Nova York e devolve o Date (UTC) correto. */
export function parseNyDateTimeLocalValue(value) {
  const [datePart, timePart] = value.split('T')
  const [year, month, day] = datePart.split('-').map(Number)
  const [hour, minute] = (timePart || '00:00').split(':').map(Number)
  return nyWallTimeToUtc(year, month, day, hour, minute)
}
