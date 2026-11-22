import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'

// ═══════════════════════════════════════════════════════════════════
// One report = a title + sections. A section is a named table:
//   { title: 'Orders', rows: [{ 'Order #': …, Total: 1200 }, …] }
// The same sections become a CSV, an Excel workbook (one sheet each)
// or a PDF (one table each), so every format holds the same figures.
// ═══════════════════════════════════════════════════════════════════

const nonEmpty = (sections) => sections.filter(s => s && Array.isArray(s.rows))
export const hasRows = (sections) => nonEmpty(sections).some(s => s.rows.length > 0)

function columnsOf(rows) {
  const cols = []
  for (const r of rows) for (const k of Object.keys(r)) if (!cols.includes(k)) cols.push(k)
  return cols
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

// ── CSV: one file; several sections are stacked under their titles ──
export function exportCSV(report, filename) {
  const cell = (v) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const sections = nonEmpty(report.sections)
  const many = sections.length > 1
  const out = []
  if (many) {
    out.push(cell(report.title))
    if (report.subtitle) out.push(cell(report.subtitle))
    out.push('')
  }
  for (const s of sections) {
    if (many) out.push(cell(s.title))
    if (s.rows.length === 0) { out.push('No records'); out.push(''); continue }
    const cols = columnsOf(s.rows)
    out.push(cols.map(cell).join(','))
    for (const r of s.rows) out.push(cols.map(c => cell(r[c])).join(','))
    out.push('')
  }
  // BOM so Excel opens ₦ and other characters correctly
  triggerDownload(new Blob(['﻿' + out.join('\n')], { type: 'text/csv;charset=utf-8' }), filename)
}

// ── Excel: one sheet per section ──
export function exportXLSX(report, filename) {
  const wb = XLSX.utils.book_new()
  const used = new Set()
  for (const s of nonEmpty(report.sections)) {
    let name = (s.title || 'Sheet').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31).trim() || 'Sheet'
    let n = 2
    while (used.has(name.toLowerCase())) name = `${name.slice(0, 28)} ${n++}`
    used.add(name.toLowerCase())
    const rows = s.rows.length ? s.rows : [{ Note: 'No records for this period' }]
    const ws = XLSX.utils.json_to_sheet(rows)
    // Readable column widths
    ws['!cols'] = columnsOf(rows).map(c => ({
      wch: Math.min(45, Math.max(c.length, ...rows.slice(0, 200).map(r => String(r[c] ?? '').length)) + 2),
    }))
    XLSX.utils.book_append_sheet(wb, ws, name)
  }
  if (wb.SheetNames.length === 0) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ Note: 'No records' }]), 'Report')
  XLSX.writeFile(wb, filename)
}

// ── PDF: landscape A4, a table per section, headers repeat on new pages ──
const fmtCell = (v) => {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') return Number.isInteger(v) ? v.toLocaleString('en-NG') : v.toLocaleString('en-NG', { maximumFractionDigits: 2 })
  return String(v).replace(/₦/g, 'NGN ')
}

export function exportPDF(report, filename) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const M = 36
  const ROW = 16
  let y = M

  const footer = () => {
    const pages = doc.getNumberOfPages()
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i)
      doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(140)
      doc.text(`${report.title} · page ${i} of ${pages}`, W - M, H - 18, { align: 'right' })
      doc.setTextColor(0)
    }
  }
  const newPage = () => { doc.addPage(); y = M }

  doc.setFont('helvetica', 'bold'); doc.setFontSize(16)
  doc.text(report.title, M, y + 4); y += 20
  if (report.subtitle) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(90)
    doc.text(report.subtitle, M, y); doc.setTextColor(0); y += 18
  }

  for (const s of nonEmpty(report.sections)) {
    if (y > H - M - ROW * 4) newPage()
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12)
    doc.text(s.title, M, y + 10); y += 20
    if (s.rows.length === 0) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(120)
      doc.text('No records for this period', M, y + 8); doc.setTextColor(0); y += 24
      continue
    }
    const cols = columnsOf(s.rows)
    const body = s.rows.map(r => cols.map(c => fmtCell(r[c])))
    const numeric = cols.map(c => s.rows.every(r => r[c] === '' || r[c] == null || typeof r[c] === 'number'))
    // Width by content, scaled to the page
    const want = cols.map((c, i) => Math.min(40, Math.max(c.length, ...body.slice(0, 300).map(r => r[i].length))) + 2)
    const fontSize = cols.length > 9 ? 7 : 8
    // Natural width (≈ average character width); narrow tables stay
    // narrow, wide ones are scaled down to fit the page
    const natural = want.map(w => Math.max(48, w * fontSize * 0.55))
    const avail = W - M * 2
    const sum = natural.reduce((a, b) => a + b, 0)
    const widths = sum <= avail ? natural : natural.map(w => (w / sum) * avail)
    const tableW = widths.reduce((a, b) => a + b, 0)

    const drawHeader = () => {
      doc.setFillColor(43, 29, 24); doc.rect(M, y, tableW, ROW, 'F')
      doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(fontSize)
      let x = M
      cols.forEach((c, i) => {
        const t = doc.splitTextToSize(c, widths[i] - 6)[0] || ''
        if (numeric[i]) doc.text(t, x + widths[i] - 3, y + 11, { align: 'right' })
        else doc.text(t, x + 3, y + 11)
        x += widths[i]
      })
      doc.setTextColor(0); y += ROW
    }
    drawHeader()
    doc.setFont('helvetica', 'normal')
    body.forEach((r, ri) => {
      if (y > H - M - ROW) { newPage(); drawHeader(); doc.setFont('helvetica', 'normal') }
      if (ri % 2 === 1) { doc.setFillColor(248, 246, 243); doc.rect(M, y, tableW, ROW, 'F') }
      doc.setFontSize(fontSize)
      let x = M
      r.forEach((v, i) => {
        let t = doc.splitTextToSize(v, widths[i] - 6)[0] || ''
        if (t.length < v.length) t = t.slice(0, Math.max(0, t.length - 1)) + '…'
        if (numeric[i]) doc.text(t, x + widths[i] - 3, y + 11, { align: 'right' })
        else doc.text(t, x + 3, y + 11)
        x += widths[i]
      })
      y += ROW
    })
    y += 14
  }
  footer()
  doc.save(filename)
}
