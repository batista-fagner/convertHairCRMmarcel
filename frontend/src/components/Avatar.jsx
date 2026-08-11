import { getAvatarColor, getInitials } from '../lib/leadFormat'

export default function Avatar({ lead, size = 'w-8 h-8 text-xs' }) {
  if (lead.avatarUrl) {
    return (
      <img
        src={lead.avatarUrl}
        alt={lead.name}
        className={`${size.split(' ').slice(0, 2).join(' ')} rounded-full object-cover shrink-0`}
      />
    )
  }
  return (
    <div className={`${size} rounded-full ${getAvatarColor(lead.name)} flex items-center justify-center text-white font-bold shrink-0`}>
      {getInitials(lead.name)}
    </div>
  )
}
