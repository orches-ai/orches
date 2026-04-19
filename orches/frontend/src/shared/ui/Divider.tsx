import { useState } from 'react'

export default function Divider({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      onMouseDown={onMouseDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 1, flexShrink: 0, cursor: 'col-resize',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        position: 'relative', zIndex: 50, userSelect: 'none',
      }}
    >
      <div style={{
        position: 'absolute', top: 0, bottom: 0,
        left: '50%', transform: 'translateX(-50%)',
        width: 1,
        background: hovered ? '#c0c0c0' : '#e5e5e5',
        transition: 'background 0.15s',
      }} />
      <div style={{
        position: 'relative', zIndex: 1,
        width: 18, height: 32, borderRadius: 9,
        background: hovered ? '#e0e0e0' : '#ebebeb',
        border: `1px solid ${hovered ? '#c0c0c0' : '#e0e0e0'}`,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 3,
        transition: 'all 0.15s',
        boxShadow: hovered ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
      }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{
            width: 3, height: 3, borderRadius: '50%',
            background: hovered ? '#888' : '#b0b0b0',
            transition: 'background 0.15s',
          }} />
        ))}
      </div>
    </div>
  )
}
