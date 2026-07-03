import { Search, X } from 'lucide-react'

export function SearchBar({ value, onChange, placeholder = 'Search...', className = '' }) {
  return (
    <div className={`relative ${className}`}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full pl-9 pr-9 py-2.5 text-sm bg-gray-100 border-0 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
      />
      {value && (
        <button
          onClick={() => onChange('')}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
        >
          <X size={16} />
        </button>
      )}
    </div>
  )
}
