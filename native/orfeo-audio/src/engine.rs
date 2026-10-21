//! The audio thread: owns the output device and FluidSynth, plays the song
//! sample-accurately (each period is split at event times), mixes in live
//! keys, applies the master chain, and reports position/stats via atomics.

use crate::dsp::{soft_clip, HighShelf};
use crate::fluid::Fluid;
use crate::output::{Output, OutputMode};
use crate::song::Song;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicU8, Ordering::Relaxed};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

pub struct EngineConfig {
    pub fluid_dir: PathBuf,
    /// Loaded in order; later sets win for presets they have (layering)
    pub soundfonts: Vec<PathBuf>,
    pub mode: OutputMode,
    /// Open every MIDI input port and play it live
    pub midi_inputs: bool,
}

pub enum Command {
    LoadSong(Box<Song>),
    Play,
    Pause,
    Seek(f64),
    /// Playback speed relative to the file (1.0 = as written)
    SetTempoRatio(f64),
    SetTranspose(i32),
    /// One flag per track; a muted track's notes are skipped
    SetAudibleTracks(Box<Vec<bool>>),
    SetMasterGain(f32),
    SetToneDb(f32),
    /// A message played right now (previews, live keys arriving from the UI)
    Midi { status: u8, d1: u8, d2: u8, at: Instant },
    AllNotesOff,
    Shutdown,
}

/// Read by the caller any time; written only by the audio thread
#[derive(Default)]
pub struct Stats {
    pub position_bits: AtomicU64, // f64 file seconds
    pub playing: AtomicBool,
    pub mode: AtomicU8,           // 0 exclusive, 1 shared
    pub rate: AtomicU32,
    pub period_frames: AtomicU32,
    pub buffer_frames: AtomicU32,
    pub reported_latency_bits: AtomicU64,
    pub late_wakeups: AtomicU32,
    pub worst_render_us: AtomicU32,
    pub live_notes: AtomicU32,
    pub live_wait_sum_us: AtomicU64,
    pub live_wait_max_us: AtomicU32,
    pub live_queued_sum_us: AtomicU64,
    pub device_name: Mutex<String>,
    pub fallback_reason: Mutex<Option<String>>,
    pub error: Mutex<Option<String>>,
}

impl Stats {
    pub fn position(&self) -> f64 { f64::from_bits(self.position_bits.load(Relaxed)) }
    pub fn reported_latency_ms(&self) -> f64 { f64::from_bits(self.reported_latency_bits.load(Relaxed)) }
}

struct LiveMsg { status: u8, d1: u8, d2: u8, at: Instant }

pub struct Engine {
    commands: Mutex<rtrb::Producer<Command>>,
    pub stats: Arc<Stats>,
    /// Every live key/pedal message, for the UI (lights, chord display)
    pub live_out: Mutex<Receiver<(u8, u8, u8)>>,
    _midi: Vec<midir::MidiInputConnection<()>>,
    thread: Option<JoinHandle<()>>,
}

impl Engine {
    pub fn start(cfg: EngineConfig) -> Result<Engine, String> {
        let (prod, cons) = rtrb::RingBuffer::<Command>::new(4096);
        let (live_tx, live_rx) = mpsc::channel::<LiveMsg>();
        let (ui_tx, ui_rx) = mpsc::channel::<(u8, u8, u8)>();
        let stats = Arc::new(Stats::default());
        let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();

        let st = stats.clone();
        let thread = std::thread::Builder::new().name("orfeo-audio".into()).spawn(move || {
            audio_thread(cfg.fluid_dir, cfg.soundfonts, cfg.mode, cons, live_rx, st, ready_tx)
        }).map_err(|e| e.to_string())?;
        ready_rx.recv().map_err(|_| "audio thread ended during start-up".to_string())??;

        let midi = if cfg.midi_inputs { open_midi_inputs(live_tx, ui_tx) } else { Vec::new() };
        Ok(Engine { commands: Mutex::new(prod), stats, live_out: Mutex::new(ui_rx), _midi: midi, thread: Some(thread) })
    }

    /// False if the queue is full (the audio thread has stopped draining it)
    pub fn send(&self, cmd: Command) -> bool { self.commands.lock().unwrap().push(cmd).is_ok() }
}

impl Drop for Engine {
    fn drop(&mut self) {
        self.send(Command::Shutdown);
        if let Some(t) = self.thread.take() { let _ = t.join(); }
    }
}

