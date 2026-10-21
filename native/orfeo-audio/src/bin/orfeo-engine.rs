//! Headless test driver for the engine core.
//!
//!   orfeo-engine <song.mid> --fluid DIR --sf2 PATH [--sf2 PATH2] [--mode exclusive|shared]
//!                [--seconds N] [--seek S] [--tempo RATIO] [--transpose N] [--midi] [--auto]
//!
//! --midi  plays every connected MIDI keyboard live over the song
//! --auto  sends a C major arpeggio as live keys (no keyboard needed)

use orfeo_audio::{Command, Engine, EngineConfig, OutputMode, Song};
use std::path::PathBuf;
use std::sync::atomic::Ordering::Relaxed;
use std::time::{Duration, Instant};

fn main() {
    let a: Vec<String> = std::env::args().skip(1).collect();
    let mut song_path = None;
    let (mut fluid, mut sf2s) = (PathBuf::from("."), Vec::new());
    let (mut mode, mut seconds, mut seek, mut tempo, mut transpose, mut midi, mut auto) = (OutputMode::Exclusive, 20u64, 0f64, 1f64, 0i32, false, false);
    let mut i = 0;
    while i < a.len() {
        let next = |i: &mut usize| { *i += 1; a.get(*i).cloned().unwrap_or_default() };
        match a[i].as_str() {
            "--fluid" => fluid = PathBuf::from(next(&mut i)),
            "--sf2" => sf2s.push(PathBuf::from(next(&mut i))),
            "--mode" => mode = if next(&mut i) == "shared" { OutputMode::Shared } else { OutputMode::Exclusive },
            "--seconds" => seconds = next(&mut i).parse().unwrap_or(20),
            "--seek" => seek = next(&mut i).parse().unwrap_or(0.0),
            "--tempo" => tempo = next(&mut i).parse().unwrap_or(1.0),
            "--transpose" => transpose = next(&mut i).parse().unwrap_or(0),
            "--midi" => midi = true,
            "--auto" => auto = true,
            s => song_path = Some(s.to_string()),
        }
        i += 1;
    }

    let engine = match Engine::start(EngineConfig { fluid_dir: fluid, soundfonts: sf2s, mode, midi_inputs: midi }) {
        Ok(e) => e,
        Err(e) => { eprintln!("engine failed to start: {e}"); std::process::exit(1) }
    };
    let s = &engine.stats;
    let rate = s.rate.load(Relaxed) as f64;
    println!("Output: {} | {} | {} Hz | period {} frames ({:.2} ms) | buffer {} ({:.2} ms) | device reports {:.2} ms",
        s.device_name.lock().unwrap(), if s.mode.load(Relaxed) == 0 { "EXCLUSIVE" } else { "shared" }, rate,
        s.period_frames.load(Relaxed), s.period_frames.load(Relaxed) as f64 * 1000.0 / rate,
        s.buffer_frames.load(Relaxed), s.buffer_frames.load(Relaxed) as f64 * 1000.0 / rate, s.reported_latency_ms());
    if let Some(r) = s.fallback_reason.lock().unwrap().as_ref() { println!("Fell back to shared mode: {r}"); }

    if let Some(p) = song_path {
        let bytes = std::fs::read(&p).expect("read song");
        let song = Song::from_smf(&bytes).expect("parse song");
        println!("Song: {} events, {:.1} s, {} tracks", song.events.len(), song.duration, song.track_count);
        engine.send(Command::LoadSong(Box::new(song)));
        engine.send(Command::SetTempoRatio(tempo));
        engine.send(Command::SetTranspose(transpose));
        if seek > 0.0 { engine.send(Command::Seek(seek)); }
        engine.send(Command::Play);
    }

    let t0 = Instant::now();
    let mut last = Instant::now();
    let mut k = 0usize;
    let arp = [60u8, 64, 67, 72];
    while t0.elapsed() < Duration::from_secs(seconds) {
        std::thread::sleep(Duration::from_millis(125));
        if auto {
            let n = arp[k % arp.len()];
            engine.send(Command::Midi { status: 0x9F, d1: n, d2: 100, at: Instant::now() });
            let off = arp[(k + arp.len() - 1) % arp.len()];
            engine.send(Command::Midi { status: 0x8F, d1: off, d2: 0, at: Instant::now() });
            k += 1;
        }
        if let Ok(rx) = engine.live_out.lock() { while rx.try_recv().is_ok() {} }
        if last.elapsed() >= Duration::from_secs(2) {
            last = Instant::now();
            let notes = s.live_notes.swap(0, Relaxed) as f64;
            let wait = s.live_wait_sum_us.swap(0, Relaxed) as f64;
            let queued = s.live_queued_sum_us.swap(0, Relaxed) as f64;
            let wmax = s.live_wait_max_us.swap(0, Relaxed) as f64;
            let live = if notes > 0.0 {
                format!(" | live keys {} : wait avg {:.2} max {:.2} ms, queued {:.2} ms, KEY->SPEAKER ~{:.1} ms",
                    notes, wait / notes / 1000.0, wmax / 1000.0, queued / notes / 1000.0, wait / notes / 1000.0 + queued / notes / 1000.0 + s.reported_latency_ms())
            } else { String::new() };
            println!("pos {:>6.2} s {} | late wake-ups {} | worst render {:.2} ms{}",
                s.position(), if s.playing.load(Relaxed) { "playing" } else { "stopped" },
                s.late_wakeups.load(Relaxed), s.worst_render_us.swap(0, Relaxed) as f64 / 1000.0, live);
            if let Some(e) = s.error.lock().unwrap().as_ref() { println!("ERROR: {e}"); break }
        }
    }
}
