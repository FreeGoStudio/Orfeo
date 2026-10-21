//! Metronome and count-in clicks: a 1400 Hz (accent) / 1000 Hz sine with a
//! 40 ms exponential decay — the same sound as Orfeo's Web Audio metronome —
//! placed at exact sample positions.

pub struct ClickVoice { phase: f32, step: f32, amp: f32, decay: f32, left: usize }

pub struct Clicks { rate: f32, pub volume: f32, voices: Vec<ClickVoice> }

impl Clicks {
    pub fn new(rate: f32) -> Self { Clicks { rate, volume: 0.6, voices: Vec::with_capacity(8) } }

    pub fn trigger(&mut self, accent: bool) {
        let freq = if accent { 1400.0 } else { 1000.0 };
        let start = (if accent { 0.9 } else { 0.6 }) * self.volume;
        if start <= 0.0011 { return }
        // exponential ramp from `start` to 0.001 over 40 ms, cut at 50 ms
        let decay = (0.001f32 / start).powf(1.0 / (0.04 * self.rate));
        if self.voices.len() < self.voices.capacity() {
            self.voices.push(ClickVoice { phase: 0.0, step: 2.0 * std::f32::consts::PI * freq / self.rate, amp: start, decay, left: (0.05 * self.rate) as usize });
        }
    }

    /// Adds the sounding clicks into the buffers
    pub fn render(&mut self, l: &mut [f32], r: &mut [f32]) {
        for v in self.voices.iter_mut() {
            for i in 0..l.len().min(v.left) {
                let s = v.phase.sin() * v.amp;
                l[i] += s; r[i] += s;
                v.phase += v.step;
                v.amp *= v.decay;
            }
            v.left = v.left.saturating_sub(l.len());
        }
        self.voices.retain(|v| v.left > 0);
    }
}
