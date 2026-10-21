//! FluidSynth, loaded at runtime from a folder (libfluidsynth-3.dll + its own
//! DLLs). Only the synth is used — Orfeo renders it itself, so FluidSynth's
//! audio drivers, MIDI player and threads are never started.

use libloading::Library;
use std::ffi::{c_char, c_double, c_float, c_int, c_void, CString};
use std::path::Path;

type Ptr = *mut c_void;

pub struct Fluid {
    _lib: Library,
    settings: Ptr,
    synth: Ptr,
    noteon: unsafe extern "C" fn(Ptr, c_int, c_int, c_int) -> c_int,
    noteoff: unsafe extern "C" fn(Ptr, c_int, c_int) -> c_int,
    cc: unsafe extern "C" fn(Ptr, c_int, c_int, c_int) -> c_int,
    program: unsafe extern "C" fn(Ptr, c_int, c_int) -> c_int,
    bend: unsafe extern "C" fn(Ptr, c_int, c_int) -> c_int,
    chan_pressure: unsafe extern "C" fn(Ptr, c_int, c_int) -> c_int,
    key_pressure: unsafe extern "C" fn(Ptr, c_int, c_int, c_int) -> c_int,
    all_notes_off: unsafe extern "C" fn(Ptr, c_int) -> c_int,
    all_sounds_off: unsafe extern "C" fn(Ptr, c_int) -> c_int,
    write_float: unsafe extern "C" fn(Ptr, c_int, Ptr, c_int, c_int, Ptr, c_int, c_int) -> c_int,
    set_gain: unsafe extern "C" fn(Ptr, c_float),
    sfload: unsafe extern "C" fn(Ptr, *const c_char, c_int) -> c_int,
    sfunload: unsafe extern "C" fn(Ptr, c_int, c_int) -> c_int,
    delete_synth: unsafe extern "C" fn(Ptr),
    delete_settings: unsafe extern "C" fn(Ptr),
}

// The synth is only ever touched by the audio thread after creation
unsafe impl Send for Fluid {}

/// FluidSynth renders in 64-sample blocks: an event lands on the next one.
pub const FLUID_GRAIN: usize = 64;

impl Fluid {
    pub fn new(dir: &Path, sample_rate: f64) -> Result<Self, String> {
        unsafe {
            let dll = dir.join("libfluidsynth-3.dll");
            // Altered search path: libsndfile (for .sf3) and SDL3 are found next to it
            let lib: Library = libloading::os::windows::Library::load_with_flags(&dll, libloading::os::windows::LOAD_WITH_ALTERED_SEARCH_PATH)
                .map_err(|e| format!("cannot load {}: {e}", dll.display()))?
                .into();
            macro_rules! sym { ($n:literal) => { *lib.get($n).map_err(|e| format!("missing {}: {e}", String::from_utf8_lossy($n)))? } }
            let new_settings: unsafe extern "C" fn() -> Ptr = sym!(b"new_fluid_settings");
            let setnum: unsafe extern "C" fn(Ptr, *const c_char, c_double) -> c_int = sym!(b"fluid_settings_setnum");
            let setint: unsafe extern "C" fn(Ptr, *const c_char, c_int) -> c_int = sym!(b"fluid_settings_setint");
            let new_synth: unsafe extern "C" fn(Ptr) -> Ptr = sym!(b"new_fluid_synth");
            let c = |s: &str| CString::new(s).unwrap();

            let settings = new_settings();
            if settings.is_null() { return Err("new_fluid_settings failed".into()) }
            setnum(settings, c("synth.sample-rate").as_ptr(), sample_rate);
            setnum(settings, c("synth.gain").as_ptr(), 1.0);
            setint(settings, c("synth.polyphony").as_ptr(), 256);
            setint(settings, c("synth.cpu-cores").as_ptr(), 1);
            // Effects stay on; their amount is set per channel (CC91 / CC93),
            // which starts at 0 — same as the current Samples engine
            setint(settings, c("synth.reverb.active").as_ptr(), 1);
            setint(settings, c("synth.chorus.active").as_ptr(), 1);
            let synth = new_synth(settings);
            if synth.is_null() { return Err("new_fluid_synth failed".into()) }

            Ok(Fluid {
                settings, synth,
                noteon: sym!(b"fluid_synth_noteon"),
                noteoff: sym!(b"fluid_synth_noteoff"),
                cc: sym!(b"fluid_synth_cc"),
                program: sym!(b"fluid_synth_program_change"),
                bend: sym!(b"fluid_synth_pitch_bend"),
                chan_pressure: sym!(b"fluid_synth_channel_pressure"),
                key_pressure: sym!(b"fluid_synth_key_pressure"),
                all_notes_off: sym!(b"fluid_synth_all_notes_off"),
                all_sounds_off: sym!(b"fluid_synth_all_sounds_off"),
                write_float: sym!(b"fluid_synth_write_float"),
                set_gain: sym!(b"fluid_synth_set_gain"),
                sfload: sym!(b"fluid_synth_sfload"),
                sfunload: sym!(b"fluid_synth_sfunload"),
                delete_synth: sym!(b"delete_fluid_synth"),
                delete_settings: sym!(b"delete_fluid_settings"),
                _lib: lib,
            })
        }
    }

    /// Loads a .sf2/.sf3; the most recently loaded set wins for presets it
    /// has, earlier ones fill the gaps (FluidSynth's sound-set stack).
    pub fn load_soundfont(&mut self, path: &Path) -> Result<i32, String> {
        let p = CString::new(path.to_string_lossy().as_bytes()).map_err(|e| e.to_string())?;
        let id = unsafe { (self.sfload)(self.synth, p.as_ptr(), 1) };
        if id < 0 { Err(format!("FluidSynth could not load {}", path.display())) } else { Ok(id) }
    }
    pub fn unload_soundfont(&mut self, id: i32) { unsafe { (self.sfunload)(self.synth, id, 1); } }

    /// One raw MIDI channel message
    pub fn midi(&mut self, status: u8, d1: u8, d2: u8) {
        let ch = (status & 0x0F) as c_int;
        let (a, b) = (d1 as c_int, d2 as c_int);
        unsafe {
            match status & 0xF0 {
                0x90 if d2 > 0 => { (self.noteon)(self.synth, ch, a, b); }
                0x90 | 0x80 => { (self.noteoff)(self.synth, ch, a); }
                0xB0 => { (self.cc)(self.synth, ch, a, b); }
                0xC0 => { (self.program)(self.synth, ch, a); }
                0xE0 => { (self.bend)(self.synth, ch, a | (b << 7)); }
                0xD0 => { (self.chan_pressure)(self.synth, ch, a); }
                0xA0 => { (self.key_pressure)(self.synth, ch, a, b); }
                _ => {}
            }
        }
    }
    pub fn all_notes_off(&mut self) { unsafe { (self.all_notes_off)(self.synth, -1); } }
    pub fn all_sounds_off(&mut self) { unsafe { (self.all_sounds_off)(self.synth, -1); } }
    pub fn set_gain(&mut self, g: f32) { unsafe { (self.set_gain)(self.synth, g) } }

    /// Renders (adds nothing — overwrites) `l.len()` frames
    pub fn render(&mut self, l: &mut [f32], r: &mut [f32]) {
        unsafe {
            (self.write_float)(self.synth, l.len() as c_int, l.as_mut_ptr() as Ptr, 0, 1, r.as_mut_ptr() as Ptr, 0, 1);
        }
    }
}

impl Drop for Fluid {
    fn drop(&mut self) {
        unsafe { (self.delete_synth)(self.synth); (self.delete_settings)(self.settings); }
    }
}
