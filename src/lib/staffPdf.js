import jsPDF from 'jspdf'
import { labelOf, WARNING_TYPES } from '../hooks/useStaff'

function letterShell(doc, businessName, title) {
  doc.setFontSize(16); doc.setFont('helvetica', 'bold')
  doc.text(businessName || 'Company', 20, 20)
  doc.setDrawColor(200); doc.line(20, 24, 190, 24)
  doc.setFontSize(14)
  doc.text(title, 20, 36)
  doc.setFontSize(10); doc.setFont('helvetica', 'normal')
  return 46
}

function wrapText(doc, text, x, y, maxWidth = 170, lineHeight = 5.5) {
  const lines = doc.splitTextToSize(text || '', maxWidth)
  lines.forEach(line => {
    if (y > 275) { doc.addPage(); y = 20 }
    doc.text(line, x, y)
    y += lineHeight
  })
  return y
}

// Formal warning letter from a staff_warnings record
export function generateWarningLetter(warning, staff, businessName) {
  const doc = new jsPDF()
  let y = letterShell(doc, businessName, labelOf(WARNING_TYPES, warning.warning_type).toUpperCase())

  doc.text(`Date: ${warning.date_issued || ''}`, 20, y); y += 6
  doc.text(`To: ${staff?.name || ''} (${staff?.staff_code || ''})`, 20, y); y += 6
  if (staff?.position || staff?.department) {
    doc.text(`Position: ${[staff.position, staff.department].filter(Boolean).join(' · ')}`, 20, y); y += 6
  }
  y += 4

  const section = (heading, body) => {
    if (!body) return
    doc.setFont('helvetica', 'bold'); doc.text(heading, 20, y); y += 6
    doc.setFont('helvetica', 'normal')
    y = wrapText(doc, body, 20, y) + 4
  }

  if (warning.category) section('Category', warning.category)
  section('Incident Details', warning.incident_details)
  section('Corrective Action Required', warning.corrective_action)
  if (warning.review_date) section('Review Date', warning.review_date)
  section('Consequence If Not Improved', warning.consequence)

  y += 6
  doc.text(`Issued by: ${warning.issued_by_name || ''}`, 20, y); y += 14
  doc.text('Signature (Issuer): ______________________', 20, y); y += 10
  doc.text('Signature (Staff):  ______________________', 20, y)

  return doc
}

// Generic HR letter from a generated staff_documents record
export function generateStaffLetter(docRecord, staff, businessName) {
  const doc = new jsPDF()
  let y = letterShell(doc, businessName, docRecord.title)

  doc.text(`Date: ${(docRecord.created_at || '').slice(0, 10)}`, 20, y); y += 6
  doc.text(`To: ${staff?.name || ''} (${staff?.staff_code || ''})`, 20, y); y += 10

  y = wrapText(doc, docRecord.body || '', 20, y)

  y += 14
  doc.text(`Issued by: ${docRecord.uploaded_by_name || ''}`, 20, y); y += 12
  doc.text('Signature: ______________________', 20, y)

  return doc
}
