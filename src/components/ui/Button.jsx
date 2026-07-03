export function Button({
  children,
  variant = 'primary',
  size = 'md',
  className = '',
  loading = false,
  disabled = false,
  leftIcon,
  rightIcon,
  ...props
}) {
  const base = 'inline-flex items-center justify-center font-medium rounded-xl transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed gap-2'

  const variants = {
    primary: 'bg-blue-600 text-white shadow-sm hover:bg-blue-700 active:bg-blue-800',
    secondary: 'bg-gray-100 text-gray-700 hover:bg-gray-200 active:bg-gray-300',
    danger: 'bg-red-600 text-white hover:bg-red-700 active:bg-red-800',
    ghost: 'text-gray-600 hover:bg-gray-100 active:bg-gray-200',
    outline: 'border-2 border-blue-600 text-blue-600 hover:bg-blue-50',
    success: 'bg-green-600 text-white hover:bg-green-700',
    warning: 'bg-amber-500 text-white hover:bg-amber-600',
  }

  const sizes = {
    sm: 'px-3 py-1.5 text-sm min-h-[36px]',
    md: 'px-4 py-2.5 text-sm min-h-[44px]',
    lg: 'px-6 py-3 text-base min-h-[52px]',
    xl: 'px-8 py-4 text-lg min-h-[60px]',
    icon: 'p-2 min-h-[44px] min-w-[44px]',
  }

  return (
    <button
      className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      ) : leftIcon}
      {children}
      {!loading && rightIcon}
    </button>
  )
}
