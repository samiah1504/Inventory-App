import { forwardRef } from 'react'

export const Input = forwardRef(function Input({
  label,
  error,
  hint,
  leftIcon,
  rightIcon,
  className = '',
  inputClassName = '',
  required,
  ...props
}, ref) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {label && (
        <label className="text-sm font-medium text-gray-700">
          {label}{required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
      )}
      <div className="relative">
        {leftIcon && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
            {leftIcon}
          </div>
        )}
        <input
          ref={ref}
          className={`
            w-full border border-gray-300 rounded-xl bg-white text-gray-900
            placeholder-gray-400 text-sm transition-colors
            focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
            disabled:bg-gray-50 disabled:text-gray-500
            ${leftIcon ? 'pl-10' : 'pl-3'} ${rightIcon ? 'pr-10' : 'pr-3'} py-2.5
            ${error ? 'border-red-400 focus:ring-red-500' : ''}
            ${inputClassName}
          `}
          {...props}
        />
        {rightIcon && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
            {rightIcon}
          </div>
        )}
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      {hint && !error && <p className="text-xs text-gray-500">{hint}</p>}
    </div>
  )
})

export const Select = forwardRef(function Select({
  label,
  error,
  hint,
  className = '',
  required,
  children,
  ...props
}, ref) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {label && (
        <label className="text-sm font-medium text-gray-700">
          {label}{required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
      )}
      <select
        ref={ref}
        className={`
          w-full border border-gray-300 rounded-xl bg-white text-gray-900
          text-sm px-3 py-2.5 transition-colors appearance-none
          focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
          disabled:bg-gray-50 disabled:text-gray-500
          ${error ? 'border-red-400 focus:ring-red-500' : ''}
        `}
        {...props}
      >
        {children}
      </select>
      {error && <p className="text-xs text-red-500">{error}</p>}
      {hint && !error && <p className="text-xs text-gray-500">{hint}</p>}
    </div>
  )
})

export const Textarea = forwardRef(function Textarea({
  label,
  error,
  hint,
  className = '',
  required,
  rows = 3,
  ...props
}, ref) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {label && (
        <label className="text-sm font-medium text-gray-700">
          {label}{required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
      )}
      <textarea
        ref={ref}
        rows={rows}
        className={`
          w-full border border-gray-300 rounded-xl bg-white text-gray-900
          placeholder-gray-400 text-sm px-3 py-2.5 transition-colors resize-none
          focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
          disabled:bg-gray-50 disabled:text-gray-500
          ${error ? 'border-red-400 focus:ring-red-500' : ''}
        `}
        {...props}
      />
      {error && <p className="text-xs text-red-500">{error}</p>}
      {hint && !error && <p className="text-xs text-gray-500">{hint}</p>}
    </div>
  )
})
