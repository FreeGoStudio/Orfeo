// ── Turns raw MIDI port names into the keyboard's own model name ──────────────
// Windows lists one physical keyboard as several ports with technical names:
// "MIDIIN2 (Launchkey MK4 37)", "Launchkey MK4 37 MIDI", "2- MPK mini Plus",
// "Komplete Kontrol S88 MK3 MIDI 1". Users should only ever see the model —
// and all ports of one keyboard count as one device, keyed by that name.

const GENERIC_MAKERS = /^(microsoft( corporation)?|generic|unknown|usb audio device)?$/i

export function cleanPortName(raw: string): string {
  let n = (raw ?? '').trim()
  n = n.replace(/^\d+\s*-\s*/, '')                       // "2- Device" (Windows duplicate prefix)
  const wrapped = n.match(/^MIDI(?:IN|OUT)\d*\s*\((.+)\)$/i)  // "MIDIIN2 (Device)"
  if (wrapped) n = wrapped[1]
  n = n.replace(/\s*\[.*?\]\s*$/, '')                     // "Device [hw:1,0,0]" (Linux)
  n = n.replace(/\s+(MIDI|Port|DAW|Out|In)(\s*\d+)?$/i, '') // "Device MIDI 1", "Device Port 2"
  n = n.replace(/\s+(MIDI|Port|DAW|Out|In)(\s*\d+)?$/i, '') // a second suffix ("… DAW Port")
  n = n.replace(/\s{2,}/g, ' ').trim()
  return n || (raw ?? '').trim() || 'MIDI keyboard'
}

// Maker shown in front of the model, unless it's the generic USB driver
// Windows reports for most class-compliant keyboards, or already in the name
export function displayName(model: string, manufacturer?: string | null): string {
  // "Focusrite A.E. Ltd" -> "Focusrite"
  const m = (manufacturer ?? '').trim().replace(/[\s,]+(A\.E\.\s*)?(Ltd\.?|Inc\.?|GmbH|Corp(oration)?\.?|Co\.|LLC|S\.?A\.?)\s*$/i, '').trim()
  if (!m || GENERIC_MAKERS.test(m) || model.toLowerCase().includes(m.toLowerCase())) return model
  return `${m} ${model}`
}

// Short label for the top bar under the MIDI icon: the model's first word
// that isn't the maker ("Launchkey", "MPK", "Komplete")
export function shortName(model: string): string {
  const words = model.split(' ').filter(Boolean)
  return (words[0] ?? 'MIDI').slice(0, 12)
}
