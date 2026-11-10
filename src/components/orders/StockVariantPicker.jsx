import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { variantKey, variantLabel } from '../../lib/inventoryCore'

// On a new order: the colours / sizes of this product currently in stock
// (all warehouses). Tapping one fills the line's colour and size exactly
// as stocked, so the sale deducts that variation.
export function StockVariantPicker({ productId, color, size, onPick }) {
  const { data } = useQuery({
    queryKey: ['order_variant_stock', productId],
    enabled: !!productId,
    retry: false,
    staleTime: 60000,
    queryFn: async () => {
      const { data, error } = await supabase.from('inventory_variants')
        .select('color, size, variant_key, quantity').eq('product_id', productId).gt('quantity', 0)
      if (error) return []
      const by = {}
      for (const v of data || []) {
        if (!by[v.variant_key]) by[v.variant_key] = { color: v.color, size: v.size, key: v.variant_key, quantity: 0 }
        by[v.variant_key].quantity += Number(v.quantity) || 0
      }
      return Object.values(by).sort((a, b) => b.quantity - a.quantity)
    },
  })
  const list = data || []
  if (!productId || list.length === 0) return null
  const current = variantKey(color, size)
  return (
    <div>
      <p className="text-xs text-gray-500 mb-1.5">In stock — tap to choose:</p>
      <div className="flex flex-wrap gap-1.5">
        {list.map(v => {
          const on = v.key === current
          return (
            <button key={v.key} type="button" onClick={() => onPick({ color: v.color || '', size: v.size || '' })}
              className={`px-2.5 py-1 rounded-lg border text-xs ${on ? 'border-yellow-500 bg-yellow-50 text-gray-900 font-semibold' : 'border-gray-200 bg-white text-gray-700'}`}>
              {variantLabel(v.color, v.size)} <span className="text-gray-400">({v.quantity})</span>
            </button>
          )
        })}
      </div>
      {(color || size) && !list.some(v => v.key === current) && (
        <p className="text-[11px] text-amber-700 mt-1">This colour/size isn't in stock — it will be deducted from stock with no colour recorded, if any.</p>
      )}
    </div>
  )
}
