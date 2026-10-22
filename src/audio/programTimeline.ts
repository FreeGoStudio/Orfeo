// ── Which instrument each MIDI channel plays, and when it changes ────────────
// A file track that switches instrument mid-song (Kate Bush's "Wuthering
// Heights": nylon guitar, then oboe, then guitar again, all on one channel) is
// split by the parser into one Orfeo track per instrument, all on the same
// channel. A channel plays one instrument at a time, so it has to switch
// whenever notes of another of its tracks begin. Both engines play from this
// list, with each track's instrument as the Tracks panel has it.

export interface ProgramSwitch { time: number; program: number; track: number }

interface TrackLike { index: number; channel: number; isDrum?: boolean; notes: { time: number }[] }
interface TrackState { index: number; program: number }

/** Per channel (drums left out), the instrument switches in time order; the
 *  first one is at time 0, so the whole song is covered */
export function programTimeline(midi: { tracks: TrackLike[] } | null | undefined, tracks: TrackState[]): Map<number, ProgramSwitch[]> {
  const out = new Map<number, ProgramSwitch[]>()
  if (!midi) return out
  const byChannel = new Map<number, { track: number; program: number }[]>()
  for (const t of midi.tracks) {
    if (t.isDrum || t.channel === 9 || !t.notes.length) continue
    const ts = tracks.find(x => x.index === t.index)
    if (!ts) continue
    const list = byChannel.get(t.channel) ?? []
    list.push({ track: t.index, program: ts.program })
    byChannel.set(t.channel, list)
  }
  for (const [ch, list] of byChannel) {
    if (list.length === 1) { out.set(ch, [{ time: 0, ...list[0] }]); continue }
    // several tracks share the channel: switch at each change of track
    const notes: { time: number; track: number; program: number }[] = []
    for (const { track, program } of list) {
      const t = midi.tracks.find(x => x.index === track)!
      for (const n of t.notes) notes.push({ time: n.time, track, program })
    }
    notes.sort((a, b) => a.time - b.time)
    const switches: ProgramSwitch[] = []
    for (const n of notes) {
      const cur = switches[switches.length - 1]
      if (!cur) switches.push({ time: 0, program: n.program, track: n.track })
      else if (cur.program !== n.program) switches.push({ time: n.time, program: n.program, track: n.track })
    }
    out.set(ch, switches)
  }
  return out
}

/** The instrument a channel plays at `time` */
export function programAt(switches: ProgramSwitch[], time: number): number {
  let p = switches[0]?.program ?? 0
  for (const s of switches) { if (s.time <= time) p = s.program; else break }
  return p
}