fn open_midi_inputs(tx: Sender<LiveMsg>, ui: Sender<(u8, u8, u8)>) -> Vec<midir::MidiInputConnection<()>> {
    let mut conns = Vec::new();
    let Ok(probe) = midir::MidiInput::new("orfeo") else { return conns };
    for p in probe.ports() {
        let Ok(input) = midir::MidiInput::new("orfeo") else { continue };
        let (tx, ui) = (tx.clone(), ui.clone());
        if let Ok(c) = input.connect(&p, "orfeo-in", move |_, m, _| {
            if m.len() >= 2 && m[0] < 0xF0 {
                let (s, a, b) = (m[0], m[1], *m.get(2).unwrap_or(&0));
                let _ = tx.send(LiveMsg { status: s, d1: a, d2: b, at: Instant::now() });
                let _ = ui.send((s, a, b));
            }
        }, ()) { conns.push(c) }
    }
    conns
}

// Live keys always play on channel 16 (index 15), Orfeo's live/preview channel
const LIVE_CH: u8 = 15;

#[allow(clippy::too_many_arguments)]
fn audio_thread(fluid_dir: PathBuf, soundfonts: Vec<PathBuf>, mode: OutputMode, mut cmds: rtrb::Consumer<Command>,
    live: Receiver<LiveMsg>, stats: Arc<Stats>, ready: Sender<Result<(), String>>) {
    if let Err(e) = wasapi::initialize_mta().ok() { let _ = ready.send(Err(format!("COM: {e}"))); return }
    let out = match Output::open(mode) { Ok(o) => o, Err(e) => { let _ = ready.send(Err(e)); return } };
    let mut fluid = match Fluid::new(&fluid_dir, out.rate as f64) { Ok(f) => f, Err(e) => { let _ = ready.send(Err(e)); return } };
    for sf in &soundfonts { if let Err(e) = fluid.load_soundfont(sf) { let _ = ready.send(Err(e)); return } }
    for ch in 0..16u8 { fluid.midi(0xB0 | ch, 91, 0); fluid.midi(0xB0 | ch, 93, 0); }
    fluid.midi(0xC0 | LIVE_CH, 0, 0);

    stats.mode.store(if out.mode == OutputMode::Exclusive { 0 } else { 1 }, Relaxed);
    stats.rate.store(out.rate, Relaxed);
    stats.period_frames.store(out.period_frames, Relaxed);
    stats.buffer_frames.store(out.buffer_frames, Relaxed);
    stats.reported_latency_bits.store(out.reported_latency_ms.to_bits(), Relaxed);
    *stats.device_name.lock().unwrap() = out.device_name.clone();
    *stats.fallback_reason.lock().unwrap() = out.fallback_reason.clone();
    let _ = ready.send(Ok(()));

    let rate = out.rate as f64;
    let n = out.buffer_frames as usize;
    let (mut l, mut r) = (vec![0f32; n], vec![0f32; n]);
    let mut scratch = Vec::with_capacity(n * 8);

    // Transport state
    let mut song = Box::<Song>::default();
    let mut idx = 0usize;
    let mut pos = 0f64;
    let mut playing = false;
    let mut ratio = 1f64;
    let mut transpose = 0i32;
    let mut audible: Box<Vec<bool>> = Box::default();
    let mut gain = 1f32;
    let mut tone_db = 0f32;
    let mut tone = HighShelf::new(rate as f32, 3000.0, 0.0);

    // Prime with silence, start
    let avail = out.client.get_available_space_in_frames().unwrap_or(0) as usize;
    let _ = out.write(&l[..avail], &r[..avail], &mut scratch);
    if let Err(e) = out.client.start_stream() { *stats.error.lock().unwrap() = Some(e.to_string()); return }

    let period_ms = out.period_frames as f64 * 1000.0 / rate;
    let started = Instant::now();
    let mut last_wake = Instant::now();

    let transpose_note = |status: u8, key: u8, t: i32| -> u8 {
        if status & 0x0F == 9 { key } else { (key as i32 + t).clamp(0, 127) as u8 }
    };

    'run: loop {
        if out.event.wait_for_event(1000).is_err() {
            *stats.error.lock().unwrap() = Some("the output device stopped responding".into());
            break;
        }
        let now = Instant::now();
        let gap = now.duration_since(last_wake).as_secs_f64() * 1000.0;
        last_wake = now;
        if gap > period_ms * 1.8 && started.elapsed() > Duration::from_millis(500) { stats.late_wakeups.fetch_add(1, Relaxed); }

        // ── Commands ──────────────────────────────────────────────────────
        while let Ok(c) = cmds.pop() {
            match c {
                Command::LoadSong(s) => { fluid.all_sounds_off(); song = s; idx = 0; pos = 0.0; playing = false; }
                Command::Play => {
                    if !playing { for &(s, a, b) in &song.state_before(pos) { fluid.midi(s, a, b) } }
                    playing = true;
                }
                Command::Pause => { playing = false; fluid.all_sounds_off(); }
                Command::Seek(t) => {
                    fluid.all_sounds_off();
                    pos = t.max(0.0); idx = song.index_at(pos);
                    for &(s, a, b) in &song.state_before(pos) { fluid.midi(s, a, b) }
                }
                Command::SetTempoRatio(x) => ratio = x.clamp(0.05, 8.0),
                Command::SetTranspose(t) => { if t != transpose { fluid.all_notes_off(); transpose = t } }
                Command::SetAudibleTracks(a) => audible = a,
                Command::SetMasterGain(g) => gain = g,
                Command::SetToneDb(db) => { tone_db = db; tone.set(rate as f32, 3000.0, db) }
                Command::Midi { status, d1, d2, at } => {
                    // Same timing record as a key from a MIDI port
                    if status & 0xF0 == 0x90 && d2 > 0 {
                        let wait = now.duration_since(at).as_micros() as u64;
                        let padding = out.client.get_current_padding().unwrap_or(0) as f64;
                        stats.live_notes.fetch_add(1, Relaxed);
                        stats.live_wait_sum_us.fetch_add(wait, Relaxed);
                        stats.live_wait_max_us.fetch_max(wait as u32, Relaxed);
                        stats.live_queued_sum_us.fetch_add((padding * 1e6 / rate) as u64, Relaxed);
                    }
                    fluid.midi(status, d1, d2)
                }
                Command::AllNotesOff => fluid.all_sounds_off(),
                Command::Shutdown => break 'run,
            }
        }

        let padding = out.client.get_current_padding().unwrap_or(0) as f64;
        // ── Live keys: straight into the synth, at the start of this period ──
        while let Ok(m) = live.try_recv() {
            let kind = m.status & 0xF0;
            if kind == 0x90 && m.d2 > 0 {
                let wait = now.duration_since(m.at).as_micros() as u64;
                stats.live_notes.fetch_add(1, Relaxed);
                stats.live_wait_sum_us.fetch_add(wait, Relaxed);
                stats.live_wait_max_us.fetch_max(wait as u32, Relaxed);
                stats.live_queued_sum_us.fetch_add((padding * 1e6 / rate) as u64, Relaxed);
            }
            fluid.midi(kind | LIVE_CH, m.d1, m.d2);
        }

        let avail = out.client.get_available_space_in_frames().unwrap_or(0) as usize;
        if avail == 0 { continue }
        let r0 = Instant::now();

        // ── Render, split at song event times ───────────────────────────
        let mut done = 0usize;
        while done < avail {
            let mut chunk = avail - done;
            if playing {
                while idx < song.events.len() && song.events[idx].time <= pos + 1e-9 {
                    let e = song.events[idx];
                    idx += 1;
                    let kind = e.status & 0xF0;
                    let is_note = kind == 0x90 || kind == 0x80 || kind == 0xA0;
                    let muted = audible.get(e.track as usize).map(|a| !a).unwrap_or(false);
                    if is_note && muted && kind == 0x90 && e.d2 > 0 { continue }
                    let d1 = if is_note { transpose_note(e.status, e.d1, transpose) } else { e.d1 };
                    fluid.midi(e.status, d1, e.d2);
                }
                if let Some(next) = song.events.get(idx) {
                    let frames = ((next.time - pos) / ratio * rate).ceil().max(1.0) as usize;
                    chunk = chunk.min(frames);
                } else if pos > song.duration + 2.0 {
                    playing = false;
                }
            }
            fluid.render(&mut l[done..done + chunk], &mut r[done..done + chunk]);
            if playing { pos += chunk as f64 * ratio / rate; }
            done += chunk;
        }

        // ── Master chain: gain → tone → soft clip (no look-ahead, no delay) ──
        let use_tone = tone_db.abs() > 0.01;
        for i in 0..avail {
            let (mut a, mut b) = (l[i] * gain, r[i] * gain);
            if use_tone { a = tone.process(0, a); b = tone.process(1, b); }
            l[i] = soft_clip(a);
            r[i] = soft_clip(b);
        }
        stats.worst_render_us.fetch_max(r0.elapsed().as_micros() as u32, Relaxed);

        if let Err(e) = out.write(&l[..avail], &r[..avail], &mut scratch) {
            *stats.error.lock().unwrap() = Some(format!("write failed: {e}"));
            break;
        }
        stats.position_bits.store(pos.to_bits(), Relaxed);
        stats.playing.store(playing, Relaxed);
    }
    let _ = out.client.stop_stream();
}
