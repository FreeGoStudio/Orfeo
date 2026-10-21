//! A song as the engine plays it: every channel message with its time in the
//! file's own seconds (tempo map already applied) and the track it came from.
//! Orfeo's renderer will send this from its own parser; `from_smf` is for the
//! CLI and tests.

#[derive(Clone, Copy, Debug)]
pub struct SongEvent { pub time: f64, pub track: u16, pub status: u8, pub d1: u8, pub d2: u8 }

#[derive(Clone, Debug, Default)]
pub struct Song { pub events: Vec<SongEvent>, pub duration: f64, pub track_count: u16 }

impl Song {
    pub fn from_smf(bytes: &[u8]) -> Result<Song, String> {
        let smf = midly::Smf::parse(bytes).map_err(|e| e.to_string())?;
        let tpq = match smf.header.timing { midly::Timing::Metrical(t) => t.as_int() as f64, _ => return Err("SMPTE timing not supported".into()) };
        // Tempo map from all tracks (format 1 keeps it in track 0, but be safe)
        let mut tempos: Vec<(u64, f64)> = Vec::new();
        for tr in &smf.tracks {
            let mut t = 0u64;
            for e in tr {
                t += e.delta.as_int() as u64;
                if let midly::TrackEventKind::Meta(midly::MetaMessage::Tempo(us)) = e.kind { tempos.push((t, us.as_int() as f64)) }
            }
        }
        tempos.sort_by_key(|x| x.0);
        let tick_to_sec = |tick: u64| -> f64 {
            let (mut sec, mut last, mut us) = (0.0, 0u64, 500_000.0);
            for &(t, u) in &tempos { if t >= tick { break } sec += (t - last) as f64 / tpq * us / 1e6; last = t; us = u; }
            sec + (tick - last) as f64 / tpq * us / 1e6
        };
        let mut events = Vec::new();
        for (ti, tr) in smf.tracks.iter().enumerate() {
            let mut t = 0u64;
            for e in tr {
                t += e.delta.as_int() as u64;
                if let midly::TrackEventKind::Midi { channel, message } = e.kind {
                    use midly::MidiMessage::*;
                    let ch = channel.as_int();
                    let (st, a, b) = match message {
                        NoteOn { key, vel } => (0x90, key.as_int(), vel.as_int()),
                        NoteOff { key, .. } => (0x80, key.as_int(), 0),
                        Controller { controller, value } => (0xB0, controller.as_int(), value.as_int()),
                        ProgramChange { program } => (0xC0, program.as_int(), 0),
                        PitchBend { bend } => { let v = bend.0.as_int(); (0xE0, (v & 0x7F) as u8, (v >> 7) as u8) }
                        ChannelAftertouch { vel } => (0xD0, vel.as_int(), 0),
                        Aftertouch { key, vel } => (0xA0, key.as_int(), vel.as_int()),
                    };
                    events.push(SongEvent { time: tick_to_sec(t), track: ti as u16, status: st | ch, d1: a, d2: b });
                }
            }
        }
        // Stable sort keeps a note-off before a note-on of the same key at the same instant
        events.sort_by(|a, b| a.time.partial_cmp(&b.time).unwrap());
        let duration = events.last().map(|e| e.time).unwrap_or(0.0);
        Ok(Song { events, duration, track_count: smf.tracks.len() as u16 })
    }

    /// First event at or after `t`
    pub fn index_at(&self, t: f64) -> usize { self.events.partition_point(|e| e.time < t) }

    /// Channel state a listener would have at `t` (program, bank, controllers,
    /// pitch bend) — replayed on seek so a passage starts with the right sound
    /// and a pedal that's already down stays down.
    pub fn state_before(&self, t: f64) -> Vec<(u8, u8, u8)> {
        let end = self.index_at(t);
        let mut last: std::collections::BTreeMap<(u8, u8), (u8, u8, u8)> = Default::default();
        for e in &self.events[..end] {
            match e.status & 0xF0 {
                0xB0 => { last.insert((e.status, e.d1), (e.status, e.d1, e.d2)); }
                0xC0 => { last.insert((e.status, 255), (e.status, e.d1, 0)); }
                0xE0 => { last.insert((e.status, 254), (e.status, e.d1, e.d2)); }
                _ => {}
            }
        }
        // Bank selects (CC0/32) must come before the program change they apply to
        let mut v: Vec<_> = last.into_values().collect();
        v.sort_by_key(|&(st, d1, _)| { let kind = st & 0xF0; (st & 0x0F, if kind == 0xB0 && (d1 == 0 || d1 == 32) { 0 } else if kind == 0xC0 { 1 } else { 2 }) });
        v
    }
}
